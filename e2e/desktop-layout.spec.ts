import { test, expect, Page } from '@playwright/test';

/**
 * Desktop Layout E2E Tests
 *
 * These tests verify the desktop-specific layout:
 * - Sidebar is visible when authenticated
 * - Mobile TabNavigation is hidden on desktop
 * - Proper layout alignment
 */

test.use({ viewport: { width: 1280, height: 720 } }); // Force Desktop Viewport

/**
 * Seeds test data and assigns users via the dev API
 */
async function seedAndAssign(page: Page): Promise<void> {
    // Seed users
    await page.request.post('/api/dev/seed');
    // Assign users via dev API (triggers random assignment without admin auth)
    await page.request.post('/api/dev/assign');
}

test.describe('Desktop Layout', () => {
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

        // Wait for gifterId to be present (ensures assignments propagated)
        await expect.poll(async () => {
            const data = await page.evaluate(() => (window as any).__e2eUserData__);
            return data?.gifterId;
        }, { timeout: 15000 }).toBeTruthy();

        // Wait for the sidebar to appear (indicates user has recipientId assigned)
        // The sidebar only appears after needsRecipient is false
        await expect(page.locator('.desktop-only')).toBeVisible({ timeout: 15000 });
    });

    test('displays Sidebar and hides Mobile Tabs', async ({ page }) => {
        // Verify Sidebar (desktop-only) is visible
        const sidebar = page.locator('.desktop-only');
        await expect(sidebar).toBeVisible();

        // Verify Mobile TabNavigation (mobile-only) elements are hidden
        // Use toHaveCount(0) with visible filter to handle multiple .mobile-only elements
        await expect(page.locator('.mobile-only >> visible=true')).toHaveCount(0);
    });

    test('Sidebar contains navigation items', async ({ page }) => {
        // Verify sidebar nav items are visible
        const sidebar = page.locator('.desktop-only');
        await expect(sidebar.getByRole('button', { name: /recipient/i })).toBeVisible();
        await expect(sidebar.getByRole('button', { name: /santa/i })).toBeVisible();
        await expect(sidebar.getByRole('button', { name: /public feed/i })).toBeVisible();
    });

    test('Sidebar displays user greeting', async ({ page }) => {
        // Verify "Hi, User" greeting is in the sidebar
        const sidebar = page.locator('.desktop-only');
        await expect(sidebar.getByText(/hi, jed/i)).toBeVisible();
    });

    test('Sidebar displays Sign out button', async ({ page }) => {
        // Verify Sign out is in the sidebar footer
        const sidebar = page.locator('.desktop-only');
        await expect(sidebar.getByRole('button', { name: /sign out/i })).toBeVisible();
    });
});
