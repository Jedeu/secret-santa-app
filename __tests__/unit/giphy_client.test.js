import {
    GIPHY_PAGE_SIZE,
    GIPHY_QUERY_MAX_LENGTH,
    GIPHY_RATE_LIMIT_COOLDOWN_MS,
    GIPHY_RATING,
    GIPHY_REQUEST_TIMEOUT_MS,
    GIPHY_SEARCH_MAX_OFFSET,
    GIPHY_TRENDING_MAX_OFFSET,
    GIPHY_WORKER_POLICY_MESSAGE,
    GIPHY_WORKER_POLICY_VERSION,
    GIPHY_WORKER_PROBE_TIMEOUT_MS,
    GiphyClientError,
    describeGiphyError,
    fetchGiphyPage,
    getGiphyApiKey,
    isGiphyConfigured,
    isGiphyWorkerReady,
    resetGiphyClientState,
} from '@/lib/giphy-client';

/**
 * GIPHY client with injected fetch, worker probe, clock and connectivity. Synthetic
 * placeholder key and synthetic GIF data only; no network.
 */

const KEY = 'e2e-giphy-placeholder';
const KEY_ENV = 'NEXT_PUBLIC_GIPHY_API_KEY';
const TRENDING = 'https://api.giphy.com/v1/gifs/trending';
const SEARCH = 'https://api.giphy.com/v1/gifs/search';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function media(id, name) {
    return `https://media.giphy.com/media/${id}/${name}`;
}

function rawGif(id, overrides = {}) {
    return {
        type: 'gif',
        id,
        title: `Synthetic ${id}`,
        images: {
            fixed_width: { url: media(id, '200w.gif'), webp: media(id, '200w.webp'), width: '200', height: '150' },
            original: { url: media(id, 'giphy.gif'), webp: media(id, 'giphy.webp') },
        },
        ...overrides,
    };
}

function okResponse(body, status = 200) {
    return { status, ok: status >= 200 && status <= 299, json: jest.fn(async () => body) };
}

function pageBody(count, { offset = 0, total } = {}) {
    const data = Array.from({ length: count }, (_, i) => rawGif(`Gif${offset + i}`));
    const pagination = total === undefined ? { count, offset } : { total_count: total, count, offset };
    return { data, pagination, meta: { status: 200 } };
}

function ready() {
    return Promise.resolve(true);
}

function call(params = {}) {
    return fetchGiphyPage({ workerReady: ready, isOnline: () => true, ...params });
}

async function failureOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('Expected a rejection');
}

function expectClientError(error, code) {
    expect(error).toBeInstanceOf(GiphyClientError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GiphyClientError');
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.isGiphyClientError).toBe(true);
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toMatch(/giphy\.com|https?:/);
}

function abortAwareFetch() {
    return jest.fn((url, init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
            const error = new Error(`aborted ${url}`);
            error.name = 'AbortError';
            reject(error);
        });
    }));
}

async function untilCalled(fn) {
    for (let i = 0; i < 50 && fn.mock.calls.length === 0; i += 1) {
        await Promise.resolve();
    }
    expect(fn).toHaveBeenCalled();
}

function trackedSignal() {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    return { controller, signal: controller.signal, add, remove };
}

function expectListenerRemoved({ add, remove }) {
    const added = add.mock.calls.filter(([type]) => type === 'abort');
    expect(added).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('abort', added[0][1]);
}

describe('giphy-client', () => {
    let savedKey;

    beforeEach(() => {
        savedKey = process.env[KEY_ENV];
        process.env[KEY_ENV] = KEY;
        resetGiphyClientState();
    });

    afterEach(() => {
        jest.useRealTimers();
        if (savedKey === undefined) {
            delete process.env[KEY_ENV];
        } else {
            process.env[KEY_ENV] = savedKey;
        }
        resetGiphyClientState();
    });

    describe('configuration and constants', () => {
        test('constants', () => {
            expect(GIPHY_PAGE_SIZE).toBe(24);
            expect(GIPHY_QUERY_MAX_LENGTH).toBe(50);
            expect(GIPHY_TRENDING_MAX_OFFSET).toBe(499);
            expect(GIPHY_SEARCH_MAX_OFFSET).toBe(4999);
            expect(GIPHY_RATING).toBe('pg-13');
            expect(GIPHY_REQUEST_TIMEOUT_MS).toBe(10000);
            expect(GIPHY_RATE_LIMIT_COOLDOWN_MS).toBe(60000);
            expect(GIPHY_WORKER_POLICY_MESSAGE).toBe('SECRET_SANTA_GIPHY_POLICY');
            expect(GIPHY_WORKER_POLICY_VERSION).toBe(1);
            expect(GIPHY_WORKER_PROBE_TIMEOUT_MS).toBe(3000);
        });

        test('the key is trimmed; empty or missing means not configured', () => {
            process.env[KEY_ENV] = `  ${KEY}  `;
            expect(getGiphyApiKey()).toBe(KEY);
            expect(isGiphyConfigured()).toBe(true);

            process.env[KEY_ENV] = '   ';
            expect(getGiphyApiKey()).toBeNull();
            expect(isGiphyConfigured()).toBe(false);

            delete process.env[KEY_ENV];
            expect(getGiphyApiKey()).toBeNull();
            expect(isGiphyConfigured()).toBe(false);
        });

        test('describeGiphyError has fixed text per code', () => {
            expect(describeGiphyError({ code: 'OFFLINE' })).toBe("You're offline. Connect to the internet to search GIFs.");
            expect(describeGiphyError({ code: 'RATE_LIMITED' })).toBe('GIF search is busy right now. Try again in a minute.');
            expect(describeGiphyError({ code: 'UPDATE_REQUIRED' })).toBe('GIF search is still updating. Try again in a moment, or reload the app.');
            expect(describeGiphyError({ code: 'MISSING_KEY' })).toBe('GIF search is unavailable right now.');
            expect(describeGiphyError({ code: 'KEY_REJECTED' })).toBe('GIF search is unavailable right now.');
            ['NETWORK', 'TIMEOUT', 'UNAVAILABLE', 'INVALID_RESPONSE', 'INVALID_QUERY', 'ABORTED', 'toString'].forEach((code) => {
                expect(describeGiphyError({ code })).toBe("Couldn't load GIFs. Try again.");
            });
            expect(describeGiphyError(null)).toBe("Couldn't load GIFs. Try again.");
            expect(describeGiphyError(new GiphyClientError('OFFLINE'))).toBe("You're offline. Connect to the internet to search GIFs.");
        });
    });

    describe('requests', () => {
        test('trending: exact URL, params and init; no headers or identifiers', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(24)));
            await call({ fetchImpl });

            expect(fetchImpl).toHaveBeenCalledTimes(1);
            const [url, init] = fetchImpl.mock.calls[0];
            expect(url).toBe(`${TRENDING}?api_key=${KEY}&limit=24&offset=0&rating=pg-13`);
            const parsed = new URL(url);
            expect([...parsed.searchParams.keys()]).toEqual(['api_key', 'limit', 'offset', 'rating']);
            expect(Object.keys(init).sort()).toEqual(['cache', 'credentials', 'method', 'referrerPolicy', 'signal']);
            expect(init).toEqual({
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal: expect.any(AbortSignal),
            });
            expect(init.headers).toBeUndefined();
            expect(init.body).toBeUndefined();
        });

        test('search: exact URL, params and init', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(24)));
            await call({ fetchImpl, query: 'happy cat', offset: 48 });

            const [url, init] = fetchImpl.mock.calls[0];
            const parsed = new URL(url);
            expect(`${parsed.origin}${parsed.pathname}`).toBe(SEARCH);
            expect([...parsed.searchParams.entries()]).toEqual([
                ['api_key', KEY],
                ['q', 'happy cat'],
                ['limit', '24'],
                ['offset', '48'],
                ['rating', 'pg-13'],
            ]);
            expect(init).toEqual({
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal: expect.any(AbortSignal),
            });
        });

        test('success: same order and count, nextOffset and hasMore', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(24, { total: 100 })));
            const result = await call({ fetchImpl, offset: 24 });

            expect(result.items).toHaveLength(24);
            expect(result.items.map((item) => item.id)).toEqual(Array.from({ length: 24 }, (_, i) => `Gif${i}`));
            expect(result.nextOffset).toBe(48);
            expect(result.hasMore).toBe(true);
        });

        test('order and count are preserved, including invalid ids and hosts', async () => {
            const data = [
                rawGif('First'),
                rawGif('bad-id'),
                rawGif('BadHost', {
                    images: {
                        fixed_width: { url: 'https://media.giphy.com.evil.example/x.gif', webp: 'https://evilgiphy.com/x.webp' },
                        original: { webp: 'http://media.giphy.com/x.webp' },
                    },
                }),
                rawGif('First'),
                { id: 'NoImages' },
                null,
                rawGif('Last'),
            ];
            const fetchImpl = jest.fn(async () => okResponse({ data, pagination: { total_count: 7 } }));
            const result = await call({ fetchImpl });

            expect(result.items.map((item) => item.id)).toEqual(['First', null, 'BadHost', 'First', 'NoImages', null, 'Last']);
            expect(result.items[1].tileUrls).toEqual([media('bad-id', '200w.webp'), media('bad-id', '200w.gif')]);
            expect(result.items[2]).toEqual({ id: 'BadHost', title: 'Synthetic BadHost', tileUrls: [], previewUrls: [] });
            expect(result.items[4]).toEqual({ id: 'NoImages', title: '', tileUrls: [], previewUrls: [] });
            expect(result.items[5]).toEqual({ id: null, title: '', tileUrls: [], previewUrls: [] });
            expect(result.nextOffset).toBe(7);
            expect(result.hasMore).toBe(false);
        });

        test('URL strings are byte-identical; previewUrls puts original.webp first and de-duplicates', async () => {
            const tileWebp = 'https://media2.giphy.com/media/v1.Y2lkPWU2ZTE/SyntheticGif01/200w.webp?cid=e2e0&rid=200w.webp&ct=g';
            const tileGif = 'https://i.giphy.com/SyntheticGif01/200w.GIF?ct=g';
            const originalWebp = 'https://MEDIA.giphy.com/media/SyntheticGif01/giphy.webp?cid=e2e0&ep=v1_gifs';
            const data = [
                {
                    id: 'SyntheticGif01',
                    title: 'One',
                    images: { fixed_width: { url: tileGif, webp: tileWebp }, original: { webp: originalWebp } },
                },
                {
                    id: 'SyntheticGif02',
                    title: 'Two',
                    images: { fixed_width: { url: tileWebp, webp: tileWebp }, original: { webp: tileWebp } },
                },
                {
                    id: 'SyntheticGif03',
                    title: 'Three',
                    images: { fixed_width: { url: tileGif }, original: {} },
                },
            ];
            const fetchImpl = jest.fn(async () => okResponse({ data }));
            const result = await call({ fetchImpl });

            expect(result.items[0].tileUrls).toEqual([tileWebp, tileGif]);
            expect(result.items[0].previewUrls).toEqual([originalWebp, tileWebp, tileGif]);
            expect(result.items[0].previewUrls[0]).toBe(originalWebp);
            expect(result.items[1].tileUrls).toEqual([tileWebp]);
            expect(result.items[1].previewUrls).toEqual([tileWebp]);
            expect(result.items[2].tileUrls).toEqual([tileGif]);
            expect(result.items[2].previewUrls).toEqual([tileGif]);
        });

        test.each([
            ['lookalike suffix', 'https://giphy.com.evil.example/a.gif'],
            ['lookalike prefix', 'https://evilgiphy.com/a.gif'],
            ['http', 'http://media.giphy.com/a.gif'],
            ['userinfo', 'https://user:pass@media.giphy.com/a.gif'],
            ['userinfo host trick', 'https://media.giphy.com@evil.example/a.gif'],
            ['explicit port', 'https://media.giphy.com:8443/a.gif'],
            ['javascript', 'javascript:alert(1)'],
            ['data', 'data:image/gif;base64,R0lGODlh'],
            ['relative', '/media/a.gif'],
            ['not a string', 42],
        ])('rejects a %s rendition URL', async (_label, value) => {
            const data = [{ id: 'SyntheticGif01', images: { fixed_width: { url: value, webp: value }, original: { webp: value } } }];
            const fetchImpl = jest.fn(async () => okResponse({ data }));
            const [item] = (await call({ fetchImpl })).items;
            expect(item.tileUrls).toEqual([]);
            expect(item.previewUrls).toEqual([]);
        });

        test('titles are strings of at most 120 characters', async () => {
            const data = [
                rawGif('A', { title: 't'.repeat(200) }),
                rawGif('B', { title: 42 }),
                rawGif('C', { title: undefined }),
            ];
            const fetchImpl = jest.fn(async () => okResponse({ data }));
            const { items } = await call({ fetchImpl });
            expect(items[0].title).toBe('t'.repeat(120));
            expect(items[1].title).toBe('');
            expect(items[2].title).toBe('');
        });
    });

    describe('offsets and hasMore', () => {
        test('trending accepts 499 and rejects 500 without a fetch', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(1)));
            await call({ fetchImpl, offset: 499 });
            expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('offset')).toBe('499');

            const error = await failureOf(call({ fetchImpl, offset: 500 }));
            expectClientError(error, 'INVALID_QUERY');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('search accepts 4999 and rejects 5000 without a fetch', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(1)));
            await call({ fetchImpl, query: 'snow', offset: 4999 });
            expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('offset')).toBe('4999');

            const error = await failureOf(call({ fetchImpl, query: 'snow', offset: 5000 }));
            expectClientError(error, 'INVALID_QUERY');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('hasMore is false when nextOffset exceeds the cap, even with a larger total_count', async () => {
            const trendingFetch = jest.fn(async () => okResponse(pageBody(24, { total: 100000 })));
            const trending = await call({ fetchImpl: trendingFetch, offset: 480 });
            expect(trending.nextOffset).toBe(504);
            expect(trending.hasMore).toBe(false);

            const searchFetch = jest.fn(async () => okResponse(pageBody(24, { total: 100000 })));
            const search = await call({ fetchImpl: searchFetch, query: 'snow', offset: 4992 });
            expect(search.nextOffset).toBe(5016);
            expect(search.hasMore).toBe(false);

            const atCap = await call({ fetchImpl: jest.fn(async () => okResponse(pageBody(24, { total: 100000 }))), offset: 475 });
            expect(atCap.nextOffset).toBe(499);
            expect(atCap.hasMore).toBe(true);
        });

        test('total_count bounds hasMore; a missing total_count falls back to a full page', async () => {
            const exact = await call({ fetchImpl: jest.fn(async () => okResponse(pageBody(24, { total: 24 }))) });
            expect(exact.hasMore).toBe(false);

            const larger = await call({ fetchImpl: jest.fn(async () => okResponse(pageBody(24, { total: 25 }))) });
            expect(larger.hasMore).toBe(true);

            const fullNoTotal = await call({ fetchImpl: jest.fn(async () => okResponse(pageBody(24))) });
            expect(fullNoTotal.hasMore).toBe(true);

            const shortNoTotal = await call({ fetchImpl: jest.fn(async () => okResponse(pageBody(10))) });
            expect(shortNoTotal.hasMore).toBe(false);

            const noPagination = await call({ fetchImpl: jest.fn(async () => okResponse({ data: pageBody(24).data })) });
            expect(noPagination.hasMore).toBe(true);

            const empty = await call({ fetchImpl: jest.fn(async () => okResponse(pageBody(0, { total: 500 }))), offset: 24 });
            expect(empty).toEqual({ items: [], nextOffset: 24, hasMore: false });
        });
    });

    describe('error codes', () => {
        test('pre-aborted signal: ABORTED with no probe and no fetch', async () => {
            const controller = new AbortController();
            controller.abort();
            const workerReady = jest.fn(ready);
            const fetchImpl = jest.fn();

            expectClientError(await failureOf(call({ signal: controller.signal, workerReady, fetchImpl })), 'ABORTED');
            expect(workerReady).not.toHaveBeenCalled();
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        test('MISSING_KEY', async () => {
            delete process.env[KEY_ENV];
            const fetchImpl = jest.fn();
            expectClientError(await failureOf(call({ fetchImpl })), 'MISSING_KEY');
            process.env[KEY_ENV] = '  ';
            expectClientError(await failureOf(call({ fetchImpl })), 'MISSING_KEY');
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        test.each([
            ['a non-string query', { query: 42 }],
            ['a query over 50 characters', { query: 'q'.repeat(51) }],
            ['a negative offset', { offset: -1 }],
            ['a fractional offset', { offset: 1.5 }],
            ['a string offset', { offset: '24' }],
            ['a NaN offset', { offset: Number.NaN }],
        ])('INVALID_QUERY for %s, with no fetch', async (_label, params) => {
            const fetchImpl = jest.fn();
            const workerReady = jest.fn(ready);
            expectClientError(await failureOf(call({ fetchImpl, workerReady, ...params })), 'INVALID_QUERY');
            expect(fetchImpl).not.toHaveBeenCalled();
            expect(workerReady).not.toHaveBeenCalled();
        });

        test('a 50-character query is accepted', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(0)));
            await call({ fetchImpl, query: 'q'.repeat(50) });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('429 sets the cooldown: RATE_LIMITED and the next call makes no fetch until it ends', async () => {
            let clock = 1_000_000;
            const now = () => clock;
            const fetchImpl = jest.fn(async () => okResponse({ message: 'Too many' }, 429));
            const workerReady = jest.fn(ready);

            expectClientError(await failureOf(call({ fetchImpl, workerReady, now })), 'RATE_LIMITED');
            expect(fetchImpl).toHaveBeenCalledTimes(1);

            clock += GIPHY_RATE_LIMIT_COOLDOWN_MS - 1;
            expectClientError(await failureOf(call({ fetchImpl, workerReady, now, query: 'snow' })), 'RATE_LIMITED');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(workerReady).toHaveBeenCalledTimes(1);

            clock += 1;
            fetchImpl.mockImplementation(async () => okResponse(pageBody(1)));
            await call({ fetchImpl, workerReady, now });
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        });

        test('resetGiphyClientState clears the cooldown', async () => {
            const fetchImpl = jest.fn(async () => okResponse({}, 429));
            await failureOf(call({ fetchImpl, now: () => 5 }));
            resetGiphyClientState();
            fetchImpl.mockImplementation(async () => okResponse(pageBody(1)));
            await call({ fetchImpl, now: () => 6 });
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        });

        test('isOnline false: OFFLINE with no probe and no fetch', async () => {
            const fetchImpl = jest.fn();
            const workerReady = jest.fn(ready);
            expectClientError(await failureOf(fetchGiphyPage({ fetchImpl, workerReady, isOnline: () => false })), 'OFFLINE');
            expect(fetchImpl).not.toHaveBeenCalled();
            expect(workerReady).not.toHaveBeenCalled();
        });

        test('omitted isOnline in node does not throw', async () => {
            const fetchImpl = jest.fn(async () => okResponse(pageBody(1)));
            await expect(fetchGiphyPage({ fetchImpl, workerReady: ready })).resolves.toMatchObject({ nextOffset: 1 });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('workerReady false or throwing: UPDATE_REQUIRED and fetch is not called', async () => {
            const fetchImpl = jest.fn();
            expectClientError(await failureOf(call({ fetchImpl, workerReady: async () => false })), 'UPDATE_REQUIRED');
            expectClientError(await failureOf(call({ fetchImpl, workerReady: async () => 'yes' })), 'UPDATE_REQUIRED');
            expectClientError(await failureOf(call({ fetchImpl, workerReady: async () => { throw new Error('probe'); } })), 'UPDATE_REQUIRED');
            expectClientError(await failureOf(call({ fetchImpl, workerReady: () => { throw new Error('probe'); } })), 'UPDATE_REQUIRED');
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        test('signal aborted while workerReady is pending: ABORTED and fetch is not called', async () => {
            const probe = deferred();
            const controller = new AbortController();
            const fetchImpl = jest.fn();
            const pending = failureOf(call({ fetchImpl, workerReady: () => probe.promise, signal: controller.signal }));

            controller.abort();
            probe.resolve(true);

            expectClientError(await pending, 'ABORTED');
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        test('NETWORK: the rejection message and URL are not copied', async () => {
            const fetchImpl = jest.fn(async (url) => { throw new TypeError(`Failed to fetch ${url}`); });
            expectClientError(await failureOf(call({ fetchImpl })), 'NETWORK');
        });

        test('a synchronous fetch throw is NETWORK', async () => {
            const fetchImpl = jest.fn(() => { throw new TypeError('sync failure'); });
            expectClientError(await failureOf(call({ fetchImpl })), 'NETWORK');
        });

        test.each([[401], [403]])('%i is KEY_REJECTED', async (status) => {
            const fetchImpl = jest.fn(async () => okResponse({ message: 'Invalid key' }, status));
            expectClientError(await failureOf(call({ fetchImpl })), 'KEY_REJECTED');
        });

        test.each([[400], [404], [500], [503], [302]])('%i is UNAVAILABLE', async (status) => {
            const fetchImpl = jest.fn(async () => okResponse({}, status));
            expectClientError(await failureOf(call({ fetchImpl })), 'UNAVAILABLE');
        });

        test('bad JSON or a non-array data is INVALID_RESPONSE', async () => {
            const badJson = jest.fn(async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } }));
            expectClientError(await failureOf(call({ fetchImpl: badJson })), 'INVALID_RESPONSE');

            for (const body of [null, {}, { data: {} }, { data: 'x' }, []]) {
                const fetchImpl = jest.fn(async () => okResponse(body));
                expectClientError(await failureOf(call({ fetchImpl })), 'INVALID_RESPONSE');
            }
        });

        test('caller abort during fetch is ABORTED', async () => {
            const controller = new AbortController();
            const fetchImpl = abortAwareFetch();
            const pending = failureOf(call({ fetchImpl, signal: controller.signal }));
            await untilCalled(fetchImpl);
            controller.abort();
            expectClientError(await pending, 'ABORTED');
            expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
        });

        test('caller abort while reading the body is ABORTED', async () => {
            const controller = new AbortController();
            const body = deferred();
            const json = jest.fn(() => body.promise);
            const fetchImpl = jest.fn(async () => ({ status: 200, ok: true, json }));
            const pending = failureOf(call({ fetchImpl, signal: controller.signal }));
            await untilCalled(json);
            controller.abort();
            body.resolve(pageBody(1));
            expectClientError(await pending, 'ABORTED');
        });

        test('timer: TIMEOUT after 10 s and the request signal is aborted', async () => {
            jest.useFakeTimers();
            const fetchImpl = abortAwareFetch();
            const pending = failureOf(call({ fetchImpl }));

            await jest.advanceTimersByTimeAsync(GIPHY_REQUEST_TIMEOUT_MS - 1);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);

            expectClientError(await pending, 'TIMEOUT');
            expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
        });

        test('a fetch that ignores the signal still ends with TIMEOUT', async () => {
            jest.useFakeTimers();
            const fetchImpl = jest.fn(() => new Promise(() => {}));
            const pending = failureOf(call({ fetchImpl }));
            await jest.advanceTimersByTimeAsync(GIPHY_REQUEST_TIMEOUT_MS);
            expectClientError(await pending, 'TIMEOUT');
        });
    });

    describe('request cleanup (listener removed, no timer pending)', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        test('on success', async () => {
            const tracked = trackedSignal();
            await call({ signal: tracked.signal, fetchImpl: jest.fn(async () => okResponse(pageBody(1))) });
            expectListenerRemoved(tracked);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('on a non-2xx', async () => {
            const tracked = trackedSignal();
            await failureOf(call({ signal: tracked.signal, fetchImpl: jest.fn(async () => okResponse({}, 500)) }));
            expectListenerRemoved(tracked);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('on a rejection', async () => {
            const tracked = trackedSignal();
            await failureOf(call({ signal: tracked.signal, fetchImpl: jest.fn(async () => { throw new Error('down'); }) }));
            expectListenerRemoved(tracked);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('on a timeout', async () => {
            const tracked = trackedSignal();
            const pending = failureOf(call({ signal: tracked.signal, fetchImpl: abortAwareFetch() }));
            await jest.advanceTimersByTimeAsync(GIPHY_REQUEST_TIMEOUT_MS);
            expectClientError(await pending, 'TIMEOUT');
            expectListenerRemoved(tracked);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('on a caller abort', async () => {
            const tracked = trackedSignal();
            const fetchImpl = abortAwareFetch();
            const pending = failureOf(call({ signal: tracked.signal, fetchImpl }));
            await untilCalled(fetchImpl);
            tracked.controller.abort();
            expectClientError(await pending, 'ABORTED');
            expectListenerRemoved(tracked);
            expect(jest.getTimerCount()).toBe(0);
        });
    });

    describe('isGiphyWorkerReady', () => {
        function fakeChannel() {
            return {
                port1: { onmessage: null, close: jest.fn() },
                port2: { close: jest.fn() },
            };
        }

        function fakeContainer() {
            const controller = { postMessage: jest.fn() };
            return { controller };
        }

        function probe({ container = fakeContainer(), channel = fakeChannel(), timeoutMs } = {}) {
            const createChannel = jest.fn(() => channel);
            const result = isGiphyWorkerReady({ container, createChannel, timeoutMs });
            return { result, container, channel, createChannel };
        }

        function reply(channel, data) {
            channel.port1.onmessage({ data });
        }

        const READY_REPLY = { type: GIPHY_WORKER_POLICY_MESSAGE, ready: true, version: GIPHY_WORKER_POLICY_VERSION };

        test('no container or no controller: true with no message posted', async () => {
            const createChannel = jest.fn();
            await expect(isGiphyWorkerReady({ container: null, createChannel })).resolves.toBe(true);
            const container = { controller: null, postMessage: jest.fn() };
            await expect(isGiphyWorkerReady({ container, createChannel })).resolves.toBe(true);
            expect(createChannel).not.toHaveBeenCalled();
            expect(container.postMessage).not.toHaveBeenCalled();
        });

        test('omitted container in node (no service worker) is true', async () => {
            await expect(isGiphyWorkerReady()).resolves.toBe(true);
        });

        test('posts the policy message with port2 and resolves true on ready', async () => {
            const { result, container, channel } = probe();
            expect(container.controller.postMessage).toHaveBeenCalledWith(
                { type: GIPHY_WORKER_POLICY_MESSAGE },
                [channel.port2]
            );
            reply(channel, READY_REPLY);
            await expect(result).resolves.toBe(true);
        });

        test.each([
            ['ready: false', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: false }],
            ['ready: false with a version', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: false, version: 1 }],
            ['missing version', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: true }],
            ['version 0', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: true, version: 0 }],
            ['fractional version', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: true, version: 1.5 }],
            ['string version', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: true, version: '1' }],
            ['ready as a string', { type: GIPHY_WORKER_POLICY_MESSAGE, ready: 'true', version: 1 }],
            ['wrong type', { type: 'OTHER', ready: true, version: 1 }],
            ['null data', null],
        ])('%s resolves false', async (_label, data) => {
            const { result, channel } = probe();
            reply(channel, data);
            await expect(result).resolves.toBe(false);
        });

        test('a changed controller resolves false', async () => {
            const { result, container, channel } = probe();
            container.controller = { postMessage: jest.fn() };
            reply(channel, READY_REPLY);
            await expect(result).resolves.toBe(false);
        });

        test('timeout resolves false', async () => {
            jest.useFakeTimers();
            const { result } = probe();
            await jest.advanceTimersByTimeAsync(GIPHY_WORKER_PROBE_TIMEOUT_MS);
            await expect(result).resolves.toBe(false);
        });

        test('two consecutive calls post two probes (no memo)', async () => {
            const container = fakeContainer();
            const first = probe({ container });
            reply(first.channel, READY_REPLY);
            await expect(first.result).resolves.toBe(true);

            const second = probe({ container });
            reply(second.channel, READY_REPLY);
            await expect(second.result).resolves.toBe(true);

            expect(container.controller.postMessage).toHaveBeenCalledTimes(2);
        });

        test('a channel that cannot be created resolves false', async () => {
            const container = fakeContainer();
            const createChannel = jest.fn(() => { throw new Error('no channel'); });
            await expect(isGiphyWorkerReady({ container, createChannel })).resolves.toBe(false);
            expect(container.controller.postMessage).not.toHaveBeenCalled();
        });

        describe('cleanup', () => {
            beforeEach(() => {
                jest.useFakeTimers();
            });

            test('after a reply: handler removed, both ports closed, no timer pending', async () => {
                const { result, channel } = probe();
                expect(jest.getTimerCount()).toBe(1);
                reply(channel, READY_REPLY);
                await expect(result).resolves.toBe(true);

                expect(channel.port1.onmessage).toBeNull();
                expect(channel.port1.close).toHaveBeenCalledTimes(1);
                expect(channel.port2.close).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
            });

            test('after a timeout: the same, and a later reply does not change false', async () => {
                const { result, channel } = probe();
                const handler = channel.port1.onmessage;
                await jest.advanceTimersByTimeAsync(GIPHY_WORKER_PROBE_TIMEOUT_MS);
                await expect(result).resolves.toBe(false);

                expect(channel.port1.onmessage).toBeNull();
                expect(channel.port1.close).toHaveBeenCalledTimes(1);
                expect(channel.port2.close).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);

                handler({ data: READY_REPLY });
                await expect(result).resolves.toBe(false);
                expect(channel.port1.close).toHaveBeenCalledTimes(1);
            });

            test('when postMessage throws: both ports closed and the result is false', async () => {
                const container = fakeContainer();
                container.controller.postMessage.mockImplementation(() => { throw new Error('DataCloneError'); });
                const { result, channel } = probe({ container });
                await expect(result).resolves.toBe(false);

                expect(channel.port1.onmessage).toBeNull();
                expect(channel.port1.close).toHaveBeenCalledTimes(1);
                expect(channel.port2.close).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
            });

            test('a port whose close throws does not prevent closing the other', async () => {
                const channel = fakeChannel();
                channel.port1.close.mockImplementation(() => { throw new Error('closed'); });
                const { result } = probe({ channel });
                reply(channel, READY_REPLY);
                await expect(result).resolves.toBe(true);
                expect(channel.port2.close).toHaveBeenCalledTimes(1);
            });
        });
    });
});
