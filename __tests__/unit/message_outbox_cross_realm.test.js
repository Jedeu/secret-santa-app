/** @jest-environment jsdom */
/**
 * Two module instances (two tabs) sharing one localStorage. Every outbox operation is
 * a single-key write, so neither tab can overwrite the other's queued messages, and a
 * late failure can never resurrect an item another tab delivered.
 */

const mockAuthState = { currentUser: null };

jest.mock('@/lib/firebase-client', () => ({
    clientAuth: {
        get currentUser() {
            return mockAuthState.currentUser;
        }
    }
}));

const OWNER = 'uid-a';
const FROM = 'user-a';
const TO = 'user-b';
const CONV = 'santa_user-a_recipient_user-b';
const V1_KEY = 'secret-santa-message-outbox-v1';
const ITEM = 'secret-santa-message-outbox-v2:item:';
const STATE = 'secret-santa-message-outbox-v2:state:';
const DONE = 'secret-santa-message-outbox-v2:done:';

function openRealm() {
    let mod;
    jest.isolateModules(() => {
        mod = require('@/lib/message-outbox');
    });
    return mod;
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function response(status) {
    return { ok: status >= 200 && status < 300, status, json: async () => ({ error: status >= 400 ? 'err' : undefined }) };
}

async function until(predicate) {
    for (let i = 0; i < 200; i += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error('Timed out');
}

function idsSent(fetchImpl) {
    return fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).clientMessageId);
}

describe('message outbox across realms', () => {
    beforeEach(() => {
        window.localStorage.clear();
        mockAuthState.currentUser = { uid: OWNER, getIdToken: jest.fn().mockResolvedValue('token-a') };
        jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        Math.random.mockRestore();
    });

    test('A delivered in realm 1 while realm 2 gets a late 503: A is not live and never re-sent', async () => {
        const realm1 = openRealm();
        const realm2 = openRealm();
        const a = realm1.enqueueMessage({ ownerUid: OWNER, fromUserId: FROM, toId: TO, conversationId: CONV, content: 'A' });

        const late = deferred();
        const fetch2 = jest.fn(() => late.promise);
        const drain2 = realm2.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetch2 });
        await until(() => fetch2.mock.calls.length === 1);

        const fetch1 = jest.fn().mockResolvedValue(response(200));
        const result1 = await realm1.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetch1 });
        expect(result1.delivered).toBe(1);

        late.resolve(response(503));
        await drain2;

        expect(window.localStorage.getItem(ITEM + a.clientMessageId)).toBeNull();
        expect(window.localStorage.getItem(STATE + a.clientMessageId)).toBeNull();
        expect(window.localStorage.getItem(DONE + a.clientMessageId)).toBeTruthy();
        expect(realm2.getConversationOutboxMessages({ fromUserId: FROM, conversationId: CONV })).toHaveLength(0);

        const fetchAgain = jest.fn().mockResolvedValue(response(200));
        await realm2.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetchAgain });
        await realm1.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetchAgain });
        expect(fetchAgain).not.toHaveBeenCalled();
    });

    test('B enqueued in realm 2 during realm 1\'s pending fetch survives and is delivered', async () => {
        const realm1 = openRealm();
        const realm2 = openRealm();
        const a = realm1.enqueueMessage({ ownerUid: OWNER, fromUserId: FROM, toId: TO, conversationId: CONV, content: 'A' });

        const pending = deferred();
        const fetch1 = jest.fn(() => pending.promise);
        const drain1 = realm1.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetch1 });
        await until(() => fetch1.mock.calls.length === 1);

        const b = realm2.enqueueMessage({ ownerUid: OWNER, fromUserId: FROM, toId: TO, conversationId: CONV, content: 'B' });

        pending.resolve(response(200));
        await drain1;

        expect(window.localStorage.getItem(DONE + a.clientMessageId)).toBeTruthy();
        expect(window.localStorage.getItem(ITEM + b.clientMessageId)).toBeTruthy();

        const fetch2 = jest.fn().mockResolvedValue(response(200));
        const result2 = await realm2.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetch2 });

        expect(result2.delivered).toBe(1);
        expect(idsSent(fetch2)).toEqual([b.clientMessageId]);
        expect(window.localStorage.getItem(DONE + b.clientMessageId)).toBeTruthy();
    });

    test('both realms import the same v1 array: one payload per id, v1 byte-identical, delivered ids not re-imported', async () => {
        const createdAt = new Date(Date.now() - 60_000).toISOString();
        const v1 = JSON.stringify([
            { clientMessageId: 'x-1', fromUserId: FROM, toId: TO, conversationId: CONV, content: 'X', createdAt, status: 'pending' },
            { clientMessageId: 'y-1', fromUserId: FROM, toId: TO, conversationId: CONV, content: 'Y first', createdAt, status: 'pending' },
            { clientMessageId: 'y-1', fromUserId: FROM, toId: TO, conversationId: CONV, content: 'Y duplicate', createdAt, status: 'pending' },
        ]);
        window.localStorage.setItem(V1_KEY, v1);

        const realm1 = openRealm();
        const realm2 = openRealm();
        const fromRealm1 = realm1.getConversationOutboxMessages({ fromUserId: FROM, conversationId: CONV });
        const fromRealm2 = realm2.getConversationOutboxMessages({ fromUserId: FROM, conversationId: CONV });

        expect(fromRealm1.map((item) => item.clientMessageId).sort()).toEqual(['x-1', 'y-1']);
        expect(fromRealm2.map((item) => item.clientMessageId).sort()).toEqual(['x-1', 'y-1']);
        expect(JSON.parse(window.localStorage.getItem(ITEM + 'y-1')).content).toBe('Y first');
        expect(window.localStorage.getItem(V1_KEY)).toBe(v1);

        const fetch1 = jest.fn().mockResolvedValue(response(200));
        await realm1.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetch1 });
        expect(idsSent(fetch1).sort()).toEqual(['x-1', 'y-1']);

        // Realm 2 re-imports the untouched v1 array: delivered ids stay delivered.
        expect(realm2.getConversationOutboxMessages({ fromUserId: FROM, conversationId: CONV })).toHaveLength(0);
        const fetch2 = jest.fn().mockResolvedValue(response(200));
        await realm2.drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl: fetch2 });
        expect(fetch2).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(V1_KEY)).toBe(v1);
    });

    test('an existing different v2 payload is never overwritten by a v1 entry with the same id', () => {
        const createdAt = new Date(Date.now() - 60_000).toISOString();
        const v2Payload = JSON.stringify({
            clientMessageId: 'z-1', ownerUid: OWNER, fromUserId: FROM, toId: TO,
            conversationId: CONV, content: 'v2 content', createdAt,
        });
        window.localStorage.setItem(ITEM + 'z-1', v2Payload);
        window.localStorage.setItem(V1_KEY, JSON.stringify([
            { clientMessageId: 'z-1', fromUserId: FROM, toId: TO, conversationId: CONV, content: 'v1 content', createdAt, status: 'pending' },
        ]));

        const realm1 = openRealm();
        const items = realm1.getConversationOutboxMessages({ fromUserId: FROM, conversationId: CONV });

        expect(items).toHaveLength(1);
        expect(items[0].content).toBe('v2 content');
        expect(window.localStorage.getItem(ITEM + 'z-1')).toBe(v2Payload);
    });
});
