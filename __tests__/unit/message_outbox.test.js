/** @jest-environment jsdom */
import {
    MESSAGE_OUTBOX_STORAGE_KEY,
    OUTBOX_ITEM_PREFIX,
    OUTBOX_STATE_PREFIX,
    OUTBOX_DONE_PREFIX,
    enqueueMessage,
    getConversationOutboxMessages,
    drainOutboxForUser,
    clearDeliveredOrExpired,
    cancelOutboxDrains,
} from '@/lib/message-outbox';

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

function makeAuthUser(uid, token = `token-${uid}`) {
    return { uid, getIdToken: jest.fn().mockResolvedValue(token) };
}

function makeResponse({ ok, status, error = null }) {
    return {
        ok,
        status,
        json: async () => (error ? { error } : {}),
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function flushPromises() {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
}

function enqueue(content, overrides = {}) {
    return enqueueMessage({
        ownerUid: OWNER,
        fromUserId: FROM,
        toId: TO,
        conversationId: CONV,
        content,
        ...overrides,
    });
}

function pendingItems() {
    return getConversationOutboxMessages({ fromUserId: FROM, conversationId: CONV });
}

describe('message-outbox', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.localStorage.clear();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-02-12T20:00:00.000Z'));
        mockAuthState.currentUser = makeAuthUser(OWNER, 'token-123');
        jest.spyOn(Math, 'random').mockReturnValue(0);
        cancelOutboxDrains();
    });

    afterEach(() => {
        jest.useRealTimers();
        Math.random.mockRestore();
    });

    test('enqueueMessage stores one immutable payload key per item', () => {
        const queued = enqueue('Hello there');

        expect(queued.clientMessageId).toBeTruthy();
        expect(queued.status).toBe('pending');
        expect(JSON.parse(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + queued.clientMessageId))).toEqual({
            clientMessageId: queued.clientMessageId,
            ownerUid: OWNER,
            fromUserId: FROM,
            toId: TO,
            conversationId: CONV,
            content: 'Hello there',
            createdAt: '2026-02-12T20:00:00.000Z',
        });
        expect(window.localStorage.getItem(MESSAGE_OUTBOX_STORAGE_KEY)).toBeNull();

        expect(pendingItems()).toHaveLength(1);
        expect(pendingItems()[0]).toMatchObject({
            fromUserId: FROM,
            toId: TO,
            content: 'Hello there',
            status: 'pending',
            attemptCount: 0,
        });
    });

    test('enqueueMessage requires an owner uid', () => {
        expect(() => enqueue('x', { ownerUid: null })).toThrow('Invalid outbox enqueue payload');
    });

    test('drainOutboxForUser delivers, tombstones and sends senderUserId', async () => {
        const queued = enqueue('Hello there');

        const fetchImpl = jest.fn().mockResolvedValue(makeResponse({ ok: true, status: 200 }));
        const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });

        expect(result).toMatchObject({ delivered: 1, retried: 0, failed: 0 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        const [, request] = fetchImpl.mock.calls[0];
        expect(request.headers.Authorization).toBe('Bearer token-123');
        expect(JSON.parse(request.body)).toEqual({
            toId: TO,
            content: 'Hello there',
            conversationId: CONV,
            clientMessageId: queued.clientMessageId,
            clientCreatedAt: queued.createdAt,
            senderUserId: FROM,
        });

        expect(pendingItems()).toHaveLength(0);
        expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + queued.clientMessageId)).toBeNull();
        expect(window.localStorage.getItem(OUTBOX_DONE_PREFIX + queued.clientMessageId)).toBeTruthy();
    });

    test('returns zeros unless the signed-in uid matches the owner', async () => {
        enqueue('Hello there');
        const fetchImpl = jest.fn();

        mockAuthState.currentUser = makeAuthUser('uid-other');
        const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });

        expect(result).toEqual({ delivered: 0, retried: 0, failed: 0, skipped: 0 });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('transient failures stay pending with backoff', async () => {
        enqueue('Hello there');

        const fetchImpl = jest.fn().mockResolvedValue(makeResponse({
            ok: false,
            status: 503,
            error: 'Temporary outage'
        }));

        const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
        expect(result.retried).toBe(1);

        const [pending] = pendingItems();
        expect(pending.status).toBe('pending');
        expect(pending.attemptCount).toBe(1);
        expect(new Date(pending.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    });

    test('permanent failures are marked failed and kept visible', async () => {
        const queued = enqueue('Hello there');

        const fetchImpl = jest.fn().mockResolvedValue(makeResponse({
            ok: false,
            status: 409,
            error: 'Message id conflict'
        }));

        const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
        expect(result.failed).toBe(1);

        const [failed] = pendingItems();
        expect(failed.clientMessageId).toBe(queued.clientMessageId);
        expect(failed.status).toBe('failed');
        expect(failed.nextAttemptAt).toBeNull();
    });

    test('401 can recover by forcing a token refresh once on the captured user', async () => {
        enqueue('Hello there');
        const authUser = mockAuthState.currentUser;
        authUser.getIdToken
            .mockResolvedValueOnce('stale-token')
            .mockResolvedValueOnce('fresh-token');

        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(makeResponse({ ok: false, status: 401, error: 'Unauthorized' }))
            .mockResolvedValueOnce(makeResponse({ ok: true, status: 200 }));

        const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
        expect(result.delivered).toBe(1);
        expect(authUser.getIdToken).toHaveBeenCalledWith(false);
        expect(authUser.getIdToken).toHaveBeenCalledWith(true);
        expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
    });

    describe('message B enqueued during A\'s pending fetch', () => {
        test.each([
            ['success', [makeResponse({ ok: true, status: 200 })]],
            ['failure', [makeResponse({ ok: false, status: 503, error: 'down' })]],
            ['401 then refreshed success', [
                makeResponse({ ok: false, status: 401, error: 'expired' }),
                makeResponse({ ok: true, status: 200 }),
            ]],
        ])('survives A\'s %s and is delivered by the follow-up pass', async (_label, aResponses) => {
            const a = enqueue('A');
            const aGate = deferred();
            const sent = [];
            let aCalls = 0;

            const fetchImpl = jest.fn((url, options) => {
                const body = JSON.parse(options.body);
                sent.push(body.clientMessageId);
                if (body.clientMessageId === a.clientMessageId) {
                    aCalls += 1;
                    if (aCalls === 1) {
                        return aGate.promise.then(() => aResponses[0]);
                    }
                    return Promise.resolve(aResponses[aCalls - 1]);
                }
                return Promise.resolve(makeResponse({ ok: true, status: 200 }));
            });

            const drain = drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
            await flushPromises();
            expect(fetchImpl).toHaveBeenCalledTimes(1);

            const b = enqueue('B');
            const followUp = drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });

            // B's payload is intact while A is in flight.
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + b.clientMessageId)).toBeTruthy();

            aGate.resolve();
            await drain;
            await followUp;

            expect(sent.filter((id) => id === b.clientMessageId)).toHaveLength(1);
            expect(window.localStorage.getItem(OUTBOX_DONE_PREFIX + b.clientMessageId)).toBeTruthy();
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + b.clientMessageId)).toBeNull();
        });
    });

    describe('auth switch', () => {
        test('during the token await: no request is sent and the item stays pending with the same id', async () => {
            const queued = enqueue('Hello there');
            const tokenGate = deferred();
            const authUser = mockAuthState.currentUser;
            authUser.getIdToken.mockReturnValueOnce(tokenGate.promise);
            const fetchImpl = jest.fn();

            const drain = drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
            await flushPromises();

            mockAuthState.currentUser = makeAuthUser('uid-b');
            tokenGate.resolve('token-for-a');
            await drain;

            expect(fetchImpl).not.toHaveBeenCalled();
            const [pending] = pendingItems();
            expect(pending.clientMessageId).toBe(queued.clientMessageId);
            expect(pending.status).toBe('pending');
            expect(pending.attemptCount).toBe(0);
        });

        test('during the fetch: a late failure writes nothing and the next account never sends the item', async () => {
            const queued = enqueue('Hello there');
            const fetchGate = deferred();
            const fetchImpl = jest.fn(() => fetchGate.promise);

            const drain = drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
            await flushPromises();
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer token-123');

            mockAuthState.currentUser = makeAuthUser('uid-b', 'token-b');
            fetchGate.resolve(makeResponse({ ok: false, status: 503, error: 'down' }));
            await drain;

            const [pending] = pendingItems();
            expect(pending.clientMessageId).toBe(queued.clientMessageId);
            expect(pending.attemptCount).toBe(0);

            // The other account drains its own queue only.
            await drainOutboxForUser({ ownerUid: 'uid-b', fromUserId: FROM, fetchImpl });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('cancelOutboxDrains stops an in-flight drain before the next item', async () => {
            enqueue('first');
            jest.setSystemTime(new Date('2026-02-12T20:00:01.000Z'));
            enqueue('second');
            const fetchGate = deferred();
            const fetchImpl = jest.fn(() => fetchGate.promise);

            const drain = drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });
            await flushPromises();
            cancelOutboxDrains();
            fetchGate.resolve(makeResponse({ ok: false, status: 503 }));
            await drain;

            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(pendingItems().every((item) => item.attemptCount === 0)).toBe(true);
        });
    });

    describe('legacy v1 import and garbage collection', () => {
        test('imports valid v1 entries as unowned payloads and leaves v1 byte-identical', () => {
            const v1 = JSON.stringify([
                {
                    clientMessageId: 'legacy-1', fromUserId: FROM, toId: TO, conversationId: CONV,
                    content: 'Old but valid', createdAt: '2026-02-12T19:00:00.000Z',
                    attemptCount: 1, nextAttemptAt: '2026-02-12T19:00:05.000Z', status: 'pending', lastError: 'x',
                },
                {
                    clientMessageId: 'expired-1', fromUserId: FROM, toId: TO, conversationId: CONV,
                    content: 'Too old', createdAt: '2026-02-01T00:00:00.000Z', status: 'pending',
                },
                { clientMessageId: 'malformed-1', fromUserId: FROM, content: 'no recipient', createdAt: '2026-02-12T19:00:00.000Z' },
                {
                    clientMessageId: 'delivered-1', fromUserId: FROM, toId: TO, conversationId: CONV,
                    content: 'Done', createdAt: '2026-02-12T19:00:00.000Z', status: 'delivered',
                },
            ]);
            window.localStorage.setItem(MESSAGE_OUTBOX_STORAGE_KEY, v1);

            const items = pendingItems();

            expect(items.map((item) => item.clientMessageId)).toEqual(['legacy-1']);
            expect(items[0]).toMatchObject({ ownerUid: null, attemptCount: 1 });
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + 'expired-1')).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + 'malformed-1')).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + 'delivered-1')).toBeNull();
            expect(window.localStorage.getItem(MESSAGE_OUTBOX_STORAGE_KEY)).toBe(v1);
        });

        test('legacy (unowned) items are drained by the owning user without being re-stamped', async () => {
            window.localStorage.setItem(MESSAGE_OUTBOX_STORAGE_KEY, JSON.stringify([{
                clientMessageId: 'legacy-2', fromUserId: FROM, toId: TO, conversationId: CONV,
                content: 'From before the upgrade', createdAt: '2026-02-12T19:59:00.000Z', status: 'pending',
            }]));
            const fetchImpl = jest.fn().mockResolvedValue(makeResponse({ ok: true, status: 200 }));

            const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });

            expect(result.delivered).toBe(1);
            expect(window.localStorage.getItem(OUTBOX_DONE_PREFIX + 'legacy-2')).toBeTruthy();
            // A second import of the unchanged v1 array does not resurrect it.
            expect(pendingItems()).toHaveLength(0);
        });

        test('clearDeliveredOrExpired removes stale v2 payloads with their state', () => {
            window.localStorage.setItem(OUTBOX_ITEM_PREFIX + 'stale-1', JSON.stringify({
                clientMessageId: 'stale-1', ownerUid: OWNER, fromUserId: FROM, toId: TO,
                conversationId: CONV, content: 'Old message', createdAt: '2026-02-01T00:00:00.000Z',
            }));
            window.localStorage.setItem(OUTBOX_STATE_PREFIX + 'stale-1', JSON.stringify({ attemptCount: 2, status: 'pending' }));
            window.localStorage.setItem(OUTBOX_STATE_PREFIX + 'orphan-1', JSON.stringify({ attemptCount: 1, status: 'pending' }));

            const removedCount = clearDeliveredOrExpired({ fromUserId: FROM });

            expect(removedCount).toBe(1);
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + 'stale-1')).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_STATE_PREFIX + 'stale-1')).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_STATE_PREFIX + 'orphan-1')).toBeNull();
        });

        test('tombstones older than seven days are collected', () => {
            window.localStorage.setItem(OUTBOX_DONE_PREFIX + 'old-done', '2026-02-01T00:00:00.000Z');
            window.localStorage.setItem(OUTBOX_DONE_PREFIX + 'new-done', '2026-02-12T19:00:00.000Z');

            clearDeliveredOrExpired();

            expect(window.localStorage.getItem(OUTBOX_DONE_PREFIX + 'old-done')).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_DONE_PREFIX + 'new-done')).toBeTruthy();
        });
    });
});
