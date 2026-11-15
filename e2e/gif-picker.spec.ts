import { test, expect, Browser, BrowserContext, Page, Route } from '@playwright/test';
import { PARTICIPANTS } from '../src/lib/participants';
import { buildAnimatedGif, makeStillInPage, pasteImage } from './support/synthetic-images';

/**
 * GIPHY GIF picker end to end (emulators only; every GIPHY host is stubbed).
 *
 * The dev server runs with NEXT_PUBLIC_GIPHY_API_KEY=e2e-giphy-placeholder from
 * playwright.config.ts. There is no skip path: a missing "Choose a GIF" button fails,
 * locally and on CI (a reused dev server started without the placeholder key fails by
 * design). Image attachments use the sandbox variables from the same config; no upload
 * happens in this spec.
 *
 * Stubs fulfil api.giphy.com, the GIPHY media hosts (only for rendition URLs the stub
 * returned) and giphy.com/embed/*. Every stub API object and every returned rendition URL
 * carries a unique sentinel token; the GIF ids do not (they are the persisted reference).
 * Any other GIPHY request is aborted and counted (must stay 0). Embed requests for ids
 * this stub never issued come from history rendered by earlier tests and are recorded
 * separately.
 *
 * Participant names are read from the source list; nothing personal is hardcoded.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';
const KEY = 'e2e-giphy-placeholder';
const GIPHY_ANY = /^https?:\/\/(?:[a-z0-9-]+\.)*giphy\.com(?::\d+)?\//i;
const SEND_ROUTE = '**/api/messages/send';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const ATTRIBUTION_SRC = '/giphy/PoweredBy_200px-Black_HorizLogo.png';
const BUSY_TEXT = 'GIF search is busy right now. Try again in a minute.';
const GENERIC_TEXT = "Couldn't load GIFs. Try again.";
const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 375, height: 667 };

type Participant = { name: string; email: string };
const participants = PARTICIPANTS as Participant[];
const firstName = participants[1].name;

type ApiCall = {
    endpoint: 'trending' | 'search';
    params: [string, string][];
    headers: Record<string, string>;
    method: string;
};
type ApiHandler = (route: Route, url: URL) => Promise<void>;

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

/**
 * Stub for every GIPHY host in one browser context.
 */
class GiphyStub {
    readonly runTag = Date.now().toString(36);
    readonly apiCalls: ApiCall[] = [];
    readonly mediaRequests: string[] = [];
    readonly ownEmbedRequests: string[] = [];
    readonly historyEmbedRequests: string[] = [];
    readonly unexpected: string[] = [];
    readonly sentinels = new Set<string>();
    readonly renditionUrls = new Set<string>();
    readonly ids = new Set<string>();
    private readonly idsByTitle = new Map<string, string>();
    private readonly handlers: ApiHandler[] = [];
    private readonly gifBytes = buildAnimatedGif();
    private counter = 0;

    async attach(context: BrowserContext): Promise<void> {
        await context.route(GIPHY_ANY, (route) => this.handle(route));
    }

    /** The next API request is answered by `handler` instead of a normal page. */
    nextApi(handler: ApiHandler): void {
        this.handlers.push(handler);
    }

    idForTileLabel(label: string | null): string {
        const title = (label || '').replace(/^GIF: /, '');
        const id = this.idsByTitle.get(title);
        if (!id) throw new Error(`Unknown tile label ${label}`);
        return id;
    }

    private sentinel(): string {
        this.counter += 1;
        const token = `e2esentinel${this.runTag}x${this.counter.toString(36)}`;
        this.sentinels.add(token);
        return token;
    }

    private gifObject(id: string, label: string) {
        const token = this.sentinel();
        const host = `media${(this.counter % 4) + 1}.giphy.com`;
        const base = `https://${host}/media/${token}/${id}`;
        const fixedWebp = `${base}/200w.webp?cid=${token}&ct=g`;
        const fixedGif = `${base}/200w.gif?cid=${token}&ct=g`;
        const originalWebp = `${base}/giphy.webp?cid=${token}&ct=g`;
        const originalGif = `${base}/giphy.gif?cid=${token}&ct=g`;
        [fixedWebp, fixedGif, originalWebp, originalGif].forEach((url) => this.renditionUrls.add(url));
        const title = `${label} ${token}`;
        this.ids.add(id);
        this.idsByTitle.set(title, id);
        return {
            type: 'gif',
            id,
            url: `https://giphy.com/gifs/${token}-${id}`,
            slug: `${token}-${id}`,
            title,
            username: token,
            rating: 'g',
            images: {
                fixed_width: { url: fixedGif, webp: fixedWebp, width: '200', height: '200' },
                original: { url: originalGif, webp: originalWebp, width: '64', height: '64' },
            },
            analytics: { onload: { url: `https://pingback.giphy.com/v1/pingback?token=${token}` } },
        };
    }

    pageBody(url: URL) {
        const q = url.searchParams.get('q') || '';
        const offset = Number(url.searchParams.get('offset') || '0');
        const marker = (q.replace(/[^A-Za-z0-9]/g, '') || 'trending').slice(0, 12);
        const data = Array.from({ length: 6 }, (_, i) => this.gifObject(`E2e${this.runTag}${marker}${offset + i}`, `${q || 'trending'} ${offset + i}`));
        return {
            data,
            pagination: { total_count: data.length, count: data.length, offset },
            meta: { status: 200, msg: 'OK', response_id: this.sentinel() },
        };
    }

    async fulfillPage(route: Route, url: URL): Promise<void> {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(this.pageBody(url)) });
    }

    private async handle(route: Route): Promise<void> {
        const request = route.request();
        const raw = request.url();
        const url = new URL(raw);

        if (url.hostname === 'api.giphy.com' && (url.pathname === '/v1/gifs/trending' || url.pathname === '/v1/gifs/search')) {
            this.apiCalls.push({
                endpoint: url.pathname.endsWith('/search') ? 'search' : 'trending',
                params: Array.from(url.searchParams.entries()),
                headers: await request.allHeaders(),
                method: request.method(),
            });
            const handler = this.handlers.shift();
            try {
                if (handler) {
                    await handler(route, url);
                } else {
                    await this.fulfillPage(route, url);
                }
            } catch {
                // The page may have aborted this request before it was answered.
            }
            return;
        }

        const embed = /^\/embed\/([A-Za-z0-9]+)$/.exec(url.pathname);
        if (url.hostname === 'giphy.com' && embed) {
            (this.ids.has(embed[1]) ? this.ownEmbedRequests : this.historyEmbedRequests).push(raw);
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><html><body style="margin:0;background:#1d2b53"></body></html>',
            });
            return;
        }

        if (this.renditionUrls.has(raw)) {
            this.mediaRequests.push(raw);
            await route.fulfill({ status: 200, contentType: 'image/gif', headers: CORS, body: this.gifBytes });
            return;
        }

        this.unexpected.push(raw);
        await route.abort();
    }

    expectQuietBeforePicker(): void {
        expect(this.apiCalls).toHaveLength(0);
        expect(this.mediaRequests).toHaveLength(0);
        expect(this.ownEmbedRequests).toHaveLength(0);
        expect(this.unexpected).toEqual([]);
    }
}

type AppRequest = { url: string; method: string; postData: string; isSend: boolean; isMediaUpload: boolean };

/** Every non-GIPHY request made by any page of the context. */
function captureAppRequests(context: BrowserContext): AppRequest[] {
    const requests: AppRequest[] = [];
    context.on('request', (request) => {
        const raw = request.url();
        if (GIPHY_ANY.test(raw)) return;
        let pathname = '';
        try {
            pathname = new URL(raw).pathname;
        } catch {
            pathname = '';
        }
        const method = request.method();
        requests.push({
            url: raw,
            method,
            postData: request.postData() || '',
            isSend: method === 'POST' && pathname === '/api/messages/send',
            isMediaUpload: method === 'POST' && pathname === '/api/messages/media',
        });
    });
    return requests;
}

function containsProviderData(text: string, stub: GiphyStub): string | null {
    for (const token of stub.sentinels) {
        if (text.includes(token)) return `sentinel ${token}`;
    }
    for (const url of stub.renditionUrls) {
        if (text.includes(url)) return `rendition URL ${url}`;
    }
    return null;
}

function expectNoProviderData(label: string, text: string, stub: GiphyStub): void {
    expect(containsProviderData(text, stub), `${label} must not hold provider data`).toBeNull();
}

function expectCleanApiCall(call: ApiCall): void {
    expect(call.method).toBe('GET');
    expect(call.headers.referer).toBeUndefined();
    expect(call.headers.authorization).toBeUndefined();
    expect(call.headers.cookie).toBeUndefined();
    Object.keys(call.headers).forEach((name) => expect(name).not.toMatch(/^x-/i));
}

function expectPageParams(call: ApiCall, endpoint: 'trending' | 'search', q: string | null, offset = 0): void {
    expect(call.endpoint).toBe(endpoint);
    const expected: [string, string][] = [['api_key', KEY]];
    if (q !== null) expected.push(['q', q]);
    expected.push(['limit', '24'], ['offset', String(offset)], ['rating', 'pg-13']);
    expect(call.params).toEqual(expected);
    expectCleanApiCall(call);
}

/**
 * Payload contract: only POST /api/messages/send carries provider-derived data (the
 * reference), its body has no attachment and no sentinel or rendition URL, and nothing
 * was uploaded.
 */
function expectPayloadContract(requests: AppRequest[], stub: GiphyStub, content: string, gifId: string): void {
    const sends = requests.filter((request) => request.isSend);
    const matching = sends.filter((request) => {
        try {
            return JSON.parse(request.postData).content === content;
        } catch {
            return false;
        }
    });
    expect(matching.length).toBeGreaterThan(0);
    matching.forEach((request) => {
        const body = JSON.parse(request.postData);
        expect(body).not.toHaveProperty('attachment');
        expect(body.content).toBe(content);
    });
    requests.forEach((request) => {
        expectNoProviderData(`${request.method} ${request.url}`, `${request.url}\n${request.postData}`, stub);
        if (!request.isSend) {
            for (const id of stub.ids) {
                expect(`${request.url}\n${request.postData}`.includes(id), `${request.url} carries a GIF id`).toBe(false);
            }
        }
    });
    expect(requests.filter((request) => request.isMediaUpload)).toHaveLength(0);
    expect(gifId).toMatch(/^[A-Za-z0-9]{1,64}$/);
}

/**
 * Persistence contract: web storage, every IndexedDB store and every readable CacheStorage
 * body hold no sentinel or rendition URL; no cache key or workbox-expiration row has a
 * GIPHY host.
 */
async function expectNothingPersisted(page: Page, stub: GiphyStub): Promise<void> {
    const stored = await page.evaluate(async () => {
        const errors: string[] = [];
        const storage: string[] = [];
        const idb: string[] = [];
        const cacheKeys: string[] = [];
        const cacheBodies: string[] = [];
        const expirationUrls: string[] = [];
        const latin1 = new TextDecoder('latin1');
        const toText = (value: unknown): string => {
            try {
                return JSON.stringify(value, (_key, v) => {
                    if (v instanceof ArrayBuffer) return latin1.decode(new Uint8Array(v));
                    if (ArrayBuffer.isView(v)) return latin1.decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
                    return v;
                }) ?? '';
            } catch {
                return String(value);
            }
        };

        for (const store of [window.localStorage, window.sessionStorage]) {
            for (let i = 0; i < store.length; i += 1) {
                const key = store.key(i) || '';
                storage.push(`${key}=${store.getItem(key)}`);
            }
        }

        if (typeof indexedDB.databases !== 'function') {
            errors.push('indexedDB.databases is unavailable');
        } else {
            const list = await indexedDB.databases();
            for (const info of list) {
                if (!info.name) continue;
                try {
                    const db = await new Promise<IDBDatabase>((resolve, reject) => {
                        const request = indexedDB.open(info.name as string);
                        request.onupgradeneeded = () => request.transaction?.abort();
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                        request.onblocked = () => reject(new Error('blocked'));
                    });
                    try {
                        for (const storeName of Array.from(db.objectStoreNames)) {
                            const rows = await new Promise<unknown[]>((resolve, reject) => {
                                const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
                                request.onsuccess = () => resolve(request.result);
                                request.onerror = () => reject(request.error);
                            });
                            idb.push(`${info.name}/${storeName}:${toText(rows)}`);
                            if (info.name === 'workbox-expiration') {
                                rows.forEach((row: any) => expirationUrls.push(String(row?.url)));
                            }
                        }
                    } finally {
                        db.close();
                    }
                } catch (error) {
                    errors.push(`${info.name}: ${String(error)}`);
                }
            }
        }

        if (typeof caches !== 'undefined') {
            for (const name of await caches.keys()) {
                const cache = await caches.open(name);
                for (const request of await cache.keys()) {
                    cacheKeys.push(request.url);
                    const response = await cache.match(request);
                    if (response && response.type !== 'opaque') {
                        try {
                            cacheBodies.push(await response.text());
                        } catch {
                            // Unreadable body: only its key is checked.
                        }
                    }
                }
            }
        }

        return {
            errors,
            storage: storage.join('\n'),
            idb: idb.join('\n'),
            cacheKeys,
            cacheBodies: cacheBodies.join('\n'),
            expirationUrls,
        };
    });

    expect(stored.errors).toEqual([]);
    expectNoProviderData('localStorage/sessionStorage', stored.storage, stub);
    expectNoProviderData('IndexedDB', stored.idb, stub);
    expectNoProviderData('CacheStorage bodies', stored.cacheBodies, stub);
    stored.cacheKeys.forEach((url) => expect(GIPHY_ANY.test(url), `cache key ${url}`).toBe(false));
    stored.expirationUrls.forEach((url) => expect(GIPHY_ANY.test(url), `expiration row ${url}`).toBe(false));
}

// --- App helpers (same patterns as the other specs) ---

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

async function emulatorGet(page: Page, path: string): Promise<any> {
    const response = await page.request.get(
        `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
        { headers: { Authorization: 'Bearer owner' } }
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
}

async function messagesWithContent(page: Page, content: string): Promise<any[]> {
    const docs = (await emulatorGet(page, 'messages?pageSize=1000')).documents || [];
    return docs.filter((doc: any) => doc.fields?.content?.stringValue === content);
}

async function userName(page: Page, id: string): Promise<string> {
    return (await emulatorGet(page, `users/${id}`)).fields.name.stringValue;
}

function navigation(page: Page, mobile: boolean) {
    return page.locator(mobile ? '.mobile-only' : '.desktop-only');
}

async function openTab(page: Page, name: RegExp, mobile = false): Promise<void> {
    await navigation(page, mobile).getByRole('button', { name }).click();
}

async function openRecipientChat(page: Page, mobile = false): Promise<void> {
    await openTab(page, /recipient/i, mobile);
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();
    // No skip path: the button must exist on a dev server started by playwright.config.ts.
    await expect(page.getByRole('button', { name: 'Choose a GIF' })).toBeVisible({ timeout: 15000 });
}

async function newGifContext(browser: Browser, viewport = DESKTOP) {
    const context = await browser.newContext({ viewport });
    const stub = new GiphyStub();
    await stub.attach(context);
    const requests = captureAppRequests(context);
    return { context, stub, requests };
}

async function signIn(context: BrowserContext, name: string) {
    const page = await context.newPage();
    await page.goto('/');
    await seedAndAssign(page);
    await devLogin(page, name);
    const user = await waitForAssignedUser(page);
    return { page, user };
}

function gifButton(page: Page) {
    return page.getByRole('button', { name: 'Choose a GIF' });
}

function tiles(page: Page) {
    return page.getByTestId('gif-picker-item');
}

function searchBox(page: Page) {
    return page.getByRole('searchbox', { name: 'Search GIPHY' });
}

function pickerStatus(page: Page) {
    return page.getByTestId('gif-picker-status');
}

function embedFrames(page: Page, ref: string) {
    return page.locator(`[data-testid="message-gif"] iframe[src="${ref}"]`);
}

/**
 * Feed and outbox bubbles render the embed plus the caption as a bare text node, so the
 * caption is checked as the bubble's own text nodes only (the embed's "via GIPHY" link is
 * excluded). The bubble is the parent of the one message-gif whose iframe src is `ref`.
 */
async function expectGifBubbleCaption(page: Page, ref: string, caption: string): Promise<void> {
    const embed = page.locator('[data-testid="message-gif"]').filter({ has: page.locator(`iframe[src="${ref}"]`) });
    await expect(embed).toHaveCount(1);
    const bubble = embed.locator('xpath=..');
    await expect(bubble).toBeVisible();
    await expect.poll(() => bubble.evaluate((element) => Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join(''))).toBe(caption);
}

async function openPickerWithTiles(page: Page): Promise<void> {
    await gifButton(page).click();
    await expect(page.getByTestId('gif-picker')).toBeVisible();
    await expect(tiles(page).first()).toBeVisible({ timeout: 15000 });
}

/** Clicks tile `index` and returns its GIF id and reference. */
async function selectTile(page: Page, stub: GiphyStub, index = 0): Promise<{ id: string; ref: string }> {
    const tile = tiles(page).nth(index);
    const id = stub.idForTileLabel(await tile.getAttribute('aria-label'));
    await tile.click();
    await expect(page.getByTestId('gif-picker')).toHaveCount(0);
    await expect(page.getByTestId('composer-gif')).toBeVisible();
    return { id, ref: `https://giphy.com/embed/${id}` };
}

async function sendComposer(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);
}

let activeStubs: GiphyStub[] = [];

test.describe.serial('GIF picker', () => {
    test.beforeEach(() => {
        activeStubs = [];
    });

    test.afterEach(() => {
        activeStubs.forEach((stub) => expect(stub.unexpected).toEqual([]));
    });

    test('desktop happy path with payload, rendering and persistence contracts', async ({ browser }) => {
        const sender = await newGifContext(browser);
        activeStubs.push(sender.stub);
        let recipient: Awaited<ReturnType<typeof newGifContext>> | null = null;
        try {
            const { stub, requests } = sender;
            const { page, user } = await signIn(sender.context, firstName);
            await openRecipientChat(page);
            stub.expectQuietBeforePicker();

            // Open: exactly one trending request.
            await openPickerWithTiles(page);
            await expect(tiles(page)).toHaveCount(6);
            await expect(page.getByTestId('gif-picker-attribution')).toBeVisible();
            await expect(page.getByTestId('gif-picker-attribution')).toHaveAttribute('src', ATTRIBUTION_SRC);
            expect(stub.apiCalls).toHaveLength(1);
            expectPageParams(stub.apiCalls[0], 'trending', null);

            // Search: one request per settled query, exact params.
            await searchBox(page).pressSequentially('snow', { delay: 40 });
            await expect.poll(() => stub.apiCalls.length, { timeout: 10000 }).toBe(2);
            await expect(tiles(page).first()).toHaveAttribute('aria-label', /^GIF: snow 0 /);
            await page.waitForTimeout(1200);
            expect(stub.apiCalls).toHaveLength(2);
            expectPageParams(stub.apiCalls[1], 'search', 'snow');

            // Select: animated preview and composer attribution.
            await selectTile(page, stub, 0);
            const preview = page.getByTestId('composer-gif-preview');
            await expect(preview).toBeVisible();
            expect(stub.renditionUrls.has((await preview.getAttribute('src')) || '')).toBe(true);
            await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 15000 }).toBe(64);
            const firstFrame = await preview.screenshot();
            await expect.poll(async () => (await preview.screenshot()).equals(firstFrame), { timeout: 5000, intervals: [200] }).toBe(false);
            await expect(page.getByTestId('composer-gif-attribution')).toBeVisible();
            await expect(page.getByTestId('composer-gif-attribution')).toHaveAttribute('src', ATTRIBUTION_SRC);

            // Remove, then reselect (a new picker makes one new trending request).
            await page.getByRole('button', { name: 'Remove GIF' }).click();
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);
            await openPickerWithTiles(page);
            expect(stub.apiCalls).toHaveLength(3);
            expectPageParams(stub.apiCalls[2], 'trending', null);
            const chosen = await selectTile(page, stub, 2);

            // Caption, then Send.
            const caption = `GIF caption ${Date.now()}`;
            const content = `${chosen.ref}\n${caption}`;
            await page.getByPlaceholder('Type a message...').fill(caption);
            await sendComposer(page);

            await expect.poll(async () => (await messagesWithContent(page, content)).length, { timeout: 20000 }).toBe(1);
            const [doc] = await messagesWithContent(page, content);
            expect(doc.fields.attachment).toBeUndefined();
            expectPayloadContract(requests, stub, content, chosen.id);

            // Rendering for the sender: exact embed src, caption-only text.
            await expect(embedFrames(page, chosen.ref).first()).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(caption, { exact: true }).first()).toBeVisible();
            await expect.poll(() => stub.ownEmbedRequests.includes(chosen.ref), { timeout: 15000 }).toBe(true);
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);

            await expectNothingPersisted(page, stub);

            // Public Feed: preview label and thread render.
            await openTab(page, /public feed/i);
            const feedPreview = page.getByText(`📷 ${caption}`);
            await expect(feedPreview).toBeVisible({ timeout: 15000 });
            await feedPreview.click();
            await expect(embedFrames(page, chosen.ref).first()).toBeVisible({ timeout: 15000 });
            await expectGifBubbleCaption(page, chosen.ref, caption);

            // Recipient: exact embed src in the Santa chat.
            recipient = await newGifContext(browser);
            activeStubs.push(recipient.stub);
            const recipientPage = await recipient.context.newPage();
            const recipientName = await userName(page, user.recipientId);
            await recipientPage.goto('/');
            await devLogin(recipientPage, recipientName);
            await waitForAssignedUser(recipientPage);
            await openTab(recipientPage, /santa/i);
            await expect(embedFrames(recipientPage, chosen.ref).first()).toBeVisible({ timeout: 20000 });
            await expect(recipientPage.getByText(caption, { exact: true }).first()).toBeVisible();
            expect(recipient.stub.apiCalls).toHaveLength(0);
            expect(recipient.stub.mediaRequests).toHaveLength(0);

            // GIF-only send: the content is the bare reference.
            await openRecipientChat(page);
            await openPickerWithTiles(page);
            const only = await selectTile(page, stub, 1);
            await sendComposer(page);
            await expect.poll(async () => (await messagesWithContent(page, only.ref)).length, { timeout: 20000 }).toBe(1);
            const [onlyDoc] = await messagesWithContent(page, only.ref);
            expect(onlyDoc.fields.attachment).toBeUndefined();
            expectPayloadContract(requests, stub, only.ref, only.id);
            await expect(embedFrames(page, only.ref).first()).toBeVisible({ timeout: 15000 });
            await expectNothingPersisted(page, stub);
        } finally {
            await recipient?.context.close();
            await sender.context.close();
        }
    });

    test('held then failed send: pending and failed bubbles render the GIF; Retry works', async ({ browser }) => {
        const { context, stub, requests } = await newGifContext(browser);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await openRecipientChat(page);
            stub.expectQuietBeforePicker();

            const gate = deferred();
            const reached = deferred();
            await page.route(SEND_ROUTE, async (route) => {
                reached.resolve();
                await gate.promise;
                await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated rejection' }) });
            });

            await openPickerWithTiles(page);
            const chosen = await selectTile(page, stub, 0);
            const caption = `Held GIF ${Date.now()}`;
            const content = `${chosen.ref}\n${caption}`;
            await page.getByPlaceholder('Type a message...').fill(caption);
            await sendComposer(page);
            await reached.promise;

            await expect(page.getByText('Sending...')).toBeVisible();
            await expect(embedFrames(page, chosen.ref)).toHaveCount(1);
            await expectGifBubbleCaption(page, chosen.ref, caption);
            await expectNothingPersisted(page, stub);

            gate.resolve();
            await expect(page.getByText('Failed to send')).toBeVisible({ timeout: 15000 });
            await expect(embedFrames(page, chosen.ref)).toHaveCount(1);
            await expectGifBubbleCaption(page, chosen.ref, caption);
            await expectNothingPersisted(page, stub);
            expect(await messagesWithContent(page, content)).toHaveLength(0);

            await page.unroute(SEND_ROUTE);
            await page.getByRole('button', { name: 'Retry' }).click();
            await expect.poll(async () => (await messagesWithContent(page, content)).length, { timeout: 20000 }).toBe(1);
            await expect(page.getByText('Failed to send')).toHaveCount(0, { timeout: 15000 });
            await expect(embedFrames(page, chosen.ref).first()).toBeVisible();
            expectPayloadContract(requests, stub, content, chosen.id);
        } finally {
            await context.close();
        }
    });

    test('429: the message shows, no second request during the cooldown, text send still works', async ({ browser }) => {
        const { context, stub } = await newGifContext(browser);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await openRecipientChat(page);
            stub.expectQuietBeforePicker();

            stub.nextApi(async (route) => {
                await route.fulfill({ status: 429, contentType: 'application/json', headers: CORS, body: JSON.stringify({ message: 'Synthetic limit' }) });
            });
            await gifButton(page).click();
            await expect(pickerStatus(page)).toHaveText(BUSY_TEXT, { timeout: 15000 });
            expect(stub.apiCalls).toHaveLength(1);

            await page.getByRole('button', { name: 'Try again' }).click();
            await expect(pickerStatus(page)).toHaveText(BUSY_TEXT);
            await searchBox(page).fill('ice');
            await page.waitForTimeout(1500);
            await expect(pickerStatus(page)).toHaveText(BUSY_TEXT);

            await page.getByRole('button', { name: 'Close GIF picker' }).click();
            await gifButton(page).click();
            await expect(pickerStatus(page)).toHaveText(BUSY_TEXT);
            await page.waitForTimeout(500);
            expect(stub.apiCalls).toHaveLength(1);
            await page.getByRole('button', { name: 'Close GIF picker' }).click();

            const text = `Text after 429 ${Date.now()}`;
            await page.getByPlaceholder('Type a message...').fill(text);
            await sendComposer(page);
            await expect.poll(async () => (await messagesWithContent(page, text)).length, { timeout: 20000 }).toBe(1);
            expect(stub.apiCalls).toHaveLength(1);
        } finally {
            await context.close();
        }
    });

    test('an aborted network request: Try again issues exactly one request', async ({ browser }) => {
        const { context, stub } = await newGifContext(browser);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await openRecipientChat(page);
            stub.expectQuietBeforePicker();

            stub.nextApi(async (route) => {
                await route.abort('failed');
            });
            await gifButton(page).click();
            await expect(pickerStatus(page)).toHaveText(GENERIC_TEXT, { timeout: 15000 });
            expect(stub.apiCalls).toHaveLength(1);

            await page.getByRole('button', { name: 'Try again' }).click();
            await expect(tiles(page).first()).toBeVisible({ timeout: 15000 });
            await page.waitForTimeout(1000);
            expect(stub.apiCalls).toHaveLength(2);
            expectPageParams(stub.apiCalls[1], 'trending', null);
        } finally {
            await context.close();
        }
    });

    test('a delayed stale search never displays', async ({ browser }) => {
        const { context, stub } = await newGifContext(browser);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await openRecipientChat(page);
            stub.expectQuietBeforePicker();
            await openPickerWithTiles(page);

            const gate = deferred();
            stub.nextApi(async (route, url) => {
                await gate.promise;
                await stub.fulfillPage(route, url);
            });
            await searchBox(page).fill('aaa');
            await expect.poll(() => stub.apiCalls.length, { timeout: 10000 }).toBe(2);
            expectPageParams(stub.apiCalls[1], 'search', 'aaa');

            await searchBox(page).fill('bbb');
            await expect.poll(() => stub.apiCalls.length, { timeout: 10000 }).toBe(3);
            await expect(tiles(page).first()).toHaveAttribute('aria-label', /^GIF: bbb 0 /, { timeout: 15000 });

            gate.resolve();
            await page.waitForTimeout(1500);
            const labels = await tiles(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') || ''));
            expect(labels).toHaveLength(6);
            labels.forEach((label) => {
                expect(label).toMatch(/^GIF: bbb /);
                expect(label).not.toMatch(/aaa/);
            });
        } finally {
            await context.close();
        }
    });

    test('a tab switch mid-request closes the picker; no draft follows or returns', async ({ browser }) => {
        const { context, stub } = await newGifContext(browser);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await openRecipientChat(page);
            stub.expectQuietBeforePicker();

            const gate = deferred();
            stub.nextApi(async (route, url) => {
                await gate.promise;
                await stub.fulfillPage(route, url);
            });
            await gifButton(page).click();
            await expect(pickerStatus(page)).toHaveText('Loading GIFs…');
            await expect.poll(() => stub.apiCalls.length).toBe(1);

            await openTab(page, /santa/i);
            await expect(page.getByTestId('gif-picker')).toHaveCount(0);
            gate.resolve();
            await page.waitForTimeout(1000);
            await expect(page.getByTestId('gif-picker')).toHaveCount(0);
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);

            await openRecipientChat(page);
            await expect(page.getByTestId('gif-picker')).toHaveCount(0);
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);

            await openPickerWithTiles(page);
            await selectTile(page, stub, 0);
            await openTab(page, /santa/i);
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);
            await openRecipientChat(page);
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);
        } finally {
            await context.close();
        }
    });

    test('exclusivity with an image draft: the GIF button is disabled, an image replaces a GIF, no upload', async ({ browser }) => {
        const { context, stub, requests } = await newGifContext(browser);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await openRecipientChat(page);
            await expect(page.getByRole('button', { name: 'Attach image' })).toBeVisible({ timeout: 15000 });
            stub.expectQuietBeforePicker();
            const png = await makeStillInPage(page, { width: 200, height: 150, type: 'image/png' });

            await pasteImage(page, png, 'image/png');
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 15000 });
            await expect(gifButton(page)).toBeDisabled();
            await page.getByRole('button', { name: 'Remove image' }).click();
            await expect(gifButton(page)).toBeEnabled();

            await openPickerWithTiles(page);
            await selectTile(page, stub, 0);
            await openPickerWithTiles(page);
            await pasteImage(page, png, 'image/png');
            await expect(page.getByAltText('Attachment preview')).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId('composer-gif')).toHaveCount(0);
            await expect(page.getByTestId('gif-picker')).toHaveCount(0);
            await page.getByRole('button', { name: 'Remove image' }).click();

            await page.waitForTimeout(500);
            expect(requests.filter((request) => request.isMediaUpload)).toHaveLength(0);
            expect(requests.filter((request) => request.isSend)).toHaveLength(0);
        } finally {
            await context.close();
        }
    });

    test('mobile 375×667: no horizontal overflow; composer, picker and attribution usable', async ({ browser }) => {
        const { context, stub, requests } = await newGifContext(browser, MOBILE);
        activeStubs.push(stub);
        try {
            const { page } = await signIn(context, firstName);
            await expect(page.locator('.mobile-only').first()).toBeVisible({ timeout: 15000 });
            await openRecipientChat(page, true);
            stub.expectQuietBeforePicker();
            await expectNoHorizontalOverflow(page);

            await openPickerWithTiles(page);
            await expect(page.getByTestId('gif-picker-attribution')).toBeInViewport();
            await expect(searchBox(page)).toBeInViewport();
            await expect(page.getByRole('button', { name: 'Close GIF picker' })).toBeInViewport();
            await expectNoHorizontalOverflow(page);

            const chosen = await selectTile(page, stub, 0);
            await expect(page.getByTestId('composer-gif-preview')).toBeInViewport();
            await expect(page.getByTestId('composer-gif-attribution')).toBeInViewport();
            await expect(page.getByRole('button', { name: 'Remove GIF' })).toBeInViewport();
            await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
            await expectNoHorizontalOverflow(page);

            const caption = `Mobile GIF ${Date.now()}`;
            const content = `${chosen.ref}\n${caption}`;
            await page.getByPlaceholder('Type a message...').fill(caption);
            await sendComposer(page);
            await expect.poll(async () => (await messagesWithContent(page, content)).length, { timeout: 20000 }).toBe(1);
            await expect(embedFrames(page, chosen.ref).first()).toBeVisible({ timeout: 15000 });
            await expectNoHorizontalOverflow(page);
            expectPayloadContract(requests, stub, content, chosen.id);
            await expectNothingPersisted(page, stub);
        } finally {
            await context.close();
        }
    });
});
