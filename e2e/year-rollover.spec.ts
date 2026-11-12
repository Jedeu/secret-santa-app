import { test, expect, Page, Browser, APIRequestContext } from '@playwright/test';
import { PARTICIPANTS, getRoster } from '../src/lib/participants';
import { ADMIN_EMAILS } from '../src/lib/config';

/**
 * Year rollover (emulators only): Close 2025, browse the read-only archive, Start 2026
 * with the automatic recipient draw and the one-time recipient reveal.
 *
 * - Seed and assign 2025; exchange a message and a reaction.
 * - The admin closes 2025: another open browser shows the closed banner and the 2025
 *   archive with pairings and no composer, without a reload; sends get 409.
 * - The admin starts 2026: the other browser shows the recipient reveal with a new
 *   profile id, without a reload, naming the 2026 profile drawn as its recipient;
 *   "Browse past years" shows 2025 and "Back to current year" returns to the reveal.
 *   Before Continue, a reload and a second browser for the same participant show it
 *   again; the admin (when on the 2026 roster) sees it with "Close 2026".
 * - The participant excluded from 2026 sees Access Denied.
 * - Continue opens the chats and records the acknowledgment; the second browser leaves
 *   the reveal without a reload; a reload and a fresh browser show no reveal.
 * - A 2026 message sends from the Recipient tab; the retired /api/admin/reset returns 410.
 *
 * The emulator database is cleared before and after (this suite changes the lifecycle).
 * Participant names/emails are read from the source list; nothing personal is hardcoded.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';
const API_KEY = 'fake-api-key-for-emulator';
const DEV_PASSWORD = 'password123';
const DOCUMENTS = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

type Participant = { name: string; email: string };

const registry = PARTICIPANTS as Participant[];
const roster2025 = getRoster(2025) as Participant[];
const roster2026 = getRoster(2026) as Participant[];
const onRoster2026 = (p: Participant) => roster2026.some((r) => r.email === p.email);

const adminParticipant = registry.find((p) => ADMIN_EMAILS.includes(p.email.toLowerCase()));
const otherParticipant = roster2026.find((p) => p.email !== adminParticipant?.email);
const excludedParticipant = registry.find((p) => !onRoster2026(p));

async function clearEmulator(request: APIRequestContext): Promise<void> {
    const response = await request.delete(
        `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
    );
    expect(response.ok(), `emulator clear returned ${response.status()}`).toBeTruthy();
}

async function devLogin(page: Page, name: string): Promise<void> {
    await page.goto('/dev/login');
    await expect(page.getByRole('heading', { name: /dev login/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForURL('/', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
}

async function newLoggedInPage(browser: Browser, name: string): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await devLogin(page, name);
    return page;
}

async function currentUserData(page: Page): Promise<any> {
    return page.evaluate(() => (window as any).__e2eUserData__);
}

async function waitForAssignedUser(page: Page): Promise<{ id: string; recipientId: string; gifterId: string }> {
    await expect.poll(async () => {
        const data = await currentUserData(page);
        return Boolean(data?.id && data?.recipientId && data?.gifterId);
    }, { timeout: 20000 }).toBeTruthy();
    return currentUserData(page);
}

/** Id of a root (2025) message sent by `fromId`, read with emulator owner access. */
async function messageIdFrom(request: APIRequestContext, fromId: string): Promise<string | null> {
    const response = await request.post(`${DOCUMENTS}:runQuery`, {
        headers: { Authorization: 'Bearer owner' },
        data: {
            structuredQuery: {
                from: [{ collectionId: 'messages' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'fromId' },
                        op: 'EQUAL',
                        value: { stringValue: fromId },
                    },
                },
                limit: 1,
            },
        },
    });
    const rows = await response.json();
    const name = rows?.[0]?.document?.name;
    return name ? String(name).split('/').pop() ?? null : null;
}

/** Name of the profile years/{year}/users/{id}, read with emulator owner access. */
async function profileName(request: APIRequestContext, year: number, id: string): Promise<string | null> {
    const response = await request.get(`${DOCUMENTS}/years/${year}/users/${encodeURIComponent(id)}`, {
        headers: { Authorization: 'Bearer owner' },
    });
    if (!response.ok()) return null;
    const document = await response.json();
    return document?.fields?.name?.stringValue ?? null;
}

/** ID token for an emulator account created by dev login (for direct API calls). */
async function idTokenFor(request: APIRequestContext, email: string): Promise<string> {
    const response = await request.post(
        `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
        { data: { email, password: DEV_PASSWORD, returnSecureToken: true } }
    );
    expect(response.ok(), 'auth emulator sign-in must succeed').toBeTruthy();
    return (await response.json()).idToken;
}

test.describe('Year rollover', () => {
    test.beforeAll(async ({ playwright }) => {
        const request = await playwright.request.newContext();
        await clearEmulator(request);
        await request.dispose();
    });

    test.afterAll(async ({ playwright }) => {
        const request = await playwright.request.newContext();
        await clearEmulator(request);
        await request.dispose();
    });

    test('Close 2025, browse the archive, Start 2026', async ({ browser, request }) => {
        test.setTimeout(240000);
        expect(adminParticipant, 'an admin must be on the participant list').toBeTruthy();
        expect(otherParticipant, 'a non-admin must be on the 2026 roster').toBeTruthy();
        expect(excludedParticipant, 'the registry must contain someone outside the 2026 roster').toBeTruthy();

        // --- 2025: seed, assign, one message and one reaction ---
        const seed = await request.post('/api/dev/seed');
        expect(seed.ok(), `/api/dev/seed returned ${seed.status()}`).toBeTruthy();
        const assign = await request.post('/api/dev/assign');
        expect(assign.ok(), `/api/dev/assign returned ${assign.status()}`).toBeTruthy();

        const otherPage = await newLoggedInPage(browser, otherParticipant!.name);
        const before = await waitForAssignedUser(otherPage);

        const sidebar = otherPage.locator('.desktop-only');
        await sidebar.getByRole('button', { name: /recipient/i }).click();
        await otherPage.getByPlaceholder('Type a message...').fill('Synthetic 2025 rollover message');
        await otherPage.getByRole('button', { name: 'Send' }).click();
        await expect(otherPage.getByText('Synthetic 2025 rollover message').first()).toBeVisible({ timeout: 20000 });

        // Reaction fixture written with emulator owner access (rules bypassed).
        await expect.poll(() => messageIdFrom(request, before.id), { timeout: 15000 }).toBeTruthy();
        const messageId = (await messageIdFrom(request, before.id)) as string;
        const reaction = await request.post(
            `${DOCUMENTS}/reactions?documentId=${encodeURIComponent(`${messageId}_${before.recipientId}_👍`)}`,
            {
                headers: { Authorization: 'Bearer owner' },
                data: {
                    fields: {
                        messageId: { stringValue: messageId },
                        userId: { stringValue: before.recipientId },
                        emoji: { stringValue: '👍' },
                        createdAt: { stringValue: new Date().toISOString() },
                    },
                },
            }
        );
        expect(reaction.ok(), `reaction fixture returned ${reaction.status()}`).toBeTruthy();

        // --- Admin closes 2025 ---
        const adminPage = await newLoggedInPage(browser, adminParticipant!.name);
        await waitForAssignedUser(adminPage);
        adminPage.once('dialog', (dialog) => dialog.accept('2025'));
        await adminPage.locator('.desktop-only').getByRole('button', { name: 'Close 2025' }).click();
        await expect(adminPage.getByText('2025 is now closed (read-only).')).toBeVisible({ timeout: 30000 });

        // The other browser follows without a reload: banner, archive with pairings, no composer.
        await expect(otherPage.getByText(/The 2025 exchange is closed\./)).toBeVisible({ timeout: 30000 });
        await expect(otherPage.getByTestId('archive-viewer')).toBeVisible();
        await expect(otherPage.getByTestId('archive-pairing')).toHaveCount(roster2025.length, { timeout: 20000 });
        await expect(otherPage.getByPlaceholder('Type a message...')).toHaveCount(0);

        const otherToken = await idTokenFor(request, otherParticipant!.email);
        const closedSend = await request.post('/api/messages/send', {
            headers: { Authorization: `Bearer ${otherToken}` },
            data: { toId: before.recipientId, content: 'sent after close' },
        });
        expect(closedSend.status()).toBe(409);
        expect((await closedSend.json()).code).toBe('YEAR_CLOSED');

        // --- Admin starts 2026 ---
        adminPage.once('dialog', (dialog) => dialog.accept('2026'));
        await adminPage.getByRole('button', { name: 'Start 2026' }).click();
        await expect(adminPage.getByText('2026 has started.')).toBeVisible({ timeout: 30000 });

        // 1. The other browser shows the reveal with a new profile id, without a reload.
        await expect(otherPage.getByTestId('recipient-reveal')).toBeVisible({ timeout: 30000 });
        await expect.poll(async () => {
            const data = await currentUserData(otherPage);
            return Boolean(data?.id && data.id !== before.id && data.recipientId);
        }, { timeout: 15000 }).toBeTruthy();
        const drawn = await currentUserData(otherPage);

        // 2. The name shown is that of the 2026 profile drawn as this user's recipient.
        const recipientName = await profileName(request, 2026, drawn.recipientId);
        expect(recipientName, 'the drawn recipient must have a 2026 profile').toBeTruthy();
        await expect(otherPage.getByTestId('recipient-reveal-name')).toHaveText(recipientName!, { timeout: 20000 });

        // 3. Browse past years before confirming, then back to the reveal.
        await otherPage.getByRole('button', { name: 'Browse past years' }).click();
        await expect(otherPage.getByRole('heading', { name: '📚 2025 Archive' })).toBeVisible({ timeout: 20000 });
        await expect(otherPage.getByTestId('archive-pairing')).toHaveCount(roster2025.length, { timeout: 20000 });
        await otherPage.getByRole('button', { name: 'Back to current year' }).click();
        await expect(otherPage.getByTestId('recipient-reveal')).toBeVisible();
        await expect(otherPage.getByTestId('recipient-reveal-name')).toHaveText(recipientName!, { timeout: 20000 });

        // 4. Reloading before Continue shows the reveal again.
        await otherPage.reload();
        await otherPage.waitForLoadState('domcontentloaded');
        await expect(otherPage.getByTestId('recipient-reveal')).toBeVisible({ timeout: 30000 });
        await expect(otherPage.getByTestId('recipient-reveal-name')).toHaveText(recipientName!, { timeout: 20000 });

        // 5. A second browser for the same participant also shows it.
        const secondPage = await newLoggedInPage(browser, otherParticipant!.name);
        await expect(secondPage.getByTestId('recipient-reveal')).toBeVisible({ timeout: 30000 });
        await expect(secondPage.getByTestId('recipient-reveal-name')).toHaveText(recipientName!, { timeout: 20000 });

        // 6. An admin on the 2026 roster sees their own reveal with the Close control.
        if (onRoster2026(adminParticipant!)) {
            const adminReveal = adminPage.getByTestId('recipient-reveal');
            await expect(adminReveal).toBeVisible({ timeout: 30000 });
            await expect(adminReveal.getByRole('button', { name: 'Close 2026' })).toBeVisible();
        }

        // 7. The excluded participant sees Access Denied.
        const excludedPage = await newLoggedInPage(browser, excludedParticipant!.name);
        await expect(excludedPage.getByRole('heading', { name: 'Access Denied' })).toBeVisible({ timeout: 30000 });

        // 8. Continue opens the chats and records the acknowledgment; the second browser
        //    leaves the reveal without a reload.
        await otherPage.getByRole('button', { name: 'Continue' }).click();
        await expect(otherPage.getByTestId('recipient-reveal')).toHaveCount(0, { timeout: 30000 });
        await expect(otherPage.locator('.desktop-only').getByRole('button', { name: /recipient/i })).toBeVisible({ timeout: 20000 });
        await expect.poll(async () => {
            const data = await currentUserData(otherPage);
            return Boolean(data?.recipientId && data.revealAckRecipientId === data.recipientId);
        }, { timeout: 15000 }).toBeTruthy();
        await expect(secondPage.getByTestId('recipient-reveal')).toHaveCount(0, { timeout: 30000 });
        await expect(secondPage.locator('.desktop-only').getByRole('button', { name: /recipient/i })).toBeVisible({ timeout: 20000 });

        // 9. A reload shows no reveal.
        await otherPage.reload();
        await otherPage.waitForLoadState('domcontentloaded');
        await expect(otherPage.locator('.desktop-only').getByRole('button', { name: /recipient/i })).toBeVisible({ timeout: 30000 });
        await expect(otherPage.getByTestId('recipient-reveal')).toHaveCount(0);

        // 10. A fresh browser for the same participant shows no reveal; the chats are shown.
        const thirdPage = await newLoggedInPage(browser, otherParticipant!.name);
        await expect(thirdPage.locator('.desktop-only').getByRole('button', { name: /recipient/i })).toBeVisible({ timeout: 30000 });
        await expect(thirdPage.getByTestId('recipient-reveal')).toHaveCount(0);

        // 11. A 2026 message sends from the Recipient tab.
        await otherPage.locator('.desktop-only').getByRole('button', { name: /recipient/i }).click();
        await otherPage.getByPlaceholder('Type a message...').fill('Synthetic 2026 message');
        await otherPage.getByRole('button', { name: 'Send' }).click();
        await expect(otherPage.getByText('Synthetic 2026 message').first()).toBeVisible({ timeout: 20000 });

        // The retired reset.
        const reset = await request.post('/api/admin/reset');
        expect(reset.status()).toBe(410);
        expect((await reset.json()).code).toBe('RESET_RETIRED');

        await thirdPage.context().close();
        await secondPage.context().close();
        await excludedPage.context().close();
        await adminPage.context().close();
        await otherPage.context().close();
    });
});
