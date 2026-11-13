import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { PARTICIPANTS } from '../src/lib/participants';
import { sniffImage } from '../src/lib/message-media';
import { startFakeMediaProvider, FakeMediaProvider, RecordedUpload } from './support/fake-media-provider';
import { buildAnimatedGif, encodeUncompressedLzw, makeStillInPage, pasteImage } from './support/synthetic-images';

/**
 * Image and GIF attachments end to end (emulators only, stub provider only).
 *
 * The dev server runs with the sandbox variables from playwright.config.ts, so uploads
 * go to the loopback fake provider started here on 127.0.0.1:8791. Each test first
 * checks GET /api/messages/media with an emulator token and continues only when the
 * route reports { enabled: true, sandbox: true }: locally it skips otherwise (for
 * example a reused dev server without the sandbox variables), and on CI it fails.
 * Delivery URLs on res.cloudinary.com/e2e-sandbox are answered from the recorded
 * uploads; any other cloudinary.com request is aborted and counted (must stay 0).
 *
 * Participant names are read from the source list; nothing personal is hardcoded.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';
const PROVIDER_PORT = 8791;
const CDN_ROUTE = 'https://res.cloudinary.com/e2e-sandbox/image/upload/**';
const OTHER_CLOUDINARY = /^https?:\/\/([^/]*\.)?cloudinary\.com\//;
const MEDIA_ITEM_PREFIX = 'secret-santa-message-outbox-v2:media-item:';
const PUBLIC_ID_PATTERN = /^ss-\d{4}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ONE_MIB = 1024 * 1024;

type Participant = { name: string; email: string };
const participants = PARTICIPANTS as Participant[];
const firstName = participants[1].name;

let provider: FakeMediaProvider | undefined;
let otherCloudinaryRequests = 0;

async function newMediaContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    // Registered first so the fake CDN route below (registered last) takes precedence.
    await context.route(OTHER_CLOUDINARY, async (route) => {
        otherCloudinaryRequests += 1;
        await route.abort();
    });
    await context.route(CDN_ROUTE, async (route) => {
        const url = new URL(route.request().url());
        const last = decodeURIComponent(url.pathname.split('/').pop() || '');
        const publicId = last.replace(/\.[A-Za-z0-9]+$/, '');
        const upload = provider?.uploads.get(publicId);
        if (upload) {
            await route.fulfill({
                status: 200,
                contentType: upload.mimeType,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: upload.bytes,
            });
            return;
        }
        await route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
    });
    return context;
}

function captureBearer(page: Page): () => string | null {
    let latest: string | null = null;
    page.on('request', (request) => {
        const header = request.headers().authorization;
        if (header && header.startsWith('Bearer ') && new URL(request.url()).pathname.startsWith('/api/')) {
            latest = header;
        }
    });
    return () => latest;
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

/**
 * Guard: continue only when the media route reports the loopback sandbox.
 */
async function requireSandbox(page: Page, bearer: () => string | null): Promise<void> {
    await expect.poll(() => bearer(), { timeout: 20000 }).toBeTruthy();
    const response = await page.request.get('/api/messages/media', { headers: { Authorization: bearer()! } });
    const body = response.ok() ? await response.json() : null;
    if (body?.enabled === true && body?.sandbox === true) {
        return;
    }
    const reason = `Media sandbox is not active on this dev server (status ${response.status()}, body ${JSON.stringify(body)}).`;
    if (process.env.CI) {
        throw new Error(reason);
    }
    test.skip(true, reason);
}

async function openSignedIn(context: BrowserContext, name: string) {
    const page = await context.newPage();
    const bearer = captureBearer(page);
    await page.goto('/');
    await seedAndAssign(page);
    await devLogin(page, name);
    const user = await waitForAssignedUser(page);
    await requireSandbox(page, bearer);
    return { page, user };
}

async function openRecipientChat(page: Page): Promise<void> {
    await page.locator('.desktop-only').getByRole('button', { name: /recipient/i }).click();
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach image' })).toBeVisible({ timeout: 15000 });
}

async function emulatorGet(page: Page, path: string): Promise<any> {
    const response = await page.request.get(
        `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
        { headers: { Authorization: 'Bearer owner' } }
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
}

async function messageDocs(page: Page): Promise<any[]> {
    return (await emulatorGet(page, 'messages?pageSize=1000')).documents || [];
}

function attachmentPublicId(doc: any): string | null {
    return doc?.fields?.attachment?.mapValue?.fields?.publicId?.stringValue ?? null;
}

async function messagesWithContent(page: Page, content: string): Promise<any[]> {
    return (await messageDocs(page)).filter((doc) => doc.fields?.content?.stringValue === content);
}

async function messagesWithPublicId(page: Page, publicId: string): Promise<any[]> {
    return (await messageDocs(page)).filter((doc) => attachmentPublicId(doc) === publicId);
}

async function userName(page: Page, id: string): Promise<string> {
    return (await emulatorGet(page, `users/${id}`)).fields.name.stringValue;
}

function uploadsSince(count: number): RecordedUpload[] {
    return Array.from(provider!.uploads.values()).slice(count);
}

function attachmentImage(page: Page, publicId: string) {
    return page.locator(`img[data-testid="message-attachment"][src*="${publicId}."]`);
}

async function mediaOutboxKeys(page: Page): Promise<string[]> {
    return page.evaluate((prefix) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)), MEDIA_ITEM_PREFIX);
}

test.describe.serial('Image and GIF attachments', () => {
    test.beforeAll(async () => {
        provider = await startFakeMediaProvider({ port: PROVIDER_PORT });
    });

    test.afterAll(async () => {
        await provider?.close();
    });

    test.beforeEach(() => {
        otherCloudinaryRequests = 0;
    });

    test.afterEach(() => {
        expect(otherCloudinaryRequests).toBe(0);
    });

    test('synthetic fixtures self-check (no server involved)', () => {
        expect(encodeUncompressedLzw([0, 0, 0, 0]).toString('hex')).toBe('040814');
        expect(encodeUncompressedLzw([1, 1, 1, 1]).toString('hex')).toBe('4c9814');
        expect(sniffImage(new Uint8Array(buildAnimatedGif()))).toEqual({
            mimeType: 'image/gif',
            format: 'gif',
            width: 64,
            height: 64,
        });
    });

    test('still by paste (PNG path): preview, remove, then one upload delivered to both sides and the feed', async ({ browser }) => {
        const context = await newMediaContext(browser);
        let recipientContext: BrowserContext | null = null;
        try {
            const { page, user } = await openSignedIn(context, firstName);
            await openRecipientChat(page);
            const png = await makeStillInPage(page, { width: 2400, height: 1800, type: 'image/png' });
            const before = provider!.uploads.size;

            await pasteImage(page, png, 'image/png');
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 15000 });
            await page.getByRole('button', { name: 'Remove image' }).click();
            await expect(page.getByTestId('composer-attachment')).toHaveCount(0);
            expect(provider!.uploads.size).toBe(before);

            await pasteImage(page, png, 'image/png');
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 15000 });
            const caption = `Media caption ${Date.now()}`;
            await page.getByPlaceholder('Type a message...').fill(caption);
            await page.getByRole('button', { name: 'Send', exact: true }).click();

            await expect.poll(async () => (await messagesWithContent(page, caption)).length, { timeout: 20000 }).toBe(1);
            const added = uploadsSince(before);
            expect(added).toHaveLength(1);
            const [upload] = added;
            expect(upload.authorization).toMatch(/^Basic /);
            expect(upload.publicId).toMatch(PUBLIC_ID_PATTERN);
            expect(upload.fileName).toBe('upload');
            expect(upload.mimeType).toBe('image/png');
            expect(sniffImage(new Uint8Array(upload.bytes))).toMatchObject({ format: 'png', width: 1600, height: 1200 });

            const [doc] = await messagesWithContent(page, caption);
            expect(attachmentPublicId(doc)).toBe(upload.publicId);

            const senderImage = attachmentImage(page, upload.publicId);
            await expect(senderImage).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(caption)).toBeVisible();
            await expect.poll(() => senderImage.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15000 }).toBe(1600);

            // Control for the GIF animation check: a still image does not change.
            const first = await senderImage.screenshot();
            await page.waitForTimeout(1500);
            const second = await senderImage.screenshot();
            expect(first.equals(second)).toBe(true);

            recipientContext = await newMediaContext(browser);
            const recipientPage = await recipientContext.newPage();
            const recipientName = await userName(page, user.recipientId);
            await recipientPage.goto('/');
            await devLogin(recipientPage, recipientName);
            await waitForAssignedUser(recipientPage);
            await recipientPage.locator('.desktop-only').getByRole('button', { name: /santa/i }).click();
            await expect(recipientPage.getByText(caption)).toBeVisible({ timeout: 20000 });
            await expect(attachmentImage(recipientPage, upload.publicId)).toBeVisible({ timeout: 15000 });

            await page.locator('.desktop-only').getByRole('button', { name: /public feed/i }).click();
            await expect(page.getByText(`📷 ${caption}`)).toBeVisible({ timeout: 15000 });
        } finally {
            await recipientContext?.close();
            await context.close();
        }
    });

    test('still by file input (JPEG path): re-encoded to at most 1600 px and 1 MiB', async ({ browser }) => {
        const context = await newMediaContext(browser);
        try {
            const { page } = await openSignedIn(context, firstName);
            await openRecipientChat(page);
            const jpeg = await makeStillInPage(page, { width: 3000, height: 2000, type: 'image/jpeg', quality: 0.95, noisy: true });
            const before = provider!.uploads.size;

            await page.getByTestId('composer-file-input').setInputFiles({ name: 'synthetic-photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 20000 });
            const caption = `JPEG caption ${Date.now()}`;
            await page.getByPlaceholder('Type a message...').fill(caption);
            await page.getByRole('button', { name: 'Send', exact: true }).click();

            await expect.poll(async () => (await messagesWithContent(page, caption)).length, { timeout: 20000 }).toBe(1);
            const added = uploadsSince(before);
            expect(added).toHaveLength(1);
            const [upload] = added;
            const parsed = sniffImage(new Uint8Array(upload.bytes));
            expect(upload.mimeType).toBe('image/jpeg');
            expect(parsed?.format).toBe('jpg');
            expect(Math.max(parsed!.width, parsed!.height)).toBeLessThanOrEqual(1600);
            expect(upload.bytes.length).toBeLessThanOrEqual(ONE_MIB);
            expect(upload.bytes.equals(jpeg)).toBe(false);
            await expect(attachmentImage(page, upload.publicId)).toBeVisible({ timeout: 15000 });
        } finally {
            await context.close();
        }
    });

    test('GIF by file input, media-only: exact bytes uploaded, delivered and animating', async ({ browser }) => {
        const context = await newMediaContext(browser);
        try {
            const { page } = await openSignedIn(context, firstName);
            await openRecipientChat(page);
            const gif = buildAnimatedGif();
            const before = provider!.uploads.size;

            await page.getByTestId('composer-file-input').setInputFiles({ name: 'synthetic.gif', mimeType: 'image/gif', buffer: gif });
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 15000 });
            await page.getByRole('button', { name: 'Send', exact: true }).click();

            await expect.poll(() => uploadsSince(before).length, { timeout: 20000 }).toBe(1);
            const [upload] = uploadsSince(before);
            expect(upload.bytes.equals(gif)).toBe(true);
            expect(upload.fileName).toBe('upload');
            expect(upload.mimeType).toBe('image/gif');

            await expect.poll(async () => (await messagesWithPublicId(page, upload.publicId)).length, { timeout: 20000 }).toBe(1);
            const [doc] = await messagesWithPublicId(page, upload.publicId);
            expect(doc.fields.content.stringValue).toBe('');

            const image = attachmentImage(page, upload.publicId);
            await expect(image).toBeVisible({ timeout: 15000 });
            await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15000 }).toBe(64);
            expect(await image.getAttribute('src')).toMatch(/\.gif$/);

            // Delivered bytes, read through CORS from the fake CDN.
            const delivered = await image.evaluate(async (img: HTMLImageElement) => {
                const response = await fetch(img.currentSrc, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
                const buffer = await response.arrayBuffer();
                return Array.from(new Uint8Array(buffer));
            });
            expect(Buffer.from(delivered).equals(gif)).toBe(true);

            // Animation: a later screenshot differs from the first.
            const first = await image.screenshot();
            await expect.poll(async () => (await image.screenshot()).equals(first), { timeout: 5000, intervals: [200] }).toBe(false);
        } finally {
            await context.close();
        }
    });

    test('failure then retry: no message or outbox item after the failure; one message after Send again', async ({ browser }) => {
        const context = await newMediaContext(browser);
        try {
            const { page } = await openSignedIn(context, firstName);
            await openRecipientChat(page);
            const png = await makeStillInPage(page, { width: 400, height: 300, type: 'image/png' });
            const caption = `Retry caption ${Date.now()}`;

            provider!.failNext(500);
            await pasteImage(page, png, 'image/png');
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 15000 });
            await page.getByPlaceholder('Type a message...').fill(caption);
            await page.getByRole('button', { name: 'Send', exact: true }).click();

            await expect(page.getByTestId('composer-attachment-status')).toHaveText('Upload failed. Press Send to try again.', { timeout: 20000 });
            expect(await messagesWithContent(page, caption)).toHaveLength(0);
            expect(await mediaOutboxKeys(page)).toEqual([]);
            await expect(page.getByPlaceholder('Type a message...')).toHaveValue(caption);

            await page.getByRole('button', { name: 'Send', exact: true }).click();
            await expect.poll(async () => (await messagesWithContent(page, caption)).length, { timeout: 20000 }).toBe(1);
            await page.waitForTimeout(1500);
            expect(await messagesWithContent(page, caption)).toHaveLength(1);
        } finally {
            await context.close();
        }
    });
});
