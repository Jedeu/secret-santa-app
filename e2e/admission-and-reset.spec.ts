import { test, expect, Page, Browser } from '@playwright/test';
import { PARTICIPANTS } from '../src/lib/participants';
import { ADMIN_EMAILS } from '../src/lib/config';

/**
 * Admission and reset (emulators only).
 *
 * - An outsider account is denied by the Firestore rules and by /api/auth/bootstrap.
 * - A chat draft does not follow a tab switch.
 * - An admin reset from the desktop sidebar re-bootstraps another open browser to the
 *   Welcome screen with a new profile id, without a reload.
 *
 * Participant names/emails are read from the source list; nothing personal is hardcoded.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';
const API_KEY = 'fake-api-key-for-emulator';

type Participant = { name: string; email: string };

const participants = PARTICIPANTS as Participant[];
const adminParticipant = participants.find((p) => ADMIN_EMAILS.includes(p.email.toLowerCase()));
const otherParticipant = participants.find((p) => p !== adminParticipant);

async function seedAndAssign(page: Page): Promise<void> {
    const seed = await page.request.post('/api/dev/seed');
    expect(seed.ok(), `/api/dev/seed returned ${seed.status()}`).toBeTruthy();
    const assign = await page.request.post('/api/dev/assign');
    expect(assign.ok(), `/api/dev/assign returned ${assign.status()}`).toBeTruthy();
}

async function devLogin(page: Page, name: string): Promise<void> {
    await page.goto('/dev/login');
    await expect(page.getByRole('heading', { name: /dev login/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForURL('/', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
}

async function waitForAssignedUser(page: Page): Promise<{ id: string; recipientId: string; gifterId: string }> {
    await expect.poll(async () => {
        const data = await page.evaluate(() => (window as any).__e2eUserData__);
        return Boolean(data?.id && data?.recipientId && data?.gifterId);
    }, { timeout: 20000 }).toBeTruthy();
    return page.evaluate(() => (window as any).__e2eUserData__);
}

async function newLoggedInPage(browser: Browser, name: string): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await devLogin(page, name);
    return page;
}

test.describe('Admission and reset', () => {
    test('an outsider is denied by the Firestore rules and by /api/auth/bootstrap', async ({ page }) => {
        const email = `outsider-${Date.now()}@example.test`;
        const signUp = await page.request.post(
            `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
            { data: { email, password: 'outsider-password-1', returnSecureToken: true } }
        );
        expect(signUp.ok(), 'auth emulator sign-up must succeed').toBeTruthy();
        const { idToken } = await signUp.json();

        const usersRead = await page.request.get(
            `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users`,
            { headers: { Authorization: `Bearer ${idToken}` } }
        );
        expect(usersRead.status()).toBe(403);

        const bootstrap = await page.request.post('/api/auth/bootstrap', {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        expect(bootstrap.status()).toBe(403);
        expect((await bootstrap.json()).code).toBe('ACCESS_DENIED');
    });

    test('a draft does not follow a tab switch', async ({ page }) => {
        await page.goto('/');
        await seedAndAssign(page);
        await devLogin(page, otherParticipant!.name);
        await waitForAssignedUser(page);

        const sidebar = page.locator('.desktop-only');
        await sidebar.getByRole('button', { name: /recipient/i }).click();
        const input = page.getByPlaceholder('Type a message...');
        await input.fill('Draft that must not follow the tab');

        await sidebar.getByRole('button', { name: /santa/i }).click();
        await expect(page.getByText('Chat with your Santa')).toBeVisible();
        await expect(page.getByPlaceholder('Type a message...')).toHaveValue('');

        await sidebar.getByRole('button', { name: /recipient/i }).click();
        await expect(page.getByPlaceholder('Type a message...')).toHaveValue('');
    });

    test('an admin reset re-bootstraps another open browser to Welcome with a new profile id', async ({ browser }) => {
        expect(adminParticipant, 'an admin must be on the participant list').toBeTruthy();

        const setupPage = await browser.newPage();
        await setupPage.goto('/');
        await seedAndAssign(setupPage);
        await setupPage.close();

        const adminPage = await newLoggedInPage(browser, adminParticipant!.name);
        await waitForAssignedUser(adminPage);

        const otherPage = await newLoggedInPage(browser, otherParticipant!.name);
        const before = await waitForAssignedUser(otherPage);

        adminPage.on('dialog', (dialog) => dialog.accept());
        await adminPage.getByTitle('Reset App Data').click();
        await expect(adminPage.getByText('System reset successfully.')).toBeVisible({ timeout: 30000 });

        // No reload of the other browser.
        await expect(otherPage.getByText(`Welcome, ${otherParticipant!.name}!`)).toBeVisible({ timeout: 30000 });
        await expect.poll(async () => {
            const data = await otherPage.evaluate(() => (window as any).__e2eUserData__);
            return data?.id && data.id !== before.id;
        }, { timeout: 15000 }).toBeTruthy();

        await adminPage.context().close();
        await otherPage.context().close();
    });
});
