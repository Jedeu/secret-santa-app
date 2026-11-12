/**
 * @jest-environment jsdom
 *
 * push-client: explicit per-device opt-in with a server-side epoch/revision fence.
 *
 * Two module instances ("realms" = tabs) share one localStorage. A stateful fake
 * server implements the status/register/unregister epoch+revision checks and can hold
 * a request BEFORE it is applied. "Closing" a realm = cancelPushOperations() on it and
 * discarding its response.
 */

const mockRealmUsers = {};
let mockLoadingRealm = null;
const mockGetToken = jest.fn();
const mockGetMessaging = jest.fn();
const mockOnMessage = jest.fn();

jest.mock('firebase/app', () => ({
    getApps: () => [{}],
}));

jest.mock('firebase/messaging', () => ({
    getMessaging: (...args) => mockGetMessaging(...args),
    getToken: (...args) => mockGetToken(...args),
    onMessage: (...args) => mockOnMessage(...args),
}));

jest.mock('@/lib/firebase-client', () => {
    const realm = mockLoadingRealm;
    return {
        clientAuth: {
            get currentUser() {
                return mockRealmUsers[realm] ?? null;
            },
        },
    };
});

const PREF_A = 'secret-santa-push-pref:uid-A';
const PREF_B = 'secret-santa-push-pref:uid-B';
const INTENT_KEY = 'secret-santa-push-intent';
const DEVICE_TOKEN = 'fcm-device-token-0000000001';
const USERS = { 'uid-A': 'user-A', 'uid-B': 'user-B' };

function makeUser(uid, realmId) {
    return { uid, getIdToken: jest.fn(async () => `idtoken:${uid}:${realmId}`) };
}

function openRealm(realmId, uid) {
    mockRealmUsers[realmId] = uid ? makeUser(uid, realmId) : null;
    let mod;
    mockLoadingRealm = realmId;
    jest.isolateModules(() => {
        mod = require('@/lib/push-client');
    });
    mockLoadingRealm = null;
    return mod;
}

function respond(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createServer() {
    const server = {
        epoch: 1,
        row: null, // { userId, enabled, revision }
        log: [],
        held: [],
        holds: [],
        failures: [],
        conflicts: [],
        counter: 0,
        onResponse: null,
    };

    server.nextRevision = () => {
        server.counter += 1;
        return `rev-${server.counter}`;
    };

    server.apply = (entry) => {
        const userId = USERS[entry.authUid];
        const current = server.row?.revision ?? null;

        if (entry.path === '/api/push/status') {
            return {
                status: 200,
                body: {
                    success: true,
                    epoch: server.epoch,
                    revision: current,
                    mine: !!server.row && server.row.userId === userId,
                    enabled: server.row?.enabled === true,
                },
            };
        }

        const { expectedEpoch, expectedRevision } = entry.body;
        if (expectedEpoch !== server.epoch || expectedRevision !== current) {
            return { status: 409, body: { error: 'stale', code: 'STALE_REGISTRATION' } };
        }

        if (entry.path === '/api/push/register') {
            server.row = { userId, enabled: entry.body.enabled, revision: server.nextRevision() };
            return {
                status: 200,
                body: { success: true, epoch: server.epoch, revision: server.row.revision, enabled: server.row.enabled },
            };
        }

        if (entry.path === '/api/push/unregister') {
            if (!server.row || server.row.userId !== userId) {
                return { status: 200, body: { success: true, epoch: server.epoch, revision: current, changed: false } };
            }
            server.row = { ...server.row, enabled: false, revision: server.nextRevision() };
            return { status: 200, body: { success: true, epoch: server.epoch, revision: server.row.revision, changed: true } };
        }

        return { status: 404, body: { error: 'not found' } };
    };

    server.fetch = jest.fn(async (path, init) => {
        const [, authUid, realm] = init.headers.Authorization.slice('Bearer '.length).split(':');
        const entry = { path, body: JSON.parse(init.body), authUid, realm };
        server.log.push(entry);

        const failureIndex = server.failures.findIndex((predicate) => predicate(entry));
        if (failureIndex >= 0) {
            server.failures.splice(failureIndex, 1);
            return respond(500, { error: 'Server error' });
        }

        const conflictIndex = server.conflicts.findIndex((predicate) => predicate(entry));
        if (conflictIndex >= 0) {
            return respond(409, { error: 'stale', code: 'STALE_REGISTRATION' });
        }

        const holdIndex = server.holds.findIndex((predicate) => predicate(entry));
        if (holdIndex >= 0) {
            server.holds.splice(holdIndex, 1);
            return new Promise((resolve, reject) => {
                entry.release = () => {
                    entry.result = server.apply(entry);
                    resolve(respond(entry.result.status, entry.result.body));
                    return entry.result;
                };
                // Rejects the fetch without applying it on the server.
                entry.fail = (error) => {
                    reject(error);
                };
                server.held.push(entry);
            });
        }

        entry.result = server.apply(entry);
        const response = respond(entry.result.status, entry.result.body);
        if (server.onResponse) server.onResponse(entry);
        return response;
    });

    return server;
}

async function until(predicate, label = 'condition') {
    for (let i = 0; i < 500; i += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Attach handlers at once so that no rejection is ever unhandled across clock advances.
function settle(p) {
    return p.then((value) => ({ value }), (error) => ({ error }));
}

function requestsFrom(server, realm, path) {
    return server.log.filter((entry) => entry.realm === realm && (!path || entry.path === path));
}

function setPermission(permission, requestPermission = jest.fn().mockResolvedValue(permission)) {
    const notification = { permission, requestPermission };
    Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: notification });
    return notification;
}

describe('push-client', () => {
    const originalEnv = {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        senderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        window.localStorage.clear();
        Object.keys(mockRealmUsers).forEach((key) => delete mockRealmUsers[key]);

        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = 'test-vapid-key';
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'test-sender-id';
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'test-app-id';

        setPermission('granted');
        Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() { } });
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ scope: '/' }) } });

        mockGetMessaging.mockReturnValue({});
        mockGetToken.mockResolvedValue(DEVICE_TOKEN);

        server = createServer();
        global.fetch = server.fetch;
    });

    afterAll(() => {
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = originalEnv.vapidKey;
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = originalEnv.senderId;
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID = originalEnv.appId;
    });

    test('isPushSupported returns true when browser and env requirements are met', () => {
        const realm = openRealm('r1', 'uid-A');
        expect(realm.isPushSupported()).toBe(true);
    });

    test('1. held enable vs newer disable, old realm closed: newer disable wins at a fresh revision', async () => {
        server.row = { userId: 'user-A', enabled: false, revision: 'R' };
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-A');
        server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/register');

        const p1 = r1.enablePushForCurrentUser({ authUid: 'uid-A' });
        await until(() => server.held.length === 1, 'held enable');
        expect(server.held[0].body).toMatchObject({ enabled: true, expectedRevision: 'R' });

        const result2 = await r2.disablePushForCurrentUser({ authUid: 'uid-A' });
        expect(result2).toBe('disabled');
        // Status already showed "disabled", yet the newer action still registers its state.
        const [r2Register] = requestsFrom(server, 'r2', '/api/push/register');
        expect(r2Register.body).toMatchObject({ enabled: false, expectedEpoch: 1, expectedRevision: 'R' });
        const r2Revision = server.row.revision;
        expect(r2Revision).not.toBe('R');

        r1.cancelPushOperations();
        const logLength = server.log.length;
        expect(server.held[0].release().status).toBe(409);

        expect(await p1).toBe('aborted');
        expect(server.row).toEqual({ userId: 'user-A', enabled: false, revision: r2Revision });
        expect(window.localStorage.getItem(PREF_A)).toBe('disabled');
        expect(server.log.slice(logLength).filter((entry) => entry.realm === 'r1')).toHaveLength(0);
    });

    test('2. held disable vs newer enable, old realm closed: newer enable wins at a fresh revision', async () => {
        server.row = { userId: 'user-A', enabled: true, revision: 'R' };
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-A');
        server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/register');

        const p1 = r1.disablePushForCurrentUser({ authUid: 'uid-A' });
        await until(() => server.held.length === 1, 'held disable');
        expect(server.held[0].body).toMatchObject({ enabled: false, expectedRevision: 'R' });

        expect(await r2.enablePushForCurrentUser({ authUid: 'uid-A' })).toBe('registered');
        const [r2Register] = requestsFrom(server, 'r2', '/api/push/register');
        expect(r2Register.body).toMatchObject({ enabled: true, expectedRevision: 'R' });
        const r2Revision = server.row.revision;

        r1.cancelPushOperations();
        expect(server.held[0].release().status).toBe(409);

        expect(await p1).toBe('aborted');
        expect(server.row).toEqual({ userId: 'user-A', enabled: true, revision: r2Revision });
        expect(window.localStorage.getItem(PREF_A)).toBe('enabled');
    });

    test('3. held sign-out unregister vs newer enable: unregister is rejected, row stays enabled', async () => {
        server.row = { userId: 'user-A', enabled: true, revision: 'R' };
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-A');
        server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/unregister');

        const release = r1.releasePushRegistration({ timeoutMs: 10000 });
        await until(() => server.held.length === 1, 'held unregister');
        expect(server.held[0].body).toMatchObject({ expectedRevision: 'R' });

        expect(await r2.enablePushForCurrentUser({ authUid: 'uid-A' })).toBe('registered');
        const r2Revision = server.row.revision;

        expect(server.held[0].release().status).toBe(409);
        expect(await release).toBe(false);
        expect(server.row).toEqual({ userId: 'user-A', enabled: true, revision: r2Revision });
    });

    test('4. an older request that commits first makes the newer one retry with fresh status and preference', async () => {
        server.row = { userId: 'user-A', enabled: false, revision: 'R' };
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-A');
        server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/register');

        const p1 = r1.enablePushForCurrentUser({ authUid: 'uid-A' });
        await until(() => server.held.length === 1, 'held enable');

        server.holds.push((entry) => entry.realm === 'r2' && entry.path === '/api/push/register');
        const p2 = r2.disablePushForCurrentUser({ authUid: 'uid-A' });
        await until(() => server.held.length === 2, 'held disable');

        // Realm 1's older request commits between realm 2's status and its register.
        expect(server.held[0].release().status).toBe(200);
        expect(server.held[1].release().status).toBe(409);

        expect(await p2).toBe('disabled');
        const r2Registers = requestsFrom(server, 'r2', '/api/push/register');
        expect(r2Registers).toHaveLength(2);
        expect(r2Registers[1].body).toMatchObject({ enabled: false });
        expect(requestsFrom(server, 'r2', '/api/push/status')).toHaveLength(2);
        expect(server.row.enabled).toBe(false);
        expect(await p1).toBe('aborted');
    });

    test('5. account switch: the other account registers its own state; the held request is rejected', async () => {
        window.localStorage.setItem(PREF_A, 'enabled');
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-B');
        server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/register');

        const p1 = r1.syncPushTokenIfGranted({ authUid: 'uid-A' });
        await until(() => server.held.length === 1, 'held sync');

        expect(await r2.syncPushTokenIfGranted({ authUid: 'uid-B' })).toBe('disabled');
        const logLength = server.log.length;

        expect(server.held[0].release().status).toBe(409);
        expect(await p1).toBe('aborted');
        expect(server.row).toMatchObject({ userId: 'user-B', enabled: false });
        expect(server.log.slice(logLength).filter((entry) => entry.realm === 'r1')).toHaveLength(0);
        expect(window.localStorage.getItem(PREF_B)).toBeNull();
    });

    test('6. every round registers: a matching row still gets status + register; no preference registers disabled without writing one', async () => {
        server.row = { userId: 'user-A', enabled: true, revision: 'R' };
        window.localStorage.setItem(PREF_A, 'enabled');
        const r1 = openRealm('r1', 'uid-A');

        expect(await r1.syncPushTokenIfGranted({ authUid: 'uid-A' })).toBe('registered');
        expect(server.log.map((entry) => entry.path)).toEqual(['/api/push/status', '/api/push/register']);
        expect(server.log[1].body).toMatchObject({ token: DEVICE_TOKEN, enabled: true, expectedRevision: 'R' });
        expect(server.row.revision).not.toBe('R');

        window.localStorage.clear();
        server.row = null;
        server.log.length = 0;
        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

        expect(await r1.syncPushTokenIfGranted({ authUid: 'uid-A' })).toBe('disabled');
        expect(server.log.map((entry) => entry.path)).toEqual(['/api/push/status', '/api/push/register']);
        expect(server.log[1].body).toMatchObject({ enabled: false, expectedRevision: null });
        expect(setItemSpy.mock.calls.filter(([key]) => key === PREF_A)).toHaveLength(0);
        expect(window.localStorage.getItem(PREF_A)).toBeNull();
    });

    test('6b. sync removes the legacy token key', async () => {
        window.localStorage.setItem('secret-santa-push-token', 'old-token');
        const r1 = openRealm('r1', 'uid-A');

        await r1.syncPushTokenIfGranted({ authUid: 'uid-A' });

        expect(window.localStorage.getItem('secret-santa-push-token')).toBeNull();
    });

    test('7. the preference is re-read on each retry round', async () => {
        server.row = { userId: 'user-A', enabled: true, revision: 'R' };
        window.localStorage.setItem(PREF_A, 'enabled');
        const r1 = openRealm('r1', 'uid-A');
        server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/register');

        const p1 = r1.syncPushTokenIfGranted({ authUid: 'uid-A' });
        await until(() => server.held.length === 1, 'held register');

        server.row = { ...server.row, revision: 'R-other-device' };
        window.localStorage.setItem(PREF_A, 'disabled');
        expect(server.held[0].release().status).toBe(409);

        expect(await p1).toBe('disabled');
        const registers = requestsFrom(server, 'r1', '/api/push/register');
        expect(registers).toHaveLength(2);
        expect(registers[1].body).toMatchObject({ enabled: false, expectedRevision: 'R-other-device' });
    });

    test('8. no rollback: a failed enable keeps the preference, throws, and a later sync registers', async () => {
        const r1 = openRealm('r1', 'uid-A');
        server.failures.push((entry) => entry.path === '/api/push/register');

        await expect(r1.enablePushForCurrentUser({ authUid: 'uid-A' })).rejects.toThrow('Server error');
        expect(window.localStorage.getItem(PREF_A)).toBe('enabled');

        expect(await r1.syncPushTokenIfGranted({ authUid: 'uid-A' })).toBe('registered');
        expect(server.row).toMatchObject({ userId: 'user-A', enabled: true });
    });

    test('9. a disable written at the instant of the guard check stops the older enable; no preference write from it', async () => {
        server.row = { userId: 'user-A', enabled: false, revision: 'R' };
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-A');

        let armed = false;
        let r2Promise = null;
        server.onResponse = (entry) => {
            if (entry.realm === 'r1' && entry.path === '/api/push/status') {
                armed = true;
            }
        };
        const originalGetItem = Storage.prototype.getItem;
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(key) {
            if (armed && key === INTENT_KEY) {
                armed = false;
                r2Promise = r2.disablePushForCurrentUser({ authUid: 'uid-A' });
            }
            return originalGetItem.call(this, key);
        });
        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

        const p1 = r1.enablePushForCurrentUser({ authUid: 'uid-A' });
        const r1PrefWrites = setItemSpy.mock.calls.filter(([key]) => key === PREF_A).length;
        expect(r1PrefWrites).toBe(1);

        expect(await p1).toBe('aborted');
        expect(r2Promise).not.toBeNull();
        expect(await r2Promise).toBe('disabled');

        expect(requestsFrom(server, 'r1', '/api/push/register')).toHaveLength(0);
        // Exactly two preference writes: realm 1's click and realm 2's click.
        expect(setItemSpy.mock.calls.filter(([key]) => key === PREF_A).map(([, value]) => value))
            .toEqual(['enabled', 'disabled']);
        expect(window.localStorage.getItem(PREF_A)).toBe('disabled');
        expect(server.row.enabled).toBe(false);
    });

    test.each([
        ['another realm disables', 'disabled'],
        ['another realm releases (sign-out)', 'enabled'],
        ['the same realm is cancelled', 'enabled'],
    ])('10. delayed permission: %s -> no storage write and no request after permission resolves', async (variant, expectedPreference) => {
        let resolvePermission;
        const notification = setPermission('default', jest.fn(() => new Promise((resolve) => { resolvePermission = resolve; })));
        const r1 = openRealm('r1', 'uid-A');
        const r2 = openRealm('r2', 'uid-A');

        const p1 = r1.enablePushForCurrentUser({ authUid: 'uid-A' });
        await until(() => typeof resolvePermission === 'function', 'permission prompt');

        if (variant === 'another realm disables') {
            await r2.disablePushForCurrentUser({ authUid: 'uid-A' });
        } else if (variant === 'another realm releases (sign-out)') {
            await r2.releasePushRegistration({ timeoutMs: 1000 });
        } else {
            r1.cancelPushOperations();
        }

        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
        server.fetch.mockClear();
        notification.permission = 'granted';
        resolvePermission('granted');

        expect(await p1).toBe('aborted');
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(server.fetch).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(PREF_A)).toBe(expectedPreference);
    });

    test('11. write audit: one preference write per click, before the first await; never by sync, release or retries', async () => {
        const r1 = openRealm('r1', 'uid-A');
        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
        const prefWrites = () => setItemSpy.mock.calls.filter(([key]) => key === PREF_A).length;

        // Enable with one forced 409 retry.
        server.holds.push((entry) => entry.path === '/api/push/register');
        const enable = r1.enablePushForCurrentUser({ authUid: 'uid-A' });
        expect(prefWrites()).toBe(1); // synchronous, before any await
        await until(() => server.held.length === 1, 'held register');
        server.row = { userId: 'user-B', enabled: true, revision: 'someone-else' };
        expect(server.held[0].release().status).toBe(409);
        expect(await enable).toBe('registered');
        expect(prefWrites()).toBe(1);

        await r1.syncPushTokenIfGranted({ authUid: 'uid-A' });
        expect(prefWrites()).toBe(1);

        const disable = r1.disablePushForCurrentUser({ authUid: 'uid-A' });
        expect(prefWrites()).toBe(2);
        await disable;
        expect(prefWrites()).toBe(2);

        await r1.releasePushRegistration({ timeoutMs: 1000 });
        expect(prefWrites()).toBe(2);
        expect(setItemSpy.mock.calls.filter(([key]) => key === PREF_B)).toHaveLength(0);
    });

    test('12a. a storage event refreshes subscribers only and sends no request', async () => {
        const r1 = openRealm('r1', 'uid-A');
        const subscriber = jest.fn();
        const unsubscribe = r1.subscribePushState(subscriber);

        window.dispatchEvent(new StorageEvent('storage', { key: PREF_A, newValue: 'enabled' }));
        window.dispatchEvent(new StorageEvent('storage', { key: INTENT_KEY }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(subscriber).toHaveBeenCalledTimes(2);
        expect(server.fetch).not.toHaveBeenCalled();
        unsubscribe();
    });

    test('12b. three 409s end as aborted', async () => {
        const r1 = openRealm('r1', 'uid-A');
        server.conflicts.push((entry) => entry.path === '/api/push/register');

        expect(await r1.enablePushForCurrentUser({ authUid: 'uid-A' })).toBe('aborted');
        expect(requestsFrom(server, 'r1', '/api/push/register')).toHaveLength(3);
        expect(requestsFrom(server, 'r1', '/api/push/status')).toHaveLength(3);
    });

    test('12c. release aborts at the timeout, writes a no-account intent, sends at most one unregister, keeps the preference', async () => {
        server.row = { userId: 'user-A', enabled: true, revision: 'R' };
        window.localStorage.setItem(PREF_A, 'enabled');
        const r1 = openRealm('r1', 'uid-A');
        server.holds.push((entry) => entry.path === '/api/push/unregister');

        const started = Date.now();
        expect(await r1.releasePushRegistration({ timeoutMs: 50 })).toBe(false);
        expect(Date.now() - started).toBeLessThan(5000);

        expect(JSON.parse(window.localStorage.getItem(INTENT_KEY))).toMatchObject({ authUid: null });
        expect(requestsFrom(server, 'r1', '/api/push/unregister').length).toBeLessThanOrEqual(1);
        expect(window.localStorage.getItem(PREF_A)).toBe('enabled');

        server.held.forEach((entry) => entry.release());
    });

    test('12d. a throwing getMessaging makes sync a no-op', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockGetMessaging.mockImplementation(() => {
            throw new Error('messaging unsupported');
        });
        const r1 = openRealm('r1', 'uid-A');

        expect(await r1.syncPushTokenIfGranted({ authUid: 'uid-A' })).toBe('skipped');
        expect(server.fetch).not.toHaveBeenCalled();
    });

    test('sync is skipped unless the uid matches and permission is granted', async () => {
        const r1 = openRealm('r1', 'uid-A');

        expect(await r1.syncPushTokenIfGranted({ authUid: 'uid-B' })).toBe('skipped');
        setPermission('default');
        expect(await r1.syncPushTokenIfGranted({ authUid: 'uid-A' })).toBe('skipped');
        expect(server.fetch).not.toHaveBeenCalled();
    });

    test('attachForegroundListener wires onMessage callback', () => {
        const r1 = openRealm('r1', 'uid-A');
        mockOnMessage.mockImplementation((_messaging, callback) => {
            callback({ data: { type: 'incoming_message' } });
            return jest.fn();
        });
        const handler = jest.fn();

        const unsubscribe = r1.attachForegroundListener(handler);

        expect(mockOnMessage).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            data: { type: 'incoming_message' },
        }));
        expect(typeof unsubscribe).toBe('function');
    });

    describe('bounded setup', () => {
        const REQUEST_TIMEOUT_MS = 15000;
        const PERMISSION_TIMEOUT_MS = 30000;
        const SETUP_TIMEOUT_MS = 45000;
        let unhandled;

        beforeEach(() => {
            jest.useFakeTimers();
            unhandled = jest.fn();
            process.on('unhandledRejection', unhandled);
        });

        afterEach(() => {
            process.off('unhandledRejection', unhandled);
            jest.useRealTimers();
        });

        // Advances the clock by 0 ms: drains pending promise work without firing a timer.
        function flush() {
            return jest.advanceTimersByTimeAsync(0);
        }

        async function expectClean() {
            await flush();
            expect(jest.getTimerCount()).toBe(0);
            expect(unhandled).not.toHaveBeenCalled();
        }

        function track(promise) {
            const run = { done: false, outcome: undefined };
            run.settled = settle(promise).then((outcome) => {
                run.done = true;
                run.outcome = outcome;
                return outcome;
            });
            return run;
        }

        function setReady(ready) {
            Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready } });
        }

        function pendingReady() {
            const ready = deferred();
            setReady(ready.promise);
            return ready;
        }

        // The first response whose path matches gets a body that stays pending. It rejects on
        // abort only when honoursAbort is set.
        function pendingBody(predicate, { honoursAbort }) {
            const hold = { body: deferred(), signal: null };
            const serverFetch = server.fetch;
            global.fetch = jest.fn(async (path, init) => {
                const response = await serverFetch(path, init);
                if (hold.signal || !predicate(path)) return response;
                hold.signal = init.signal;
                if (honoursAbort) {
                    init.signal.addEventListener('abort', () => {
                        hold.body.reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
                    });
                }
                return { ...response, json: () => hold.body.promise };
            });
            return hold;
        }

        test.each(['granted', 'rejection'])('B1. permission pending: rejects at 30 s with stage permission; a late %s starts nothing', async (late) => {
            const prompt = deferred();
            const notification = setPermission('default', jest.fn(() => prompt.promise));
            const r1 = openRealm('r1', 'uid-A');
            const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            // Invoked synchronously inside the click, before any await.
            expect(notification.requestPermission).toHaveBeenCalledTimes(1);
            expect(setItemSpy.mock.calls.filter(([key]) => key === PREF_A)).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'permission' });
            expect(mockGetToken).not.toHaveBeenCalled();
            expect(server.fetch).not.toHaveBeenCalled();

            setItemSpy.mockClear();
            if (late === 'granted') {
                notification.permission = 'granted';
                prompt.resolve('granted');
            } else {
                prompt.reject(new Error('prompt failed'));
            }
            await flush();

            expect(setItemSpy).not.toHaveBeenCalled();
            expect(mockGetToken).not.toHaveBeenCalled();
            expect(server.fetch).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(PREF_A)).toBe('enabled');
            await expectClean();
        });

        test.each([
            ['service-worker', 'resolve'],
            ['service-worker', 'reject'],
            ['token', 'resolve'],
            ['token', 'reject'],
            ['auth', 'resolve'],
            ['auth', 'reject'],
        ])('B2–B4. %s pending: enable rejects at 45 s with that stage; a late %s starts nothing', async (stage, late) => {
            const pending = deferred();
            if (stage === 'service-worker') {
                setReady(pending.promise);
            } else if (stage === 'token') {
                mockGetToken.mockImplementation(() => pending.promise);
            }
            const r1 = openRealm('r1', 'uid-A');
            if (stage === 'auth') {
                mockRealmUsers.r1.getIdToken.mockImplementation(() => pending.promise);
            }

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage });
            expect(window.localStorage.getItem(PREF_A)).toBe('enabled');
            expect(server.fetch).not.toHaveBeenCalled();
            const tokenCalls = mockGetToken.mock.calls.length;
            expect(tokenCalls).toBe(stage === 'service-worker' ? 0 : 1);

            if (late === 'resolve') {
                pending.resolve({ 'service-worker': { scope: '/' }, token: DEVICE_TOKEN, auth: 'idtoken:uid-A:r1' }[stage]);
            } else {
                pending.reject(new Error('late failure'));
            }
            await flush();

            expect(mockGetToken).toHaveBeenCalledTimes(tokenCalls);
            expect(server.fetch).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(PREF_A)).toBe('enabled');
            await expectClean();
        });

        test('B5a. a body that honours abort: rejects at 15 s with stage request after one fetch', async () => {
            const r1 = openRealm('r1', 'uid-A');
            const hold = pendingBody((path) => path === '/api/push/status', { honoursAbort: true });

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            expect(server.fetch).toHaveBeenCalledTimes(1);
            expect(hold.signal.aborted).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'request' });
            expect(hold.signal.aborted).toBe(true);
            expect(server.fetch).toHaveBeenCalledTimes(1);
            await expectClean();
        });

        test('B5b. a body that ignores abort: aborted at 15 s, rejects at 45 s; a late body starts nothing', async () => {
            const r1 = openRealm('r1', 'uid-A');
            const hold = pendingBody((path) => path === '/api/push/status', { honoursAbort: false });

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
            expect(hold.signal.aborted).toBe(true);
            expect(run.done).toBe(false);

            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - REQUEST_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'request' });
            expect(server.fetch).toHaveBeenCalledTimes(1);

            hold.body.resolve({ success: true, epoch: 1, revision: null, mine: false, enabled: false });
            await flush();

            expect(server.fetch).toHaveBeenCalledTimes(1);
            await expectClean();
        });

        test.each([
            ['/api/push/status', 'release'],
            ['/api/push/status', 'fail'],
            ['/api/push/register', 'release'],
            ['/api/push/register', 'fail'],
        ])('B6. held %s times out, a retry registers, then a late %s changes nothing', async (path, late) => {
            const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
            const r1 = openRealm('r1', 'uid-A');
            server.holds.push((entry) => entry.path === path);

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            expect(server.held).toHaveLength(1);
            // The request timer aborted at 15 s; the held fetch ignored it.
            expect(server.fetch.mock.calls.at(-1)[1].signal.aborted).toBe(true);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'request' });

            const beforeRetry = server.log.length;
            expect(await r1.retryPushRegistration({ authUid: 'uid-A' })).toBe('registered');
            expect(server.log.slice(beforeRetry).map((entry) => entry.path))
                .toEqual(['/api/push/status', '/api/push/register']);
            const rowAfterRetry = { ...server.row };
            expect(rowAfterRetry).toMatchObject({ userId: 'user-A', enabled: true });
            const afterRetry = server.log.length;

            const [old] = server.held;
            if (late === 'release') {
                expect(old.release().status).toBe(path === '/api/push/status' ? 200 : 409);
            } else {
                old.fail(new TypeError('Failed to fetch'));
            }
            await flush();

            expect(server.log).toHaveLength(afterRetry);
            expect(server.row).toEqual(rowAfterRetry);
            expect(setItemSpy.mock.calls.filter(([key]) => key === PREF_A)).toHaveLength(1);
            await expectClean();
        });

        test('B6b. a late ready after a timeout and a successful retry starts nothing', async () => {
            const ready = pendingReady();
            const r1 = openRealm('r1', 'uid-A');

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'service-worker' });

            setReady(Promise.resolve({ scope: '/' }));
            expect(await r1.retryPushRegistration({ authUid: 'uid-A' })).toBe('registered');
            const tokenCalls = mockGetToken.mock.calls.length;
            const fetches = server.fetch.mock.calls.length;

            ready.resolve({ scope: '/' });
            await flush();

            expect(mockGetToken).toHaveBeenCalledTimes(tokenCalls);
            expect(server.fetch).toHaveBeenCalledTimes(fetches);
            await expectClean();
        });

        test.each([
            ['the preference is disabled'],
            ['no account is given'],
            ['no user is signed in'],
            ['another user is signed in'],
            ['permission is default'],
        ])('B7. retry is skipped when %s: no request, no prompt, no storage write', async (variant) => {
            window.localStorage.setItem(PREF_A, variant === 'the preference is disabled' ? 'disabled' : 'enabled');
            const notification = setPermission(variant === 'permission is default' ? 'default' : 'granted');
            const signedIn = {
                'no user is signed in': null,
                'another user is signed in': 'uid-B',
            }[variant];
            const r1 = openRealm('r1', signedIn === undefined ? 'uid-A' : signedIn);
            const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');

            const result = variant === 'no account is given'
                ? await r1.retryPushRegistration()
                : await r1.retryPushRegistration({ authUid: 'uid-A' });

            expect(result).toBe('skipped');
            expect(server.fetch).not.toHaveBeenCalled();
            expect(mockGetToken).not.toHaveBeenCalled();
            expect(notification.requestPermission).not.toHaveBeenCalled();
            expect(setItemSpy).not.toHaveBeenCalled();
            await expectClean();
        });

        test('B8. superseded while ready is pending: resolves aborted at the deadline and does not reject', async () => {
            pendingReady();
            const r1 = openRealm('r1', 'uid-A');

            const run = track(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await flush();
            // Another tab's newer intent; this tab notices it at its deadline.
            window.localStorage.setItem(INTENT_KEY, JSON.stringify({ id: 'other-tab-intent', authUid: 'uid-A' }));

            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome).toEqual({ value: 'aborted' });
            expect(server.fetch).not.toHaveBeenCalled();
            await expectClean();
        });

        test('B9. cancel during ready resolves aborted with no clock advance and releases the deadline', async () => {
            pendingReady();
            const r1 = openRealm('r1', 'uid-A');

            const run = settle(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            expect(jest.getTimerCount()).toBe(1);

            r1.cancelPushOperations();
            expect(jest.getTimerCount()).toBe(0);
            expect(await run).toEqual({ value: 'aborted' });
            expect(server.fetch).not.toHaveBeenCalled();
            await expectClean();
        });

        test.each([
            ['held headers', 'resolve'],
            ['held headers', 'reject'],
            ['a pending body', 'resolve'],
            ['a pending body', 'reject'],
        ])('B10. cancel while %s ignore abort: timers released and signal aborted synchronously; a late %s starts nothing', async (kind, late) => {
            const r1 = openRealm('r1', 'uid-A');
            let hold = null;
            if (kind === 'held headers') {
                server.holds.push((entry) => entry.path === '/api/push/status');
            } else {
                hold = pendingBody((path) => path === '/api/push/status', { honoursAbort: false });
            }

            const run = settle(r1.enablePushForCurrentUser({ authUid: 'uid-A' }));
            await flush();
            expect(server.fetch).toHaveBeenCalledTimes(1);
            const { signal } = server.fetch.mock.calls[0][1];
            // The setup deadline and the request timer.
            expect(jest.getTimerCount()).toBe(2);

            r1.cancelPushOperations();
            expect(jest.getTimerCount()).toBe(0);
            expect(signal.aborted).toBe(true);
            expect(await run).toEqual({ value: 'aborted' });

            if (kind === 'held headers') {
                const [entry] = server.held;
                if (late === 'resolve') {
                    entry.release();
                } else {
                    entry.fail(new TypeError('Failed to fetch'));
                }
            } else if (late === 'resolve') {
                hold.body.resolve({ success: true, epoch: 1, revision: null, mine: false, enabled: false });
            } else {
                hold.body.reject(new Error('body failed'));
            }
            await flush();

            expect(server.fetch).toHaveBeenCalledTimes(1);
            await expectClean();
        });

        test('B11a. disable with getToken pending rejects at 45 s with stage token; the preference stays disabled', async () => {
            window.localStorage.setItem(PREF_A, 'enabled');
            const token = deferred();
            mockGetToken.mockImplementation(() => token.promise);
            const r1 = openRealm('r1', 'uid-A');

            const run = track(r1.disablePushForCurrentUser({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'token' });
            expect(window.localStorage.getItem(PREF_A)).toBe('disabled');

            token.resolve(DEVICE_TOKEN);
            await flush();

            expect(server.fetch).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(PREF_A)).toBe('disabled');
            await expectClean();
        });

        test('B11b. sync with ready pending rejects at 45 s with stage service-worker and never prompts', async () => {
            window.localStorage.setItem(PREF_A, 'enabled');
            const notification = setPermission('granted');
            pendingReady();
            const r1 = openRealm('r1', 'uid-A');

            const run = track(r1.syncPushTokenIfGranted({ authUid: 'uid-A' }));
            await jest.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS - 1);
            expect(run.done).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome.error).toMatchObject({ code: 'PUSH_TIMEOUT', stage: 'service-worker' });

            expect(notification.requestPermission).not.toHaveBeenCalled();
            expect(mockGetToken).not.toHaveBeenCalled();
            expect(server.fetch).not.toHaveBeenCalled();
            await expectClean();
        });

        test('B12. release with a held unregister that ignores abort returns false at 3 s and releases its timers', async () => {
            server.row = { userId: 'user-A', enabled: true, revision: 'R' };
            window.localStorage.setItem(PREF_A, 'enabled');
            const r1 = openRealm('r1', 'uid-A');
            const r2 = openRealm('r2', 'uid-A');
            server.holds.push((entry) => entry.realm === 'r1' && entry.path === '/api/push/unregister');

            const run = track(r1.releasePushRegistration({ timeoutMs: 3000 }));
            await jest.advanceTimersByTimeAsync(2999);
            expect(run.done).toBe(false);
            expect(server.held).toHaveLength(1);
            // The release limit and the 15 s request timer.
            expect(jest.getTimerCount()).toBe(2);

            await jest.advanceTimersByTimeAsync(1);
            expect(run.outcome).toEqual({ value: false });
            expect(jest.getTimerCount()).toBe(0);
            expect(server.fetch.mock.calls.at(-1)[1].signal.aborted).toBe(true);
            expect(window.localStorage.getItem(PREF_A)).toBe('enabled');

            // A newer action rotates the revision; the late unregister is then decided by the server.
            expect(await r2.enablePushForCurrentUser({ authUid: 'uid-A' })).toBe('registered');
            const rowAfterEnable = { ...server.row };
            const r1Requests = requestsFrom(server, 'r1').length;

            expect(server.held[0].release().status).toBe(409);
            await flush();

            expect(server.row).toEqual(rowAfterEnable);
            expect(requestsFrom(server, 'r1')).toHaveLength(r1Requests);
            await expectClean();
        });
    });
});
