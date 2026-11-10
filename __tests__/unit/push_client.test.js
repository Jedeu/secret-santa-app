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
            return new Promise((resolve) => {
                entry.release = () => {
                    entry.result = server.apply(entry);
                    resolve(respond(entry.result.status, entry.result.body));
                    return entry.result;
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
});
