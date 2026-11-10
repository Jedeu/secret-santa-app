import { test, expect, Page, BrowserContext, Route, Request } from '@playwright/test';
import { PARTICIPANTS } from '../src/lib/participants';

/**
 * Message outbox across tabs (emulators only). Two pages of the same browser context
 * run the new code and share localStorage and auth. Requests to /api/messages/send are
 * intercepted with page.route so they can be held, released or failed.
 *
 * Participant names are read from the source list; nothing personal is hardcoded.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';
const SEND_ROUTE = '**/api/messages/send';
const V1_KEY = 'secret-santa-message-outbox-v1';

type Participant = { name: string; email: string };
const participants = PARTICIPANTS as Participant[];
const firstName = participants[1].name;
const secondName = participants[2].name;

type HeldRequest = { route: Route; body: any; authorization: string };

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

async function seedAndAssign(page: Page): Promise<void> {
    expect((await page.request.post('/api/dev/seed')).ok()).toBeTruthy();
    expect((await page.request.post('/api/dev/assign')).ok()).toBeTruthy();
}

async function devLogin(page: Page, name: string): Promise<void> {
    await page.goto('/dev/login');
    await expect(page.getByRole('heading', { name: /dev login/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForURL('/', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
}

async function waitForAssignedUser(page: Page) {
    await expect.poll(async () => {
        const data = await page.evaluate(() => (window as any).__e2eUserData__);
        return Boolean(data?.id && data?.recipientId && data?.gifterId);
    }, { timeout: 20000 }).toBeTruthy();
    return page.evaluate(() => (window as any).__e2eUserData__);
}

async function openTwoTabs(context: BrowserContext, name: string): Promise<[Page, Page]> {
    const page1 = await context.newPage();
    await page1.goto('/');
    await seedAndAssign(page1);
    await devLogin(page1, name);
    await waitForAssignedUser(page1);

    const page2 = await context.newPage();
    await page2.goto('/');
    await waitForAssignedUser(page2);
    return [page1, page2];
}

async function openRecipientChat(page: Page): Promise<void> {
    await page.locator('.desktop-only').getByRole('button', { name: /recipient/i }).click();
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
}

async function typeAndSend(page: Page, content: string): Promise<void> {
    await page.getByPlaceholder('Type a message...').fill(content);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function triggerDrain(page: Page): Promise<void> {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

async function messageDocsWithContent(page: Page, content: string): Promise<any[]> {
    const response = await page.request.get(
        `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/messages?pageSize=1000`,
        { headers: { Authorization: 'Bearer owner' } }
    );
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    return (json.documents || []).filter((doc: any) => doc.fields?.content?.stringValue === content);
}

function tokenUid(authorization: string): string {
    const jwt = authorization.replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return payload.user_id || payload.sub;
}

function bodyOf(request: Request): any {
    try {
        return request.postDataJSON();
    } catch {
        return null;
    }
}

test.describe('Outbox across tabs', () => {
    test('(a) B enqueued while A is held is not lost and is delivered after A', async ({ context }) => {
        const [page1, page2] = await openTwoTabs(context, firstName);
        const contentA = `Outbox A ${Date.now()}`;
        const contentB = `Outbox B ${Date.now()}`;

        const held: HeldRequest[] = [];
        await context.route(SEND_ROUTE, async (route) => {
            held.push({ route, body: bodyOf(route.request()), authorization: route.request().headers().authorization });
        });

        await openRecipientChat(page1);
        await openRecipientChat(page2);
        await typeAndSend(page1, contentA);
        await expect.poll(() => held.filter((h) => h.body?.content === contentA).length).toBeGreaterThan(0);

        await typeAndSend(page2, contentB);

        // B's queued payload survives while A's request is in flight (each item is its own key).
        await expect.poll(() => page1.evaluate(() => Object.keys(window.localStorage)
            .filter((key) => key.startsWith('secret-santa-message-outbox-v2:item:')).length)).toBe(2);

        // Release A first; new requests (B) then go straight to the server.
        await context.unroute(SEND_ROUTE);
        for (const h of held.filter((entry) => entry.body?.content === contentA)) {
            await h.route.continue().catch(() => {});
        }
        await expect.poll(async () => (await messageDocsWithContent(page1, contentA)).length, { timeout: 15000 }).toBe(1);
        for (const h of held.filter((entry) => entry.body?.content === contentB)) {
            await h.route.continue().catch(() => {});
        }
        await expect.poll(async () => {
            await triggerDrain(page2);
            return (await messageDocsWithContent(page1, contentB)).length;
        }, { timeout: 30000, intervals: [1000] }).toBe(1);

        const [docA] = await messageDocsWithContent(page1, contentA);
        const [docB] = await messageDocsWithContent(page1, contentB);
        expect(Date.parse(docB.fields.timestamp.stringValue)).toBeGreaterThanOrEqual(Date.parse(docA.fields.timestamp.stringValue));
        await expect(page2.getByText(contentB)).toBeVisible();
    });

    test('(b) tab 1 delivers X, then tab 2 gets 503 for X: no pending bubble and no further request', async ({ context }) => {
        const [page1, page2] = await openTwoTabs(context, firstName);
        const contentX = `Outbox X ${Date.now()}`;
        await openRecipientChat(page1);
        await openRecipientChat(page2);

        const page1Gate = deferred();
        const page2Gate = deferred();
        const page2Reached = deferred();
        let page2Requests = 0;

        await page1.route(SEND_ROUTE, async (route) => {
            await page1Gate.promise;
            await route.continue();
        });
        await page2.route(SEND_ROUTE, async (route) => {
            if (bodyOf(route.request())?.content === contentX) {
                page2Requests += 1;
                page2Reached.resolve();
                await page2Gate.promise;
                await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated outage' }) });
                return;
            }
            await route.continue();
        });

        await typeAndSend(page1, contentX);
        await triggerDrain(page2);
        await page2Reached.promise;

        const page1Response = page1.waitForResponse((response) => response.url().includes('/api/messages/send'));
        page1Gate.resolve();
        expect((await page1Response).ok()).toBeTruthy();

        page2Gate.resolve();

        await expect.poll(async () => (await messageDocsWithContent(page1, contentX)).length, { timeout: 15000 }).toBe(1);
        await expect(page2.getByText('Sending...')).toHaveCount(0, { timeout: 10000 });
        await expect(page2.getByText('Failed to send')).toHaveCount(0);

        const before = page2Requests;
        await triggerDrain(page2);
        await triggerDrain(page1);
        await page2.waitForTimeout(3000);
        await triggerDrain(page2);
        await page2.waitForTimeout(1000);
        expect(page2Requests).toBe(before);
        expect(await messageDocsWithContent(page1, contentX)).toHaveLength(1);
    });

    test('(c) a seeded v1 item with two open pages becomes exactly one message; v1 is unchanged', async ({ context }) => {
        const [page1, page2] = await openTwoTabs(context, firstName);
        const user = await waitForAssignedUser(page1);
        const content = `Legacy v1 ${Date.now()}`;

        const v1 = await page1.evaluate(({ user, content, key }) => {
            const entry = {
                clientMessageId: crypto.randomUUID(),
                fromUserId: user.id,
                toId: user.recipientId,
                conversationId: `santa_${user.id}_recipient_${user.recipientId}`,
                content,
                createdAt: new Date().toISOString(),
                attemptCount: 0,
                nextAttemptAt: new Date().toISOString(),
                status: 'pending',
                lastError: null,
            };
            const raw = JSON.stringify([entry]);
            window.localStorage.setItem(key, raw);
            return raw;
        }, { user, content, key: V1_KEY });

        await Promise.all([page1.reload(), page2.reload()]);
        await triggerDrain(page1);
        await triggerDrain(page2);

        await expect.poll(async () => (await messageDocsWithContent(page1, content)).length, { timeout: 20000 }).toBe(1);
        await page1.waitForTimeout(2000);
        expect(await messageDocsWithContent(page1, content)).toHaveLength(1);
        expect(await page1.evaluate((key) => window.localStorage.getItem(key), V1_KEY)).toBe(v1);
        expect(await page2.evaluate((key) => window.localStorage.getItem(key), V1_KEY)).toBe(v1);
    });

    test('(d) with all sends failing the item survives a reload and is delivered once unblocked', async ({ context }) => {
        const [page1] = await openTwoTabs(context, firstName);
        const content = `Survives reload ${Date.now()}`;

        await context.route(SEND_ROUTE, (route) => route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Simulated outage' }),
        }));

        await openRecipientChat(page1);
        await typeAndSend(page1, content);
        await expect(page1.getByText(content)).toBeVisible();
        await expect(page1.getByText('Sending...')).toBeVisible();

        await page1.reload();
        await waitForAssignedUser(page1);
        await openRecipientChat(page1);
        await expect(page1.getByText(content)).toBeVisible();

        await context.unroute(SEND_ROUTE);
        await expect.poll(async () => {
            await triggerDrain(page1);
            return (await messageDocsWithContent(page1, content)).length;
        }, { timeout: 60000, intervals: [2000] }).toBe(1);

        await page1.waitForTimeout(2000);
        expect(await messageDocsWithContent(page1, content)).toHaveLength(1);
    });

    test('(e) after sign-out and sign-in as another user, every request for a held item carries the original uid', async ({ context }) => {
        const [page1] = await openTwoTabs(context, firstName);
        const content = `Account switch ${Date.now()}`;
        const requests: HeldRequest[] = [];
        const gate = deferred();

        await context.route(SEND_ROUTE, async (route) => {
            const entry = { route, body: bodyOf(route.request()), authorization: route.request().headers().authorization };
            requests.push(entry);
            if (entry.body?.content === content) {
                await gate.promise;
            }
            await route.continue().catch(() => {});
        });

        await openRecipientChat(page1);
        await typeAndSend(page1, content);
        await expect.poll(() => requests.filter((r) => r.body?.content === content).length).toBeGreaterThan(0);
        const originalUid = tokenUid(requests.find((r) => r.body?.content === content)!.authorization);

        await page1.locator('.desktop-only').getByRole('button', { name: 'Sign out' }).click();
        await expect(page1.getByRole('button', { name: /sign in with google/i })).toBeVisible({ timeout: 15000 });

        // Sign in as another participant in the same page realm (keeps the held request's
        // drain alive); fall back to the dev login page if that account has another password.
        const secondEmail = participants[2].email;
        const signedIn = await page1.evaluate(async (email) => {
            try {
                await (window as any).__e2eAuth__.signInWithEmailAndPassword(email, 'password123');
                return true;
            } catch {
                return false;
            }
        }, secondEmail);
        if (!signedIn) {
            await devLogin(page1, secondName);
        }
        await waitForAssignedUser(page1);
        await expect.poll(() => page1.evaluate(() => (window as any).__e2eUserData__?.email)).toBe(secondEmail);

        gate.resolve();
        await triggerDrain(page1);
        await page1.waitForTimeout(3000);
        await triggerDrain(page1);
        await page1.waitForTimeout(1000);

        const forItem = requests.filter((r) => r.body?.content === content);
        expect(forItem.length).toBeGreaterThan(0);
        forItem.forEach((r) => expect(tokenUid(r.authorization)).toBe(originalUid));
        await context.unroute(SEND_ROUTE);
    });
});
