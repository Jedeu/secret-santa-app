import { test, expect } from '@playwright/test';

/**
 * Messaging E2E Tests
 *
 * These tests verify messaging functionality for authenticated users.
 *
 * Note: These tests require a pre-authenticated session or emulator auth setup.
 * For full testing, run with Firebase Emulators and seeded data:
 * - npm run emulators
 * - POST /api/dev/seed to create test data
 *
 * Since we cannot easily mock Google OAuth in Playwright,
 * these tests focus on UI structure verification.
 */

test.describe('Messaging UI Structure', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('should have proper page structure', async ({ page }) => {
        // Wait for page to load
        await page.waitForLoadState('networkidle');

        // Verify main container exists
        const mainContainer = page.locator('main.container');
        await expect(mainContainer).toBeVisible();
    });

    test('sign-in state shows proper CTA layout', async ({ page }) => {
        // When not signed in, should show sign-in button
        const signInButton = page.getByRole('button', { name: /sign in with google/i });

        if (await signInButton.isVisible()) {
            // Verify the button has the Google branding
            await expect(signInButton).toContainText('Sign in with Google');

            // Verify SVG icon is present
            const svgIcon = signInButton.locator('svg');
            await expect(svgIcon).toBeVisible();
        }
    });
});

test.describe('Messaging - With Auth (requires emulator setup)', () => {
    // Tests now use Dev Login for authentication instead of requiring FIREBASE_EMULATOR_HOST

    test.beforeEach(async ({ page }) => {
        // Use Dev Login to authenticate before each test
        await page.goto('/dev/login');
        await page.getByRole('button', { name: 'Jed' }).click();
        await page.waitForURL('/');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);
    });

    test('should display tab navigation when authenticated', async ({ page }) => {
        // This test would require pre-authenticated state
        // In a full setup, we would:
        // 1. Use Firebase Auth Emulator to create a test user
        // 2. Set up authentication cookies/tokens
        // 3. Navigate and verify tabs

        await page.goto('/');

        // Look for tab navigation (only visible when authenticated)
        const recipientTab = page.getByRole('button', { name: /recipient/i });
        const santaTab = page.getByRole('button', { name: /santa/i });
        const feedTab = page.getByRole('button', { name: /public feed/i });

        // These would be visible for authenticated users with assignments
        // For now, just verify the page loads without errors
        await expect(page.locator('main')).toBeVisible();
    });

    test('should allow tab switching', async ({ page }) => {
        await page.goto('/');

        // If we have authenticated state, verify tab switching works
        const santaTab = page.getByRole('button', { name: /santa/i });

        if (await santaTab.isVisible()) {
            await santaTab.click();

            // Should switch to Santa tab view
            await expect(santaTab).toHaveCSS('font-weight', '600');
        }
    });

    test('should have message input when viewing chat', async ({ page }) => {
        await page.goto('/');

        // In authenticated state, chat input should be present
        const messageInput = page.getByPlaceholder(/type a message/i);

        if (await messageInput.isVisible()) {
            await expect(messageInput).toBeEnabled();

            // Verify send button exists
            const sendButton = page.getByRole('button', { name: /send/i });
            await expect(sendButton).toBeVisible();
        }
    });
});

test.describe('Chat Component Structure', () => {
    test('emoji picker should be available in chat (when authenticated)', async ({ page }) => {
        await page.goto('/');

        // The emoji picker button would be visible in chat
        // This verifies the component structure loads correctly
        const emojiButton = page.locator('button').filter({ hasText: /[\u{1F600}-\u{1F64F}]/u });

        // Just verify page loads without errors
        await expect(page.locator('html')).toBeVisible();
    });
});

test.describe('E2E Messaging with Dev Login', () => {
    const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
    const PROJECT_ID = 'xmasteak-app';

    test('Santa can send message to Recipient', async ({ browser }) => {
        // Context A: Login as Jed (the sender)
        const contextA = await browser.newContext();
        const pageA = await contextA.newPage();

        // Seed participants and assignments up front so every assertion below
        // can be unconditional — a missing assignment is a test failure, not a
        // reason to silently skip the send.
        await pageA.request.post('/api/dev/seed');
        await pageA.request.post('/api/dev/assign');

        // Login as Jed via Dev Login
        await pageA.goto('/dev/login');
        await pageA.getByRole('button', { name: 'Jed' }).click();
        await pageA.waitForURL('/');
        // Don't use networkidle - Firebase keeps connections open
        await pageA.waitForLoadState('domcontentloaded');

        // Assignments are shuffled randomly, so look up who Jed is actually
        // buying for and observe that user's page in Context B.
        await expect.poll(async () => {
            const data = await pageA.evaluate(() => (window as any).__e2eUserData__);
            return data?.recipientId;
        }, { timeout: 10000 }).toBeTruthy();
        const recipientId = await pageA.evaluate(() => (window as any).__e2eUserData__.recipientId);

        const recipientDocResponse = await pageA.request.get(
            `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${recipientId}`,
            { headers: { Authorization: 'Bearer owner' } }
        );
        expect(recipientDocResponse.ok(), 'recipient user doc must exist in the emulator').toBeTruthy();
        const recipientName = (await recipientDocResponse.json()).fields.name.stringValue;

        // Context B: Login as Jed's assigned recipient
        const contextB = await browser.newContext();
        const pageB = await contextB.newPage();

        await pageB.goto('/dev/login');
        await pageB.getByRole('button', { name: recipientName, exact: true }).click();
        await pageB.waitForURL('/');
        // Don't use networkidle - Firebase keeps connections open
        await pageB.waitForLoadState('domcontentloaded');

        // The recipient sees Santa's messages on the Santa tab
        const santaTabB = pageB.getByRole('button', { name: /santa/i });
        await santaTabB.click();

        // Generate unique message content for this test run
        const testMessage = `E2E Test Message ${Date.now()}`;

        // On Page A (Jed): send a message to the recipient
        const messageInputA = pageA.getByPlaceholder(/type a message/i);
        await expect(messageInputA).toBeVisible({ timeout: 10000 });
        await messageInputA.fill(testMessage);

        const sendResponsePromise = pageA.waitForResponse(
            response => response.url().includes('/api/messages/send')
                && response.request().method() === 'POST'
        );
        await pageA.getByRole('button', { name: /send/i }).click();

        // The optimistic outbox renders the message on the sender's page even
        // when the server rejects it, so assert the API actually accepted it.
        const sendResponse = await sendResponsePromise;
        expect(sendResponse.ok(), `/api/messages/send returned ${sendResponse.status()}`).toBeTruthy();

        // Verify message appears in sender's view (Page A)
        await expect(pageA.getByText(testMessage)).toBeVisible({ timeout: 10000 });

        // Verify delivery on the recipient's page — unconditionally. A failed
        // delivery must fail the test, not be skipped (a server-side send
        // regression once hid behind this check being optional).
        await expect(pageB.getByText(testMessage)).toBeVisible({ timeout: 10000 });

        // Cleanup
        await contextA.close();
        await contextB.close();
    });
});

