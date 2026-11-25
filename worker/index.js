import { getApps, initializeApp } from 'firebase/app';
import { getMessaging } from 'firebase/messaging/sw';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function hasMessagingConfig() {
    return Boolean(
        firebaseConfig.apiKey
        && firebaseConfig.projectId
        && firebaseConfig.messagingSenderId
        && firebaseConfig.appId
    );
}

if (hasMessagingConfig()) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    // Initializing messaging lets the FCM SDK display the server-provided
    // notification payload (title, body, icon, badge, conversation tag) on its own.
    // No custom background handler: a second, app-rendered notification would duplicate it.
    getMessaging(app);
}

// Home Screen badge: the server sends the receiver's unread total with each push.
// This listener only sets the badge; FCM still draws the notification.
function readUnreadTotal(event) {
    try {
        const value = event.data?.json()?.data?.unreadTotal;
        if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
        return Number(value);
    } catch {
        return null;
    }
}

self.addEventListener('push', (event) => {
    const total = readUnreadTotal(event);
    const setAppBadge = self.navigator?.setAppBadge;
    if (total === null || typeof setAppBadge !== 'function') return;
    event.waitUntil(Promise.resolve()
        .then(() => setAppBadge.call(self.navigator, total))
        .catch(() => undefined));
});

self.addEventListener('notificationclick', (event) => {
    event.notification?.close();

    const targetUrl = event.notification?.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ('focus' in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }

            return null;
        })
    );
});

// --- GIPHY storage policy ---
//
// GIPHY requests are NetworkOnly with `cache: 'no-store'` (next.config.js). Older workers
// cached them in the default `cross-origin` runtime cache. On activation and before every
// GIF picker request, remove GIPHY entries from that cache and their rows in Workbox's
// expiration database, and acknowledge only when both succeeded. Nothing here logs, and
// every thrown Error carries a fixed message with no URL.

const GIPHY_POLICY_MESSAGE = 'SECRET_SANTA_GIPHY_POLICY';
const GIPHY_POLICY_VERSION = 1;
const LEGACY_CROSS_ORIGIN_CACHE = 'cross-origin';
// Workbox 7.1 expiration metadata (workbox-expiration/models/CacheTimestampsModel.js):
// database 'workbox-expiration' version 1, object store 'cache-entries' (keyPath 'id'),
// rows { id: `${cacheName}|${url}`, cacheName, url, timestamp }.
const EXPIRATION_DB_NAME = 'workbox-expiration';
const EXPIRATION_DB_VERSION = 1;
const EXPIRATION_STORE = 'cache-entries';
const EXPIRATION_KEY_PATH = 'id';

function isGiphyUrl(value) {
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host === 'giphy.com' || host.endsWith('.giphy.com');
    } catch {
        return false;
    }
}

async function purgeGiphyCacheEntries() {
    if (!(await caches.has(LEGACY_CROSS_ORIGIN_CACHE))) return;
    const cache = await caches.open(LEGACY_CROSS_ORIGIN_CACHE);
    const requests = await cache.keys();
    for (const request of requests) {
        if (isGiphyUrl(request?.url)) {
            await cache.delete(request, { ignoreVary: true });
        }
    }
    const remaining = await cache.keys();
    for (const request of remaining) {
        if (isGiphyUrl(request?.url)) {
            throw new Error('GIPHY cache entries remain');
        }
    }
}

// Opens the existing expiration database without a version; never creates or upgrades it.
function openExistingExpirationDb() {
    return new Promise((resolve, reject) => {
        let settled = false;
        let forbidden = false;
        const fail = () => {
            if (settled) return;
            settled = true;
            reject(new Error('Expiration database unavailable'));
        };

        let request;
        try {
            request = indexedDB.open(EXPIRATION_DB_NAME);
        } catch {
            fail();
            return;
        }

        request.onupgradeneeded = () => {
            // The database vanished between listing and opening: never create it.
            forbidden = true;
            try {
                request.transaction.abort();
            } catch {
                // Ignored.
            }
            fail();
        };
        request.onerror = () => fail();
        request.onblocked = () => fail();
        request.onsuccess = () => {
            let db = null;
            try {
                db = request.result;
            } catch {
                db = null;
            }
            if (settled || forbidden || !db) {
                // A late or forbidden connection is closed and never used.
                if (db) {
                    try {
                        db.close();
                    } catch {
                        // Ignored.
                    }
                }
                fail();
                return;
            }
            settled = true;
            resolve(db);
        };
    });
}

// Deletes `cross-origin` GIPHY rows in one readwrite transaction; settles with it.
function deleteGiphyExpirationRows(db) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        let tx;
        try {
            tx = db.transaction(EXPIRATION_STORE, 'readwrite');
        } catch {
            finish(new Error('Expiration transaction failed'));
            return;
        }
        const abort = () => {
            try {
                tx.abort();
            } catch {
                // Already finished.
            }
        };

        tx.oncomplete = () => finish(null);
        tx.onerror = () => finish(new Error('Expiration transaction failed'));
        tx.onabort = () => finish(new Error('Expiration transaction aborted'));

        try {
            const store = tx.objectStore(EXPIRATION_STORE);
            // Key-path check before any read or delete: `row.id` must address the row.
            if (store.keyPath !== EXPIRATION_KEY_PATH) {
                abort();
                finish(new Error('Unknown expiration schema'));
                return;
            }
            const all = store.getAll();
            all.onerror = () => {
                abort();
                finish(new Error('Expiration read failed'));
            };
            all.onsuccess = () => {
                try {
                    const rows = all.result;
                    if (!Array.isArray(rows)) {
                        abort();
                        finish(new Error('Unknown expiration rows'));
                        return;
                    }
                    for (const row of rows) {
                        if (!row || row.cacheName !== LEGACY_CROSS_ORIGIN_CACHE) continue;
                        if (typeof row.url !== 'string' || row.id === undefined) {
                            abort();
                            finish(new Error('Unknown expiration row'));
                            return;
                        }
                        if (isGiphyUrl(row.url)) {
                            store.delete(row.id);
                        }
                    }
                } catch {
                    abort();
                    finish(new Error('Expiration cleanup failed'));
                }
            };
        } catch {
            abort();
            finish(new Error('Expiration cleanup failed'));
        }
    });
}

async function purgeGiphyExpirationRows() {
    if (typeof indexedDB === 'undefined' || !indexedDB || typeof indexedDB.databases !== 'function') {
        // Existence cannot be established without creating a database.
        throw new Error('Expiration database cannot be listed');
    }
    const list = await indexedDB.databases();
    if (!Array.isArray(list)) {
        throw new Error('Expiration database list unavailable');
    }
    if (!list.some((entry) => entry && entry.name === EXPIRATION_DB_NAME)) {
        // Never created; nothing to open.
        return;
    }

    const db = await openExistingExpirationDb();
    try {
        if (db.version !== EXPIRATION_DB_VERSION || !db.objectStoreNames || !db.objectStoreNames.contains(EXPIRATION_STORE)) {
            throw new Error('Unknown expiration schema');
        }
        await deleteGiphyExpirationRows(db);
    } finally {
        try {
            db.close();
        } catch {
            // Ignored.
        }
    }
}

// Bodies first, so a failure can only leave metadata, which the next probe removes.
async function purgeGiphyEntries() {
    await purgeGiphyCacheEntries();
    await purgeGiphyExpirationRows();
}

self.addEventListener('activate', (event) => {
    event.waitUntil(purgeGiphyEntries().then(() => undefined, () => undefined));
});

self.addEventListener('message', (event) => {
    if (event?.data?.type !== GIPHY_POLICY_MESSAGE) return;
    const port = event.ports?.[0];
    if (!port) return;
    event.waitUntil(
        purgeGiphyEntries()
            .then(
                () => port.postMessage({ type: GIPHY_POLICY_MESSAGE, version: GIPHY_POLICY_VERSION, ready: true }),
                () => port.postMessage({ type: GIPHY_POLICY_MESSAGE, ready: false })
            )
            .catch(() => undefined)
    );
});
