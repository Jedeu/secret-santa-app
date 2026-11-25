/**
 * The custom service worker's GIPHY storage policy: on activation and on every picker
 * probe it removes GIPHY entries from the legacy `cross-origin` cache and their rows in
 * Workbox's `workbox-expiration` database, and acknowledges only when both succeeded.
 *
 * CacheStorage and IndexedDB are hand-written fakes that model only what the worker uses.
 * Synthetic URLs only; no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GIPHY_WORKER_POLICY_MESSAGE, GIPHY_WORKER_POLICY_VERSION } from '@/lib/giphy-client';

jest.mock('firebase/app', () => ({
    getApps: () => [],
    initializeApp: jest.fn(() => ({ name: '[DEFAULT]' })),
}));

jest.mock('firebase/messaging/sw', () => ({
    getMessaging: jest.fn(() => ({})),
    onBackgroundMessage: jest.fn(),
}), { virtual: true });

const ROOT = path.join(__dirname, '..', '..');
const WORKER_PATH = path.join(ROOT, 'worker', 'index.js');
const TIMESTAMPS_MODEL_PATH = path.join(ROOT, 'node_modules', 'workbox-expiration', 'models', 'CacheTimestampsModel.js');

const CROSS_ORIGIN = 'cross-origin';
const DB_NAME = 'workbox-expiration';
const STORE = 'cache-entries';

const API_URL = 'https://api.giphy.com/v1/gifs/trending?api_key=e2e-giphy-placeholder&limit=24&offset=0&rating=pg-13';
const MEDIA_URL = 'https://media2.giphy.com/media/SyntheticGif01/200w.webp';
const BARE_URL = 'https://giphy.com/embed/SyntheticGif01';
const OTHER_URL = 'https://res.cloudinary.com/unit-cloud/image/upload/v1/ss-2026-synthetic.png';
const LOOKALIKE_URL = 'https://giphy.com.evil.example/x.gif';
const PAGE_URL = 'https://app.example.test/';

const READY = { type: GIPHY_WORKER_POLICY_MESSAGE, version: GIPHY_WORKER_POLICY_VERSION, ready: true };
const NOT_READY = { type: GIPHY_WORKER_POLICY_MESSAGE, ready: false };

let listeners;
let events;
let fakeCaches;
let fakeIdb;
let consoleSpies;

function row(cacheName, url, timestamp = 1700000000000) {
    return { id: `${cacheName}|${url}`, cacheName, url, timestamp };
}

// --- CacheStorage fake ---

function createCaches(initial = {}) {
    const stores = new Map();
    Object.entries(initial).forEach(([name, urls]) => {
        stores.set(name, new Map(urls.map((url) => [url, `body:${url}`])));
    });
    const fail = { has: false, open: false, keys: false, delete: false, sticky: new Set() };
    const deletes = [];

    function cacheFor(name) {
        const entries = stores.get(name);
        return {
            keys: jest.fn(async () => {
                if (fail.keys) throw new Error('keys failed');
                return Array.from(entries.keys(), (url) => ({ url }));
            }),
            delete: jest.fn(async (request, options) => {
                if (fail.delete) throw new Error('delete failed');
                deletes.push({ cache: name, url: request.url, options });
                if (fail.sticky.has(request.url)) return false;
                return entries.delete(request.url);
            }),
        };
    }

    const api = {
        has: jest.fn(async (name) => {
            if (fail.has) throw new Error('has failed');
            return stores.has(name);
        }),
        open: jest.fn(async (name) => {
            if (fail.open) throw new Error('open failed');
            if (!stores.has(name)) stores.set(name, new Map());
            return cacheFor(name);
        }),
        keys: jest.fn(async () => Array.from(stores.keys())),
        delete: jest.fn(async (name) => stores.delete(name)),
        match: jest.fn(async () => undefined),
    };

    return {
        api,
        stores,
        fail,
        deletes,
        urls: (name) => Array.from(stores.get(name)?.keys() || []),
        add: (name, url) => {
            if (!stores.has(name)) stores.set(name, new Map());
            stores.get(name).set(url, `body:${url}`);
        },
    };
}

// --- IndexedDB fake (databases, open, connection, transaction, store) ---

function createIndexedDB(options = {}) {
    const { exists = true, version = 1, hasStore = true, rows = [] } = options;
    // An explicit `keyPath: undefined` must stay undefined.
    const keyPath = Object.prototype.hasOwnProperty.call(options, 'keyPath') ? options.keyPath : 'id';
    const state = { exists, version, hasStore, keyPath, rows: rows.map((r) => ({ ...r })) };
    const fail = {
        databases: null,
        openThrows: false,
        openMode: 'success',
        transactionThrows: false,
        getAll: false,
        delete: false,
        abortTx: false,
    };
    const log = { opens: [], dbs: [], delivered: [], transactions: [], stores: [], upgradeTransactions: [] };

    function makeDb() {
        const db = {
            name: DB_NAME,
            version: state.version,
            objectStoreNames: { contains: jest.fn((name) => state.hasStore && name === STORE) },
            transaction: jest.fn((storeName, mode) => {
                if (fail.transactionThrows) throw new Error('transaction failed');
                return makeTransaction(storeName, mode);
            }),
            createObjectStore: jest.fn(),
            deleteObjectStore: jest.fn(),
            close: jest.fn(() => {
                events.push('db-close');
            }),
        };
        log.dbs.push(db);
        return db;
    }

    function makeTransaction(storeName, mode) {
        let working = state.rows.map((r) => ({ ...r }));
        let finished = false;
        let outstanding = 0;

        const tx = {
            storeName,
            mode,
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: jest.fn(() => store),
            abort: jest.fn(() => {
                if (finished) throw new Error('InvalidStateError');
                finishAbort();
            }),
        };

        function finishAbort() {
            finished = true;
            events.push('tx-abort');
            queueMicrotask(() => tx.onabort?.({ target: tx }));
        }

        // Commits once no request is pending after control returns (like IndexedDB).
        function scheduleCommit() {
            queueMicrotask(() => {
                if (finished || outstanding > 0) return;
                if (fail.abortTx) {
                    finishAbort();
                    return;
                }
                finished = true;
                state.rows = working;
                events.push('tx-complete');
                tx.oncomplete?.({ target: tx });
            });
        }

        function requestFailed(request) {
            request.error = new Error('request failed');
            request.onerror?.({ target: request });
            if (!finished) {
                tx.onerror?.({ target: request });
            }
            if (!finished) {
                finishAbort();
            }
        }

        const store = {
            name: STORE,
            keyPath: state.keyPath,
            getAll: jest.fn(() => {
                const request = { onsuccess: null, onerror: null, result: undefined, error: null };
                outstanding += 1;
                queueMicrotask(() => {
                    outstanding -= 1;
                    if (finished) return;
                    if (fail.getAll) {
                        requestFailed(request);
                        return;
                    }
                    request.result = working.map((r) => ({ ...r }));
                    request.onsuccess?.({ target: request });
                    scheduleCommit();
                });
                return request;
            }),
            delete: jest.fn((key) => {
                const request = { onsuccess: null, onerror: null, result: undefined, error: null };
                outstanding += 1;
                queueMicrotask(() => {
                    outstanding -= 1;
                    if (finished) return;
                    if (fail.delete) {
                        requestFailed(request);
                        return;
                    }
                    working = working.filter((r) => r.id !== key);
                    request.onsuccess?.({ target: request });
                    scheduleCommit();
                });
                return request;
            }),
            put: jest.fn(),
            add: jest.fn(),
            clear: jest.fn(),
        };

        log.transactions.push(tx);
        log.stores.push(store);
        scheduleCommit();
        return tx;
    }

    function deliver(request, db) {
        request.result = db;
        log.delivered.push(db);
        request.onsuccess?.({ target: request });
    }

    const api = {
        databases: jest.fn(async () => {
            if (fail.databases === 'reject') throw new Error('databases failed');
            if (fail.databases === 'notArray') return { length: 0 };
            const list = [{ name: 'firestore/unit/main', version: 12 }];
            if (state.exists) list.push({ name: DB_NAME, version: state.version });
            return list;
        }),
        open: jest.fn((...args) => {
            log.opens.push(args);
            if (fail.openThrows) throw new Error('open threw');
            const request = {
                onsuccess: null,
                onerror: null,
                onblocked: null,
                onupgradeneeded: null,
                result: undefined,
                error: null,
                transaction: null,
            };
            queueMicrotask(() => {
                const mode = fail.openMode;
                if (mode === 'error') {
                    request.error = new Error('open failed');
                    request.onerror?.({ target: request });
                    return;
                }
                if (mode === 'blocked') {
                    request.onblocked?.({ target: request });
                    return;
                }
                if (mode === 'blockedThenSuccess') {
                    request.onblocked?.({ target: request });
                    deliver(request, makeDb());
                    return;
                }
                if (mode === 'errorThenSuccess') {
                    request.onerror?.({ target: request });
                    deliver(request, makeDb());
                    return;
                }
                if (mode === 'upgrade' || mode === 'upgradeThenSuccess') {
                    const upgradeTransaction = { abort: jest.fn() };
                    log.upgradeTransactions.push(upgradeTransaction);
                    const upgradeDb = makeDb();
                    request.transaction = upgradeTransaction;
                    request.result = upgradeDb;
                    request.onupgradeneeded?.({ target: request, oldVersion: 0, newVersion: 1 });
                    if (mode === 'upgradeThenSuccess') {
                        deliver(request, upgradeDb);
                    } else {
                        request.error = new Error('AbortError');
                        request.onerror?.({ target: request });
                    }
                    return;
                }
                deliver(request, makeDb());
            });
            return request;
        }),
        deleteDatabase: jest.fn(),
        cmp: jest.fn(),
    };

    return { api, state, fail, log };
}

// --- Harness ---

function install({ caches = createCaches(), idb = createIndexedDB({ exists: false }) } = {}) {
    fakeCaches = caches;
    fakeIdb = idb;
    global.caches = caches.api;
    if (idb) {
        global.indexedDB = idb.api;
    } else {
        delete global.indexedDB;
    }
    return { caches, idb };
}

function sendProbe({ onAck } = {}) {
    let resolveAck;
    const ack = new Promise((resolve) => {
        resolveAck = resolve;
    });
    const port = {
        postMessage: jest.fn((message) => {
            events.push('ack');
            if (onAck) onAck();
            resolveAck(message);
        }),
    };
    let waited = null;
    const event = {
        data: { type: GIPHY_WORKER_POLICY_MESSAGE },
        ports: [port],
        waitUntil: jest.fn((promise) => {
            waited = promise;
        }),
    };
    listeners.message(event);
    return { ack, port, event, waited: () => waited };
}

async function probe(options) {
    const sent = sendProbe(options);
    expect(sent.event.waitUntil).toHaveBeenCalledTimes(1);
    const message = await sent.ack;
    await expect(sent.waited()).resolves.toBeUndefined();
    expect(sent.port.postMessage).toHaveBeenCalledTimes(1);
    return message;
}

function deliveredDb() {
    expect(fakeIdb.log.delivered).toHaveLength(1);
    return fakeIdb.log.delivered[0];
}

describe('worker GIPHY policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        listeners = {};
        events = [];
        fakeCaches = null;
        fakeIdb = null;
        consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) => jest.spyOn(console, method));
        global.self = {
            registration: { showNotification: jest.fn() },
            addEventListener: jest.fn((type, handler) => {
                listeners[type] = handler;
            }),
        };
        global.clients = { matchAll: jest.fn(() => Promise.resolve([])), openWindow: jest.fn() };
        jest.isolateModules(() => {
            require(WORKER_PATH);
        });
    });

    afterEach(() => {
        if (fakeCaches) {
            expect(fakeCaches.api.delete).not.toHaveBeenCalled();
            expect(fakeCaches.api.keys).not.toHaveBeenCalled();
        }
        if (fakeIdb) {
            expect(fakeIdb.api.deleteDatabase).not.toHaveBeenCalled();
            fakeIdb.log.dbs.forEach((db) => {
                expect(db.createObjectStore).not.toHaveBeenCalled();
                expect(db.deleteObjectStore).not.toHaveBeenCalled();
            });
            fakeIdb.log.stores.forEach((store) => {
                expect(store.put).not.toHaveBeenCalled();
                expect(store.add).not.toHaveBeenCalled();
                expect(store.clear).not.toHaveBeenCalled();
            });
        }
        consoleSpies.forEach((spy) => {
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
        delete global.self;
        delete global.clients;
        delete global.caches;
        delete global.indexedDB;
    });

    describe('registration', () => {
        test('existing listeners stay registered alongside activate and message', () => {
            expect(Object.keys(listeners).sort()).toEqual(['activate', 'message', 'notificationclick', 'push']);
            expect(listeners.notificationclick).toEqual(expect.any(Function));
        });

        test('constants equal the giphy-client exports', async () => {
            const source = fs.readFileSync(WORKER_PATH, 'utf8');
            expect(source).toContain(`const GIPHY_POLICY_MESSAGE = '${GIPHY_WORKER_POLICY_MESSAGE}';`);
            expect(source).toContain(`const GIPHY_POLICY_VERSION = ${GIPHY_WORKER_POLICY_VERSION};`);

            install();
            await expect(probe()).resolves.toEqual(READY);
        });

        test('the worker source has no fetch listener, cache deletion by name or Workbox import', () => {
            const source = fs.readFileSync(WORKER_PATH, 'utf8');
            expect(source).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
            expect(source).not.toMatch(/caches\.delete\(/);
            expect(source).not.toMatch(/deleteDatabase/);
            expect(source).not.toMatch(/createObjectStore/);
            expect(source).not.toMatch(/from ['"]workbox/);
            expect(source).not.toMatch(/console\./);
        });
    });

    describe('CacheStorage bodies', () => {
        test('only GIPHY-host keys in cross-origin are deleted', async () => {
            const caches = createCaches({
                [CROSS_ORIGIN]: [API_URL, MEDIA_URL, BARE_URL, OTHER_URL, LOOKALIKE_URL],
                'static-image-assets': [MEDIA_URL],
                pages: [PAGE_URL],
            });
            install({ caches });

            await expect(probe()).resolves.toEqual(READY);

            expect(caches.urls(CROSS_ORIGIN)).toEqual([OTHER_URL, LOOKALIKE_URL]);
            expect(caches.urls('static-image-assets')).toEqual([MEDIA_URL]);
            expect(caches.urls('pages')).toEqual([PAGE_URL]);
            expect(caches.deletes.map((entry) => entry.url).sort()).toEqual([API_URL, BARE_URL, MEDIA_URL].sort());
            caches.deletes.forEach((entry) => {
                expect(entry.cache).toBe(CROSS_ORIGIN);
                expect(entry.options).toEqual({ ignoreVary: true });
            });
            expect(caches.api.open).toHaveBeenCalledTimes(1);
            expect(caches.api.open).toHaveBeenCalledWith(CROSS_ORIGIN);
        });

        test('a missing cache is never opened', async () => {
            const caches = createCaches({ pages: [PAGE_URL] });
            install({ caches });

            await expect(probe()).resolves.toEqual(READY);
            expect(caches.api.has).toHaveBeenCalledWith(CROSS_ORIGIN);
            expect(caches.api.open).not.toHaveBeenCalled();
            expect(caches.stores.has(CROSS_ORIGIN)).toBe(false);
        });

        test('a surviving GIPHY key replies ready: false and stops before the metadata', async () => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL, API_URL] });
            caches.fail.sticky.add(MEDIA_URL);
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, API_URL)] });
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(NOT_READY);
            expect(idb.api.databases).not.toHaveBeenCalled();
            expect(idb.api.open).not.toHaveBeenCalled();
        });
    });

    describe('expiration metadata', () => {
        test('cross-origin GIPHY rows are deleted, others kept, connection closed, ACK after oncomplete', async () => {
            const kept = [
                row(CROSS_ORIGIN, OTHER_URL, 1700000000001),
                row('static-image-assets', MEDIA_URL, 1700000000002),
                row('pages', PAGE_URL, 1700000000003),
                row(CROSS_ORIGIN, LOOKALIKE_URL, 1700000000004),
            ];
            const giphyRows = [row(CROSS_ORIGIN, API_URL), row(CROSS_ORIGIN, MEDIA_URL), row(CROSS_ORIGIN, BARE_URL)];
            const caches = createCaches({ [CROSS_ORIGIN]: [API_URL, MEDIA_URL] });
            const idb = createIndexedDB({ rows: [...giphyRows, ...kept] });
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(READY);

            expect(idb.state.rows).toEqual(kept);
            expect(idb.api.open).toHaveBeenCalledTimes(1);
            expect(idb.log.opens[0]).toEqual([DB_NAME]);
            const db = deliveredDb();
            expect(db.transaction).toHaveBeenCalledTimes(1);
            expect(db.transaction).toHaveBeenCalledWith(STORE, 'readwrite');
            expect(db.close).toHaveBeenCalledTimes(1);
            const [store] = idb.log.stores;
            expect(store.delete.mock.calls.map(([key]) => key).sort()).toEqual(giphyRows.map((r) => r.id).sort());
            expect(events.indexOf('tx-complete')).toBeGreaterThanOrEqual(0);
            expect(events.indexOf('tx-complete')).toBeLessThan(events.indexOf('db-close'));
            expect(events.indexOf('db-close')).toBeLessThan(events.indexOf('ack'));
        });

        test('database absent: indexedDB.open is never called and the ACK is ready', async () => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL] });
            const idb = createIndexedDB({ exists: false });
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(READY);
            expect(idb.api.databases).toHaveBeenCalledTimes(1);
            expect(idb.api.open).not.toHaveBeenCalled();
            expect(caches.urls(CROSS_ORIGIN)).toEqual([]);
        });

        test('orphan metadata with no cross-origin cache: rows deleted, ready', async () => {
            const caches = createCaches({});
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, MEDIA_URL), row(CROSS_ORIGIN, OTHER_URL)] });
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(READY);
            expect(idb.state.rows).toEqual([row(CROSS_ORIGIN, OTHER_URL)]);
            expect(caches.api.open).not.toHaveBeenCalled();
        });

        test('orphan metadata with a cross-origin cache holding no GIPHY bodies: rows deleted, ready', async () => {
            const caches = createCaches({ [CROSS_ORIGIN]: [OTHER_URL] });
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, API_URL), row(CROSS_ORIGIN, OTHER_URL)] });
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(READY);
            expect(idb.state.rows).toEqual([row(CROSS_ORIGIN, OTHER_URL)]);
            expect(caches.urls(CROSS_ORIGIN)).toEqual([OTHER_URL]);
        });

        test('bodies purged but metadata fails: not ready; the next probe with working metadata removes the rows', async () => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL] });
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, MEDIA_URL)] });
            idb.fail.getAll = true;
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(NOT_READY);
            expect(caches.urls(CROSS_ORIGIN)).toEqual([]);
            expect(idb.state.rows).toEqual([row(CROSS_ORIGIN, MEDIA_URL)]);

            idb.fail.getAll = false;
            await expect(probe()).resolves.toEqual(READY);
            expect(idb.state.rows).toEqual([]);
            idb.log.delivered.forEach((db) => expect(db.close).toHaveBeenCalledTimes(1));
        });

        test.each([
            ['url', 'url'],
            ['an array key path', ['cacheName', 'url']],
            ['null', null],
            ['undefined', undefined],
            ['a different case', 'ID'],
        ])('a wrong key path (%s) aborts with no read or delete', async (_label, keyPath) => {
            const original = [row(CROSS_ORIGIN, MEDIA_URL)];
            const idb = createIndexedDB({ keyPath, rows: original });
            install({ idb });

            await expect(probe()).resolves.toEqual(NOT_READY);

            const [tx] = idb.log.transactions;
            const [store] = idb.log.stores;
            expect(tx.abort).toHaveBeenCalledTimes(1);
            expect(store.getAll).not.toHaveBeenCalled();
            expect(store.delete).not.toHaveBeenCalled();
            expect(deliveredDb().close).toHaveBeenCalledTimes(1);
            expect(idb.state.rows).toEqual(original);
        });
    });

    describe('fail closed', () => {
        const giphyRow = row(CROSS_ORIGIN, MEDIA_URL);

        const CASES = [
            ['indexedDB undefined', () => ({ idb: null }), { opened: false }],
            ['databases not a function', ({ idb }) => { delete idb.api.databases; }, { opened: false }],
            ['databases() rejecting', ({ idb }) => { idb.fail.databases = 'reject'; }, { opened: false }],
            ['databases() not returning an array', ({ idb }) => { idb.fail.databases = 'notArray'; }, { opened: false }],
            ['open throwing', ({ idb }) => { idb.fail.openThrows = true; }, { opened: false }],
            ['open onerror', ({ idb }) => { idb.fail.openMode = 'error'; }, { opened: false }],
            ['open onblocked', ({ idb }) => { idb.fail.openMode = 'blocked'; }, { opened: false }],
            ['onupgradeneeded', ({ idb }) => { idb.fail.openMode = 'upgrade'; }, { opened: false, upgrade: true }],
            ['version !== 1', ({ idb }) => { idb.state.version = 2; }, { opened: true }],
            ['store missing', ({ idb }) => { idb.state.hasStore = false; }, { opened: true }],
            ['transaction() throwing', ({ idb }) => { idb.fail.transactionThrows = true; }, { opened: true }],
            ['getAll error', ({ idb }) => { idb.fail.getAll = true; }, { opened: true }],
            ['delete error', ({ idb }) => { idb.fail.delete = true; }, { opened: true }],
            ['transaction abort', ({ idb }) => { idb.fail.abortTx = true; }, { opened: true }],
            ['a cross-origin row without a string url', ({ idb }) => {
                idb.state.rows.push({ id: 'cross-origin|unknown', cacheName: CROSS_ORIGIN, url: 42, timestamp: 1 });
            }, { opened: true }],
            ['a cross-origin row without an id', ({ idb }) => {
                idb.state.rows.push({ cacheName: CROSS_ORIGIN, url: OTHER_URL, timestamp: 1 });
            }, { opened: true }],
            ['caches.has rejecting', ({ caches }) => { caches.fail.has = true; }, { opened: false }],
            ['caches.open rejecting', ({ caches }) => { caches.fail.open = true; }, { opened: false }],
            ['cache.keys rejecting', ({ caches }) => { caches.fail.keys = true; }, { opened: false }],
            ['cache.delete rejecting', ({ caches }) => { caches.fail.delete = true; }, { opened: false }],
        ];

        test.each(CASES)('%s replies { type, ready: false } with no version', async (_label, arrange, expectations) => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL, OTHER_URL] });
            let idb = createIndexedDB({ rows: [giphyRow, row(CROSS_ORIGIN, OTHER_URL)] });
            const override = arrange({ caches, idb });
            if (override && override.idb === null) {
                idb = null;
            }
            install({ caches, idb });

            const message = await probe();
            expect(message).toEqual(NOT_READY);
            expect(message).not.toHaveProperty('version');

            if (idb) {
                // Nothing was deleted from the metadata on failure.
                expect(idb.state.rows).toContainEqual(giphyRow);
                if (expectations.opened) {
                    const db = deliveredDb();
                    expect(db.close).toHaveBeenCalledTimes(1);
                } else {
                    expect(idb.log.delivered).toHaveLength(0);
                }
                if (expectations.upgrade) {
                    const [upgradeTransaction] = idb.log.upgradeTransactions;
                    expect(upgradeTransaction.abort).toHaveBeenCalledTimes(1);
                    idb.log.dbs.forEach((db) => {
                        expect(db.transaction).not.toHaveBeenCalled();
                    });
                }
            }
        });
    });

    describe('late connection after rejection', () => {
        test.each([
            ['onblocked then a late onsuccess', 'blockedThenSuccess'],
            ['onerror then a late onsuccess', 'errorThenSuccess'],
        ])('%s: the delivered connection is closed and no transaction is opened', async (_label, openMode) => {
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, MEDIA_URL)] });
            idb.fail.openMode = openMode;
            install({ idb });

            await expect(probe()).resolves.toEqual(NOT_READY);
            const db = deliveredDb();
            expect(db.close).toHaveBeenCalledTimes(1);
            expect(db.transaction).not.toHaveBeenCalled();
            expect(idb.state.rows).toEqual([row(CROSS_ORIGIN, MEDIA_URL)]);
        });

        test('onupgradeneeded then onsuccess: the connection is closed and never used', async () => {
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, MEDIA_URL)] });
            idb.fail.openMode = 'upgradeThenSuccess';
            install({ idb });

            await expect(probe()).resolves.toEqual(NOT_READY);
            const [upgradeTransaction] = idb.log.upgradeTransactions;
            expect(upgradeTransaction.abort).toHaveBeenCalledTimes(1);
            const db = deliveredDb();
            expect(db.close).toHaveBeenCalledTimes(1);
            expect(db.transaction).not.toHaveBeenCalled();
            expect(db.objectStoreNames.contains).not.toHaveBeenCalled();
        });
    });

    describe('late old write', () => {
        test('a GIPHY body and row written after an ACK are removed before the next ACK', async () => {
            const caches = createCaches({ [CROSS_ORIGIN]: [OTHER_URL] });
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, OTHER_URL)] });
            install({ caches, idb });

            await expect(probe()).resolves.toEqual(READY);

            caches.add(CROSS_ORIGIN, MEDIA_URL);
            idb.state.rows.push(row(CROSS_ORIGIN, MEDIA_URL));

            let atAck = null;
            const message = await probe({
                onAck: () => {
                    atAck = { urls: caches.urls(CROSS_ORIGIN), rows: idb.state.rows.map((r) => r.url) };
                },
            });
            expect(message).toEqual(READY);
            expect(atAck).toEqual({ urls: [OTHER_URL], rows: [OTHER_URL] });
        });
    });

    describe('activation', () => {
        function activate() {
            let waited = null;
            const event = { waitUntil: jest.fn((promise) => { waited = promise; }) };
            listeners.activate(event);
            expect(event.waitUntil).toHaveBeenCalledTimes(1);
            return waited;
        }

        test('activation purges GIPHY bodies and rows', async () => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL, OTHER_URL] });
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, MEDIA_URL)] });
            install({ caches, idb });

            await expect(activate()).resolves.toBeUndefined();
            expect(caches.urls(CROSS_ORIGIN)).toEqual([OTHER_URL]);
            expect(idb.state.rows).toEqual([]);
        });

        test.each([
            ['rejecting cache APIs', ({ caches }) => { caches.fail.has = true; }],
            ['rejecting database APIs', ({ idb }) => { idb.fail.databases = 'reject'; }],
            ['a failing transaction', ({ idb }) => { idb.fail.abortTx = true; }],
        ])('with %s, waitUntil resolves and a following probe still replies not ready', async (_label, arrange) => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL] });
            const idb = createIndexedDB({ rows: [row(CROSS_ORIGIN, MEDIA_URL)] });
            arrange({ caches, idb });
            install({ caches, idb });

            await expect(activate()).resolves.toBeUndefined();
            expect(Object.keys(listeners).sort()).toEqual(['activate', 'message', 'notificationclick', 'push']);
            await expect(probe()).resolves.toEqual(NOT_READY);
        });
    });

    describe('ignored messages', () => {
        test.each([
            ['another message type', { data: { type: 'OTHER' }, withPort: true }],
            ['no data', { data: null, withPort: true }],
            ['a missing port', { data: { type: GIPHY_WORKER_POLICY_MESSAGE }, withPort: false }],
            ['an empty ports list', { data: { type: GIPHY_WORKER_POLICY_MESSAGE }, withPort: 'empty' }],
        ])('%s is ignored', (_label, { data, withPort }) => {
            const caches = createCaches({ [CROSS_ORIGIN]: [MEDIA_URL] });
            install({ caches });
            const port = { postMessage: jest.fn() };
            const event = { data, waitUntil: jest.fn() };
            if (withPort === true) event.ports = [port];
            if (withPort === 'empty') event.ports = [];

            listeners.message(event);

            expect(event.waitUntil).not.toHaveBeenCalled();
            expect(port.postMessage).not.toHaveBeenCalled();
            expect(caches.api.has).not.toHaveBeenCalled();
            expect(caches.urls(CROSS_ORIGIN)).toEqual([MEDIA_URL]);
        });
    });

    describe('schema tripwire', () => {
        test('the installed workbox-expiration model still has the schema the worker relies on', () => {
            const source = fs.readFileSync(TIMESTAMPS_MODEL_PATH, 'utf8');
            expect(source).toContain("const DB_NAME = 'workbox-expiration'");
            expect(source).toContain("const CACHE_OBJECT_STORE = 'cache-entries'");
            expect(source).toContain('openDB(DB_NAME, 1,');
            expect(source).toContain("keyPath: 'id'");
            expect(source).toContain("this._cacheName + '|' + normalizeURL(url)");
        });
    });
});
