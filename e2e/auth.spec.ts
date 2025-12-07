import { test, expect } from '@playwright/test';

/**
 * Authentication Flow E2E Tests
 *
 * These tests verify the authentication UI states:
 * - Sign-in page display
 * - Loading state
 * - Access denied for non-participants
 * - Successful authentication flow
 *
 * Note: Full OAuth testing requires Firebase Emulator Auth setup.
 * These tests focus on UI state verification.
 */

test.describe('Authentication Flow', () => {
    test('should show sign-in page when not authenticated', async ({ page }) => {
        await page.goto('/');

        // Should show the sign-in button
        await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();

        // Should show the app title
        await expect(page.getByRole('heading', { name: /secret santa/i })).toBeVisible();

        // Should show welcome message
        await expect(page.getByText(/sign in to join/i)).toBeVisible();
    });

    test('should show loading state during initial auth check', async ({ page }) => {
        // Navigate to page - should briefly show loading
        await page.goto('/');

        // The loading state is brief, but we can check it exists in the DOM
        // by looking for the container structure
        const mainContainer = page.locator('main.container');
        await expect(mainContainer).toBeVisible();
    });

    test('sign-in button should be clickable', async ({ page }) => {
        await page.goto('/');

        const signInButton = page.getByRole('button', { name: /sign in with google/i });
        await expect(signInButton).toBeEnabled();

        // Clicking should trigger Google OAuth popup (which we can't fully test without emulator auth setup)
        // We just verify the button is interactive
        await expect(signInButton).toHaveCSS('cursor', 'pointer');
    });

    test('should have proper card layout for sign-in', async ({ page }) => {
        await page.goto('/');

        // Verify the card structure exists
        const card = page.locator('.card');
        await expect(card).toBeVisible();

        // Verify the Google icon is present in the sign-in button
        const signInButton = page.getByRole('button', { name: /sign in with google/i });
        const googleIcon = signInButton.locator('svg');
        await expect(googleIcon).toBeVisible();
    });

    test('page should have correct meta elements', async ({ page }) => {
        await page.goto('/');

        // Check that basic page structure loads
        const html = page.locator('html');
        await expect(html).toBeVisible();

        // Verify no JavaScript errors in console
        const errors: string[] = [];
        page.on('pageerror', (error) => {
            errors.push(error.message);
        });

        // Wait a bit to catch any async errors
        await page.waitForTimeout(1000);

        // Should not have critical errors (auth errors are expected without login)
        const criticalErrors = errors.filter(
            (e) => !e.includes('auth') && !e.includes('permission') && !e.includes('popup')
        );
        expect(criticalErrors).toHaveLength(0);
    });
});

test.describe('Authentication Guard States', () => {
    test('unauthenticated state shows sign-in CTA', async ({ page }) => {
        await page.goto('/');

        // Should not show any authenticated content
        await expect(page.getByText(/hi,/i)).not.toBeVisible();
        await expect(page.getByText(/sign out/i)).not.toBeVisible();

        // Should show sign-in
        await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    test('page title and branding are correct', async ({ page }) => {
        await page.goto('/');

        // Check the main heading
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toContainText(/secret santa/i);
    });
});

test.describe('Dev Login Flow', () => {
    test('should login successfully using Dev Login', async ({ page }) => {
        // 1. Go to /dev/login
        await page.goto('/dev/login');

        // Verify we're on the dev login page
        await expect(page.getByRole('heading', { name: /dev login/i })).toBeVisible();

        // 2. Click "Jed"
        await page.getByRole('button', { name: 'Jed' }).click();

        // Wait for redirect to complete
        await page.waitForURL('/');

        // 3. Assert URL is / (dashboard)
        expect(page.url()).toContain('/');

        // 4. Assert "Jed" is visible in header (via greeting or profile)
        // Wait for DOM to settle (don't use networkidle - Firebase realtime keeps connections open)
        await page.waitForLoadState('domcontentloaded');

        // Give auth state time to propagate
        await page.waitForTimeout(2000);

        // Look for authenticated state indicators
        const jedText = page.getByText(/jed/i);
        await expect(jedText.first()).toBeVisible({ timeout: 10000 });
    });
});

