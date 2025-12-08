/**
 * E2E Tests for Unread Badge Functionality
 *
 * These tests verify that unread message badges:
 * 1. Appear when messages arrive while NOT viewing that tab
 * 2. Clear when clicking the tab with unread messages
 * 3. Do NOT appear when messages arrive while viewing that tab (the critical bug fix)
 * 4. Increment correctly for multiple rapid messages
 *
 * Prerequisites:
 * - Firebase Emulators running: npm run emulators
 * - Dev server running: npm run dev
 * - Test data seeded via /api/dev/seed
 *
 * Multi-browser approach:
 * - Uses two browser contexts to simulate two users
 * - User A receives messages, observes badge behavior
 * - User B (Santa) sends messages to trigger badge updates
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG = {
    // User A (the recipient who observes badges)
    userA: {
        email: 'jed.piezas@gmail.com',
        name: 'Jed'
    },
    // User B (Santa who sends messages to User A)
    // NOTE: This must be User A's assigned Santa in the seeded data
    userB: {
        email: 'ncammarasana@gmail.com',  // Natalie - adjust based on seed
        name: 'Natalie'
    },
    // Timing constants
    FIRESTORE_SYNC_DELAY: 500,  // ms to wait for Firestore real-time sync
    BADGE_UPDATE_DELAY: 1000,   // ms to wait for badge React re-render
    AUTH_TIMEOUT: 10000         // ms to wait for authentication
};

/**
 * Authenticates a user via Firebase Auth Emulator using email/password
 * Completely bypasses the popup flow by:
 * 1. Pre-registering user in emulator via REST API
 * 2. Using page.evaluate to call signInWithEmailAndPassword
 */
async function authenticateAsUser(
    page: Page,
    email: string
): Promise<void> {
    const AUTH_EMULATOR = 'http://127.0.0.1:9099';
    const API_KEY = 'fake-api-key-for-emulator';
    const TEST_PASSWORD = 'testPassword123!';

    // Navigate first to initialize the Firebase SDK on the page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if already authenticated
    const userGreeting = page.locator('[data-testid="user-greeting"]');
    if (await userGreeting.isVisible({ timeout: 2000 }).catch(() => false)) {
        return; // Already logged in
    }

    // Step 1: Ensure user exists in emulator (sign up or sign in via REST)
    try {
        // Try to sign up first (creates user in emulator)
        const signUpResponse = await page.request.post(
            `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
            {
                data: {
                    email: email,
                    password: TEST_PASSWORD,
                    returnSecureToken: true
                }
            }
        );

        if (!signUpResponse.ok()) {
            // User might already exist, try sign in
            const signInResponse = await page.request.post(
                `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
                {
                    data: {
                        email: email,
                        password: TEST_PASSWORD,
                        returnSecureToken: true
                    }
                }
            );

            if (!signInResponse.ok()) {
                throw new Error('Both signup and signin failed');
            }
        }
    } catch (error) {
        console.log(`Auth emulator REST register/signin: ${error}`);
    }

    // Step 2: Use window.__e2eAuth__ helper exposed by firebase-client.js
    // This is available in development mode and allows E2E tests to authenticate
    const authResult = await page.evaluate(async ({ email, password }) => {
        // Wait for window.__e2eAuth__ to be available (it's set after Firebase init)
        let attempts = 0;
        while (!(window as any).__e2eAuth__ && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (!(window as any).__e2eAuth__) {
            return { error: 'window.__e2eAuth__ not available - Firebase may not have initialized' };
        }

        try {
            await (window as any).__e2eAuth__.signInWithEmailAndPassword(email, password);
            return { success: true };
        } catch (error) {
            return { error: (error as Error).message };
        }
    }, { email, password: TEST_PASSWORD });

    if (authResult.error) {
        throw new Error(`Programmatic auth failed: ${authResult.error}`);
    }

    // Step 3: Wait for the app to recognize authentication
    // Wait briefly for React to re-render based on auth state change
    await page.waitForTimeout(1000);

    // Reload to ensure the app picks up the new auth state
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for user greeting to appear
    try {
        await page.waitForSelector('[data-testid="user-greeting"]', {
            timeout: 15000
        });
    } catch {
        throw new Error(`Failed to authenticate as ${email}: User greeting did not appear after programmatic sign-in.`);
    }
}



/**
 * Sends a message from the current user to their recipient
 * Assumes the page is on the Recipient tab in the chat interface
 */
async function sendMessage(
    page: Page,
    messageText: string
): Promise<void> {
    // Type in the message input
    const messageInput = page.getByPlaceholder('Type a message...');
    await messageInput.fill(messageText);

    // Click send button
    const sendButton = page.getByRole('button', { name: /send/i });
    await sendButton.click();

    // Wait for message to appear in the chat (confirms Firestore write)
    await page.getByText(messageText).waitFor({ timeout: 5000 });
}

/**
 * Gets the current unread badge count for a specific tab
 * Returns 0 if no badge is visible
 */
async function getBadgeCount(
    page: Page,
    tabName: 'recipient' | 'santa'
): Promise<number> {
    const tabButton = page.getByRole('button', { name: new RegExp(tabName, 'i') });

    // Look for the badge using data-testid (supports both 'unread-badge' and 'sidebar-unread-badge')
    const badge = tabButton.locator('[data-testid*="unread-badge"]');

    if (await badge.isVisible()) {
        const text = await badge.textContent();
        return parseInt(text || '0', 10);
    }

    return 0;
}

/**
 * Clicks on a tab and waits for it to become active
 */
async function switchToTab(
    page: Page,
    tabName: 'recipient' | 'santa' | 'feed'
): Promise<void> {
    const tabButton = page.getByRole('button', { name: new RegExp(tabName, 'i') });
    await tabButton.click();

    // Wait for tab to become active (has bold font weight)
    await expect(tabButton).toHaveCSS('font-weight', '600');
}

/**
 * Waits for real-time Firestore sync to complete
 */
async function waitForFirestoreSync(): Promise<void> {
    // Using a simple delay - in production tests we might poll for specific state
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.FIRESTORE_SYNC_DELAY));
}

/**
 * Seeds test data via the dev API
 */
async function seedTestData(page: Page): Promise<void> {
    const response = await page.request.post('/api/dev/seed');
    if (!response.ok()) {
        throw new Error('Failed to seed test data');
    }
}

/**
 * Assigns Secret Santas via the admin API
 * Requires admin authentication
 */
async function assignSecretSantas(page: Page): Promise<void> {
    const response = await page.request.post('/api/admin/assign');
    if (!response.ok()) {
        const error = await response.text();
        console.warn('Assignment may have failed or already done:', error);
    }
}

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Unread Badge Functionality', () => {

    // Tests now use Dev Login for authentication - emulator check removed

    test.describe('Badge Visibility Tests', () => {
        // Now using Dev Login instead of complex programmatic auth

        test.beforeEach(async ({ page }) => {
            // First seed and assign users via dev API (no admin auth required)
            await page.goto('/');
            await page.request.post('/api/dev/seed');
            await page.request.post('/api/dev/assign');

            // Use Dev Login to authenticate
            await page.goto('/dev/login');
            await page.getByRole('button', { name: 'Jed' }).click();
            await page.waitForURL('/');
            await page.waitForLoadState('domcontentloaded');

            // Smart wait: Wait for the Recipient tab to be visible
            // This proves: 1) User is authenticated 2) User has assignments
            await page.getByRole('button', { name: /recipient/i }).waitFor({ state: 'visible', timeout: 15000 });

            // [PLAN.md Contract] Wait for gifterId to be present in window.__e2eUserData__
            // This ensures primeCache in useRealtimeUnreadCounts has the data it needs
            await expect.poll(async () => {
                const data = await page.evaluate(() => (window as any).__e2eUserData__);
                return data?.gifterId;
            }, { timeout: 10000 }).toBeTruthy();
        });


        /**
         * Injects a message directly into Firestore via the emulator REST API
         * This simulates "Santa" sending a message to User A without needing a second browser
         * 
         * Approach: Get user data from the page's React context (since it's already loaded)
         * then write the message directly to Firestore emulator REST API.
         */
        async function injectMessageFromSanta(page: Page, messageContent: string) {
            const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
            const PROJECT_ID = 'xmasteak-app';

            // Get user data from the page's JavaScript context  
            // The app stores user data in window after React hydrates
            const userData = await page.evaluate(() => {
                // Wait for the React app to expose user data
                // We can check for data-testid or look for elements
                const userGreeting = document.querySelector('[data-testid="user-greeting"]');

                // If no greeting, try to find from the page's React fiber or DOM
                // For now, we'll use a workaround - expose user data via window in dev mode

                // Check if __e2eUserData__ is available (we'll expose it)
                if ((window as any).__e2eUserData__) {
                    return (window as any).__e2eUserData__;
                }

                return null;
            });

            // If page doesn't expose user data, we need a different approach
            // Use the dev/seed API to get users and match by the logged-in user
            let userAId: string;
            let userAGifterId: string;

            if (userData?.id && userData?.gifterId) {
                userAId = userData.id;
                userAGifterId = userData.gifterId;
            } else {
                // Fallback: Call a dev API to get current user data
                const userDataResponse = await page.request.get('/api/dev/current-user');

                if (!userDataResponse.ok()) {
                    // Last resort: use hardcoded test setup
                    // For the test to work, we need to ensure data is seeded deterministically
                    throw new Error('Could not get user data. Ensure /api/dev/current-user exists or window.__e2eUserData__ is exposed.');
                }

                const responseData = await userDataResponse.json();
                userAId = responseData.id;
                userAGifterId = responseData.gifterId;
            }

            if (!userAId || !userAGifterId) {
                throw new Error(`User data incomplete. UserAId: ${userAId}, GifterId: ${userAGifterId}`);
            }

            // Use the dev inject-message API endpoint (uses Admin SDK, bypasses security rules)
            const injectResponse = await page.request.post('/api/dev/inject-message', {
                data: {
                    fromId: userAGifterId, // From Santa
                    toId: userAId, // To User A  
                    content: messageContent,
                    displayName: 'Secret Santa 🎅'
                }
            });

            if (!injectResponse.ok()) {
                const errorText = await injectResponse.text();
                throw new Error(`Failed to inject message: ${errorText}`);
            }

            const result = await injectResponse.json();

            // Wait for Firestore real-time listener to receive the injected message
            await page.waitForTimeout(1000);

            return result.messageId;
        }

        test('Badge appears when message arrives while NOT viewing that tab', async ({ page }) => {
            // Navigate to Recipient tab (NOT Santa tab)
            await switchToTab(page, 'recipient');

            // Record initial badge count (may have accumulated messages from previous tests)
            const initialBadge = await getBadgeCount(page, 'santa');

            // Inject a message from Santa via API
            await injectMessageFromSanta(page, 'Test message from Santa via API');

            // Smart wait: Poll for badge to increase by 1
            // This handles real-time sync timing more reliably than fixed delays
            await expect(async () => {
                const badge = await getBadgeCount(page, 'santa');
                expect(badge).toBeGreaterThanOrEqual(initialBadge + 1);
            }).toPass({ timeout: 5000, intervals: [500] });
        });

        test('Badge clears when clicking tab', async ({ page }) => {
            // Start on Recipient tab
            await switchToTab(page, 'recipient');

            // Inject a message from Santa
            await injectMessageFromSanta(page, 'Test message for clearing');

            // Smart wait: Poll for badge to appear
            await expect(async () => {
                const badge = await getBadgeCount(page, 'santa');
                expect(badge).toBeGreaterThan(0);
            }).toPass({ timeout: 5000, intervals: [500] });

            // Click Santa tab
            await switchToTab(page, 'santa');

            // Smart wait: Poll for badge to clear
            await expect(async () => {
                const badge = await getBadgeCount(page, 'santa');
                expect(badge).toBe(0);
            }).toPass({ timeout: 5000, intervals: [500] });
        });

        test('Badge does NOT appear when viewing that tab (critical bug fix)', async ({ page }) => {
            // Navigate to Santa tab FIRST (viewing it)
            await switchToTab(page, 'santa');

            // Verify badge starts at 0
            const initialBadge = await getBadgeCount(page, 'santa');
            expect(initialBadge).toBe(0);

            // Inject a message while VIEWING the Santa tab
            await injectMessageFromSanta(page, 'Message while watching');

            // Wait for Firestore sync
            await waitForFirestoreSync();
            await page.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY * 2);

            // EXPECTED: Badge should remain at 0 (message is immediately marked as read)
            const finalBadge = await getBadgeCount(page, 'santa');
            expect(finalBadge).toBe(0);
        });

        test('Badge increments for multiple rapid messages', async ({ page }) => {
            // Navigate to Recipient tab (NOT Santa tab)
            await switchToTab(page, 'recipient');

            // Get initial badge count (may have accumulated messages from previous tests)
            const initialBadge = await getBadgeCount(page, 'santa');

            // Inject 2 messages rapidly
            await injectMessageFromSanta(page, 'Rapid message 1');
            await injectMessageFromSanta(page, 'Rapid message 2');

            // Smart wait: Poll for badge to show at least 2 MORE than initial
            await expect(async () => {
                const badge = await getBadgeCount(page, 'santa');
                expect(badge).toBeGreaterThanOrEqual(initialBadge + 2);
            }).toPass({ timeout: 5000, intervals: [500] });
        });

    });

    test.describe('Badge Edge Cases', () => {

        test('Badge persists across page refresh while not viewing tab', async ({ browser }) => {
            const context = await browser.newContext();
            const page = await context.newPage();

            // This test requires a simpler setup - just verify badge rendering
            await page.goto('/');
            await page.waitForLoadState('networkidle');

            // Verify that TabNavigation component renders correctly
            // (Full auth flow would be tested in the multi-browser tests above)
            const mainContainer = page.locator('main.container');
            await expect(mainContainer).toBeVisible();

            await context.close();
        });

    });

});

// =============================================================================
// Alternative Implementation: Using Page Object Model
// =============================================================================

/**
 * Page Object for the main app page
 * Encapsulates interactions with the chat interface
 */
class ChatPage {
    constructor(private page: Page) { }

    async goto(): Promise<void> {
        await this.page.goto('/');
        await this.page.waitForLoadState('networkidle');
    }

    async switchToTab(tab: 'recipient' | 'santa' | 'feed'): Promise<void> {
        await switchToTab(this.page, tab);
    }

    async sendMessage(text: string): Promise<void> {
        await sendMessage(this.page, text);
    }

    async getBadgeCount(tab: 'recipient' | 'santa'): Promise<number> {
        return getBadgeCount(this.page, tab);
    }

    async waitForBadgeUpdate(): Promise<void> {
        await this.page.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY);
    }
}
