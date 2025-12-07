import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Secret Santa E2E tests.
 *
 * Run with: npm run test:e2e
 * UI mode: npm run test:e2e:ui
 *
 * Requires:
 * - Firebase Emulators running: npm run emulators
 * - Dev server running: npm run dev
 */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry',
        // Screenshot on failure for debugging
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000, // 2 minutes to start server
    },
});
