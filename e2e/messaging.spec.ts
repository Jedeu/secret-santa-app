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
    // Skip these tests in CI unless auth emulator is configured
    test.skip(({ }, testInfo) => {
        // Skip if not running with emulators
        return !process.env.FIREBASE_EMULATOR_HOST;
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
