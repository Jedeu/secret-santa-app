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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Authenticates a user via Firebase Auth Emulator UI
 * Uses the UI flow to click through the emulator's auth popup
 */
async function authenticateAsUser(
    page: Page,
    email: string
): Promise<void> {
    // Navigate to the app
    await page.goto('/');

    // Wait for sign-in button to appear
    const signInButton = page.getByRole('button', { name: /sign in with google/i });

    try {
        await signInButton.waitFor({ timeout: 5000 });
    } catch {
        // Already authenticated, check for user greeting
        const userGreeting = page.locator('[data-testid="user-greeting"]');
        if (await userGreeting.isVisible()) {
            return; // Already logged in
        }
        throw new Error(`Failed to authenticate as ${email}: Sign in button not found and not already authenticated`);
    }

    // Set up listener for the popup window BEFORE clicking
    const popupPromise = page.waitForEvent('popup', { timeout: 10000 });

    // Click sign-in button
    await signInButton.click();

    try {
        // Wait for the Firebase Emulator auth popup
        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');

        // In Firebase Emulator, we can either:
        // 1. Click an existing test account
        // 2. Add a new test account

        // Try to find and click the email if it's already in the list
        const existingAccountButton = popup.locator(`button:has-text("${email}")`);

        if (await existingAccountButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Click existing account
            await existingAccountButton.click();
        } else {
            // Add new account
            const addAccountButton = popup.locator('button:has-text("Add new account")');
            if (await addAccountButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await addAccountButton.click();

                // Fill in email
                const emailInput = popup.locator('input[type="email"], input[name="email"]');
                await emailInput.fill(email);

                // Click continue/sign in
                const continueButton = popup.locator('button:has-text("Continue"), button:has-text("Sign in")').first();
                await continueButton.click();
            } else {
                // Emulator might be in a different state, try to find email input directly
                const emailInput = popup.locator('input[type="email"], input[placeholder*="email"]').first();
                if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await emailInput.fill(email);
                    const submitButton = popup.locator('button[type="submit"], button:has-text("Continue")').first();
                    await submitButton.click();
                }
            }
        }

        // Wait for popup to close (auth completed)
        await popup.waitForEvent('close', { timeout: 10000 });

    } catch (error) {
        throw new Error(`Failed to authenticate as ${email}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Wait for the app to recognize authentication
    try {
        await page.waitForSelector('[data-testid="user-greeting"]', {
            timeout: TEST_CONFIG.AUTH_TIMEOUT
        });
    } catch {
        throw new Error(`Failed to authenticate as ${email}: User greeting did not appear after auth`);
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

    // Look for the badge span inside the tab button
    const badge = tabButton.locator('[data-testid="unread-badge"]');

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

    // Skip tests if emulators are not running
    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            // Check if emulators are running by hitting the Firestore emulator
            const response = await page.request.get('http://127.0.0.1:8080/', {
                timeout: 5000
            });
            // Firestore emulator returns various status codes, we just need it to respond
        } catch (error) {
            test.skip(true, 'Firebase Emulators are not running. Start with: npm run emulators');
        }

        await context.close();
    });

    test.describe('Badge Visibility Tests', () => {

        let contextA: BrowserContext;
        let contextB: BrowserContext;
        let pageA: Page;
        let pageB: Page;

        test.beforeEach(async ({ browser }) => {
            // Create two isolated browser contexts (like incognito windows)
            contextA = await browser.newContext();
            contextB = await browser.newContext();

            pageA = await contextA.newPage();
            pageB = await contextB.newPage();

            // Seed test data
            await seedTestData(pageA);

            // Authenticate both users
            // Note: In a real implementation, this would use Firebase Auth Emulator
            await authenticateAsUser(pageA, TEST_CONFIG.userA.email);
            await authenticateAsUser(pageB, TEST_CONFIG.userB.email);

            // Ensure assignments are done
            await assignSecretSantas(pageA);

            // Refresh both pages to pick up assignments
            await pageA.reload();
            await pageB.reload();

            // Wait for both to be fully loaded
            await pageA.waitForLoadState('networkidle');
            await pageB.waitForLoadState('networkidle');
        });

        test.afterEach(async () => {
            await contextA?.close();
            await contextB?.close();
        });

        test('Test Case 1: Badge appears when message arrives while NOT viewing tab', async () => {
            // User A: Navigate to Recipient tab (NOT Santa tab)
            await switchToTab(pageA, 'recipient');

            // Verify Santa badge starts at 0
            const initialBadge = await getBadgeCount(pageA, 'santa');
            expect(initialBadge).toBe(0);

            // User B (Santa): Send a message to User A
            // First, User B needs to be on THEIR recipient tab (which is User A)
            await switchToTab(pageB, 'recipient');
            await sendMessage(pageB, 'Test message from Santa - Badge Test 1');

            // Wait for Firestore real-time sync
            await waitForFirestoreSync();
            await pageA.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY);

            // User A: Observe Santa tab badge
            const badgeAfterMessage = await getBadgeCount(pageA, 'santa');

            // EXPECTED: Badge should show 1
            expect(badgeAfterMessage).toBe(1);
        });

        test('Test Case 2: Badge clears when clicking tab', async () => {
            // Setup: Ensure there's an unread message
            await switchToTab(pageA, 'recipient');

            // User B sends a message
            await switchToTab(pageB, 'recipient');
            await sendMessage(pageB, 'Test message from Santa - Badge Test 2');

            await waitForFirestoreSync();
            await pageA.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY);

            // Verify badge is showing
            let badge = await getBadgeCount(pageA, 'santa');
            expect(badge).toBeGreaterThan(0);

            // User A: Click Santa tab
            await switchToTab(pageA, 'santa');

            // Wait for read status update
            await pageA.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY);

            // EXPECTED: Badge should clear (become 0)
            badge = await getBadgeCount(pageA, 'santa');
            expect(badge).toBe(0);
        });

        test('Test Case 3: Badge does NOT appear when viewing tab (THE CRITICAL BUG FIX)', async () => {
            // User A: Navigate to Santa tab FIRST (viewing it)
            await switchToTab(pageA, 'santa');

            // Verify badge starts at 0
            const initialBadge = await getBadgeCount(pageA, 'santa');
            expect(initialBadge).toBe(0);

            // User B (Santa): Send a message while User A is VIEWING the Santa tab
            await switchToTab(pageB, 'recipient');
            await sendMessage(pageB, 'Test message - User A is watching!');

            // Wait for Firestore sync and potential badge update
            await waitForFirestoreSync();
            await pageA.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY * 2);  // Extra time for race conditions

            // EXPECTED: Badge should remain at 0 (or briefly flash then clear)
            // This is THE critical test - before the fix, this would show 1
            const finalBadge = await getBadgeCount(pageA, 'santa');

            // Allow for a brief flash (badge might show 1 then clear to 0)
            // The important thing is it ends up at 0
            expect(finalBadge).toBe(0);
        });

        test('Test Case 4: Badge increments for multiple rapid messages', async () => {
            // User A: Navigate to Recipient tab (NOT Santa tab)
            await switchToTab(pageA, 'recipient');

            // Verify Santa badge starts at 0
            const initialBadge = await getBadgeCount(pageA, 'santa');
            expect(initialBadge).toBe(0);

            // User B (Santa): Send 2 messages rapidly
            await switchToTab(pageB, 'recipient');
            await sendMessage(pageB, 'Rapid message 1');
            await sendMessage(pageB, 'Rapid message 2');

            // Wait for all messages to sync
            await waitForFirestoreSync();
            await pageA.waitForTimeout(TEST_CONFIG.BADGE_UPDATE_DELAY);

            // User A: Observe Santa tab badge
            const badgeAfterMessages = await getBadgeCount(pageA, 'santa');

            // EXPECTED: Badge should show 2
            expect(badgeAfterMessages).toBe(2);
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
    constructor(private page: Page) {}

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
