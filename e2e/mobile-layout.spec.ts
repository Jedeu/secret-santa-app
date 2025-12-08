import { test, expect, Page } from '@playwright/test';

/**
 * Mobile Layout E2E Tests
 *
 * These tests verify the mobile-specific layout:
 * - Sidebar is hidden on mobile
 * - Mobile TabNavigation is visible
 * - Proper header layout
 */

test.use({ viewport: { width: 375, height: 667 } }); // Force Mobile Viewport (iPhone SE)

/**
 * Seeds test data and assigns users via the dev API
 */
async function seedAndAssign(page: Page): Promise<void> {
    // Seed users
    await page.request.post('/api/dev/seed');
    // Assign users (triggers random assignment)
    await page.request.post('/api/admin/assign');
}

test.describe('Mobile Layout', () => {
    test.beforeEach(async ({ page }) => {
        // Seed data before each test
        await seedAndAssign(page);

        // Use Dev Login to authenticate before each test
        await page.goto('/dev/login');
        await expect(page.getByRole('heading', { name: /dev login/i })).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Jed' }).click();

        // Wait for redirect and auth state to propagate
        await page.waitForURL('/', { timeout: 30000 });
        await page.waitForLoadState('domcontentloaded');

        // Wait for mobile header to appear (indicates user has recipientId assigned)
        // The mobile-only elements only appear after needsRecipient is false
        await expect(page.locator('.mobile-only').first()).toBeVisible({ timeout: 15000 });
    });

    test('hides Sidebar and displays Mobile Tabs', async ({ page }) => {
        // Verify Sidebar (desktop-only) is hidden
        const sidebar = page.locator('.desktop-only');
        await expect(sidebar).toBeHidden();

        // Verify Mobile navigation elements (mobile-only) are visible
        const mobileElements = page.locator('.mobile-only');
        await expect(mobileElements.first()).toBeVisible();
    });

    test('displays Mobile Header with user greeting', async ({ page }) => {
        // Verify mobile header is visible with user greeting
        const mobileHeader = page.locator('.mobile-header');
        await expect(mobileHeader).toBeVisible();
        await expect(mobileHeader.getByText(/hi, jed/i)).toBeVisible();
    });

    test('displays Mobile TabNavigation buttons', async ({ page }) => {
        // Verify tab navigation buttons are visible on mobile
        await expect(page.getByRole('button', { name: /recipient/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /santa/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /public feed/i })).toBeVisible();
    });

    test('Mobile header contains Sign out button', async ({ page }) => {
        // Verify Sign out is visible in mobile header
        const mobileHeader = page.locator('.mobile-header');
        await expect(mobileHeader.getByRole('button', { name: /sign out/i })).toBeVisible();
    });
});
