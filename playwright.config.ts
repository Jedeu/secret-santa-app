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
    // Serial execution for E2E tests - safer given shared database state with fixed users
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // Use single worker for serial execution per E2E testing strategy
    workers: 1,
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
        command: 'npm run dev -- --webpack',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000, // 2 minutes to start server
        env: {
            CLOUDINARY_CLOUD_NAME: 'e2e-sandbox',
            CLOUDINARY_API_KEY: 'e2e-key',
            CLOUDINARY_API_SECRET: 'e2e-secret',
            MEDIA_UPLOAD_API_BASE: 'http://127.0.0.1:8791',
        },
    },
});
