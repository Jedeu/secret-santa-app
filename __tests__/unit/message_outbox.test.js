/** @jest-environment jsdom */
import {
    MESSAGE_OUTBOX_STORAGE_KEY,
    OUTBOX_ITEM_PREFIX,
    OUTBOX_MEDIA_ITEM_PREFIX,
    OUTBOX_STATE_PREFIX,
    OUTBOX_DONE_PREFIX,
    enqueueMessage,
    getConversationOutboxMessages,
    drainOutboxForUser,
    clearDeliveredOrExpired,
    cancelOutboxDrains,
    createClientMessageId,
    subscribeOutbox,
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

    describe('media items', () => {
        const MEDIA_ID = '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472';
        const ATTACHMENT = {
            id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
            kind: 'image',
            provider: 'cloudinary',
            cloudName: 'unit-cloud',
            publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
            version: 1700000000,
            format: 'gif',
            width: 64,
            height: 64,
            bytes: 2048,
        };

        function enqueueMedia(overrides = {}) {
            return enqueueMessage({
                ownerUid: OWNER,
                fromUserId: FROM,
                toId: TO,
                conversationId: CONV,
                content: 'A caption',
                attachment: ATTACHMENT,
                clientMessageId: MEDIA_ID,
                ...overrides,
            });
        }

        function outboxKeys() {
            const keys = [];
            for (let i = 0; i < window.localStorage.length; i += 1) {
                keys.push(window.localStorage.key(i));
            }
            return keys.sort();
        }

        test('createClientMessageId returns a UUID v4', () => {
            expect(createClientMessageId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });

        test('writes only the media-item key, with the 10-key attachment and nothing else', () => {
            const queued = enqueueMedia({
                attachment: { ...ATTACHMENT, previewUrl: 'blob:http://localhost/x', blob: { size: 1 }, sha256: 'f'.repeat(64) },
            });

            expect(outboxKeys()).toEqual([OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID]);
            expect(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + MEDIA_ID)).toBeNull();
            const raw = window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID);
            expect(JSON.parse(raw)).toEqual({
                clientMessageId: MEDIA_ID,
                ownerUid: OWNER,
                fromUserId: FROM,
                toId: TO,
                conversationId: CONV,
                content: 'A caption',
                createdAt: '2026-02-12T20:00:00.000Z',
                attachment: ATTACHMENT,
            });
            expect(raw.length).toBeLessThan(1024);
            expect(raw).not.toContain('data:');
            expect(raw).not.toContain('blob:');
            expect(raw).not.toContain('sha256');
            expect(queued).toMatchObject({ clientMessageId: MEDIA_ID, status: 'pending', attachment: ATTACHMENT });
            expect(pendingItems()).toEqual([expect.objectContaining({ clientMessageId: MEDIA_ID, attachment: ATTACHMENT })]);
        });

        test('requires a UUID id and a valid attachment', () => {
            expect(() => enqueueMedia({ clientMessageId: null })).toThrow('Invalid outbox enqueue payload');
            expect(() => enqueueMedia({ clientMessageId: 'legacy-id' })).toThrow('Invalid outbox enqueue payload');
            expect(() => enqueueMedia({ attachment: { ...ATTACHMENT, cloudName: 'bad/name' } })).toThrow('Invalid outbox enqueue payload');
            expect(() => enqueueMedia({ attachment: { id: ATTACHMENT.id } })).toThrow('Invalid outbox enqueue payload');
            expect(() => enqueueMedia({ ownerUid: null })).toThrow('Invalid outbox enqueue payload');
            expect(outboxKeys()).toEqual([]);
        });

        test('an empty caption is allowed with an attachment; text-only empty content still throws', () => {
            enqueueMedia({ content: '   ' });
            expect(JSON.parse(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID)).content).toBe('');

            expect(() => enqueue('   ')).toThrow('Invalid outbox enqueue payload');
            expect(() => enqueue('', { clientMessageId: MEDIA_ID })).toThrow('Invalid outbox enqueue payload');
        });

        test('a text enqueue ignores clientMessageId and keeps today\'s stored JSON', () => {
            const queued = enqueue('Plain', { clientMessageId: MEDIA_ID });

            expect(queued.clientMessageId).not.toBe(MEDIA_ID);
            expect(Object.keys(JSON.parse(window.localStorage.getItem(OUTBOX_ITEM_PREFIX + queued.clientMessageId))).sort())
                .toEqual(['clientMessageId', 'content', 'conversationId', 'createdAt', 'fromUserId', 'ownerUid', 'toId']);
        });

        test('a repeat enqueue writes nothing and returns the live item', () => {
            enqueueMedia();
            const before = window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID);
            jest.setSystemTime(new Date('2026-02-12T20:00:05.000Z'));
            const setItem = jest.spyOn(Storage.prototype, 'setItem');

            const again = enqueueMedia({ content: 'Different caption' });

            expect(setItem).not.toHaveBeenCalled();
            expect(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID)).toBe(before);
            expect(again).toMatchObject({ clientMessageId: MEDIA_ID, content: 'A caption' });
            setItem.mockRestore();
        });

        test('a tombstoned id writes nothing', () => {
            window.localStorage.setItem(OUTBOX_DONE_PREFIX + MEDIA_ID, '2026-02-12T19:59:00.000Z');

            const result = enqueueMedia();

            expect(result).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID)).toBeNull();
        });

        test('a setItem that throws propagates and leaves no key', () => {
            const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
                throw new Error('QuotaExceededError');
            });

            expect(() => enqueueMedia()).toThrow('QuotaExceededError');
            setItem.mockRestore();
            expect(outboxKeys()).toEqual([]);
        });

        test('drain sends attachment: { id } and delivery removes the media key and writes the tombstone', async () => {
            enqueueMedia();
            const fetchImpl = jest.fn().mockResolvedValue(makeResponse({ ok: true, status: 200 }));

            const result = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });

            expect(result.delivered).toBe(1);
            expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
                toId: TO,
                content: 'A caption',
                conversationId: CONV,
                clientMessageId: MEDIA_ID,
                clientCreatedAt: '2026-02-12T20:00:00.000Z',
                senderUserId: FROM,
                attachment: { id: ATTACHMENT.id },
            });
            expect(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID)).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_DONE_PREFIX + MEDIA_ID)).toBeTruthy();
            expect(pendingItems()).toHaveLength(0);
        });

        test('a permanent failure keeps the media item visible as failed', async () => {
            enqueueMedia();
            const fetchImpl = jest.fn().mockResolvedValue(makeResponse({ ok: false, status: 400, error: 'Attachment is not available for this message' }));

            await drainOutboxForUser({ ownerUid: OWNER, fromUserId: FROM, fetchImpl });

            const [failed] = pendingItems();
            expect(failed).toMatchObject({ clientMessageId: MEDIA_ID, status: 'failed', attachment: ATTACHMENT });
        });

        test('GC removes expired and malformed media items and keeps the state of a live one', () => {
            const expiredId = '11111111-1111-4111-8111-111111111111';
            const malformedId = '22222222-2222-4222-8222-222222222222';
            const base = {
                ownerUid: OWNER, fromUserId: FROM, toId: TO, conversationId: CONV, content: '', attachment: ATTACHMENT,
            };
            window.localStorage.setItem(OUTBOX_MEDIA_ITEM_PREFIX + expiredId, JSON.stringify({
                ...base, clientMessageId: expiredId, createdAt: '2026-02-01T00:00:00.000Z',
            }));
            window.localStorage.setItem(OUTBOX_STATE_PREFIX + expiredId, JSON.stringify({ attemptCount: 1, status: 'pending' }));
            window.localStorage.setItem(OUTBOX_MEDIA_ITEM_PREFIX + malformedId, JSON.stringify({
                ...base, clientMessageId: malformedId, createdAt: '2026-02-12T19:00:00.000Z', attachment: { id: 'x' },
            }));
            enqueueMedia();
            window.localStorage.setItem(OUTBOX_STATE_PREFIX + MEDIA_ID, JSON.stringify({ attemptCount: 2, status: 'pending', nextAttemptAt: null }));

            const removed = clearDeliveredOrExpired();

            expect(removed).toBe(2);
            expect(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + expiredId)).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_STATE_PREFIX + expiredId)).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + malformedId)).toBeNull();
            expect(window.localStorage.getItem(OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID)).toBeTruthy();
            expect(JSON.parse(window.localStorage.getItem(OUTBOX_STATE_PREFIX + MEDIA_ID))).toMatchObject({ attemptCount: 2 });
        });

        test('a storage event on a media key notifies subscribers', () => {
            const callback = jest.fn();
            const unsubscribe = subscribeOutbox(callback);

            window.dispatchEvent(new StorageEvent('storage', { key: OUTBOX_MEDIA_ITEM_PREFIX + MEDIA_ID }));
            expect(callback).toHaveBeenCalledTimes(1);

            window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }));
            expect(callback).toHaveBeenCalledTimes(1);
            unsubscribe();
        });

        test('no key under the text item prefix exists for a media item', () => {
            enqueueMedia();
            const textKeys = outboxKeys().filter((key) => key.startsWith(OUTBOX_ITEM_PREFIX));
            expect(textKeys).toEqual([]);
            expect(OUTBOX_MEDIA_ITEM_PREFIX.startsWith(OUTBOX_ITEM_PREFIX)).toBe(false);
        });
    });
});
