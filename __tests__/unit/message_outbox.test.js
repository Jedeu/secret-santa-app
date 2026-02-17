/** @jest-environment jsdom */
import {
    MESSAGE_OUTBOX_STORAGE_KEY,
    enqueueMessage,
    getConversationOutboxMessages,
    drainOutboxForUser,
    clearDeliveredOrExpired,
} from '@/lib/message-outbox';

const mockGetIdToken = jest.fn();

jest.mock('@/lib/firebase-client', () => ({
    clientAuth: {
        currentUser: {
            getIdToken: (...args) => mockGetIdToken(...args)
        }
    }
}));

function makeResponse({ ok, status, error = null }) {
    return {
        ok,
        status,
        json: async () => (error ? { error } : {}),
    };
}

describe('message-outbox', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.localStorage.clear();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-02-12T20:00:00.000Z'));
        mockGetIdToken.mockResolvedValue('token-123');
        jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        jest.useRealTimers();
        Math.random.mockRestore();
    });

    test('enqueueMessage stores pending item for a conversation', () => {
        const queued = enqueueMessage({
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Hello there'
        });

        expect(queued.clientMessageId).toBeTruthy();
        expect(queued.status).toBe('pending');

        const outboxMessages = getConversationOutboxMessages({
            fromUserId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b'
        });

        expect(outboxMessages).toHaveLength(1);
        expect(outboxMessages[0]).toMatchObject({
            fromUserId: 'user-a',
            toId: 'user-b',
            content: 'Hello there',
            status: 'pending',
            attemptCount: 0,
        });
    });

    test('drainOutboxForUser delivers queued item and removes it', async () => {
        const queued = enqueueMessage({
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Hello there'
        });

        const fetchImpl = jest.fn().mockResolvedValue(makeResponse({ ok: true, status: 200 }));
        const result = await drainOutboxForUser({ fromUserId: 'user-a', fetchImpl });

        expect(result).toMatchObject({ delivered: 1, retried: 0, failed: 0 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        const [, request] = fetchImpl.mock.calls[0];
        expect(JSON.parse(request.body)).toMatchObject({
            toId: 'user-b',
            content: 'Hello there',
            conversationId: 'santa_user-a_recipient_user-b',
            clientMessageId: queued.clientMessageId,
            clientCreatedAt: queued.createdAt,
        });

        expect(getConversationOutboxMessages({
            fromUserId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b'
        })).toHaveLength(0);
    });

    test('transient failures stay pending with backoff', async () => {
        enqueueMessage({
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Hello there'
        });

        const fetchImpl = jest.fn().mockResolvedValue(makeResponse({
            ok: false,
            status: 503,
            error: 'Temporary outage'
        }));

        const result = await drainOutboxForUser({ fromUserId: 'user-a', fetchImpl });
        expect(result.retried).toBe(1);

        const [pending] = getConversationOutboxMessages({
            fromUserId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b'
        });
        expect(pending.status).toBe('pending');
        expect(pending.attemptCount).toBe(1);
        expect(new Date(pending.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    });

    test('permanent failures are marked failed and kept visible', async () => {
        const queued = enqueueMessage({
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Hello there'
        });

        const fetchImpl = jest.fn().mockResolvedValue(makeResponse({
            ok: false,
            status: 409,
            error: 'Message id conflict'
        }));

        const result = await drainOutboxForUser({ fromUserId: 'user-a', fetchImpl });
        expect(result.failed).toBe(1);

        const [failed] = getConversationOutboxMessages({
            fromUserId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b'
        });
        expect(failed.clientMessageId).toBe(queued.clientMessageId);
        expect(failed.status).toBe('failed');
        expect(failed.nextAttemptAt).toBeNull();
    });

    test('401 can recover by forcing token refresh once', async () => {
        enqueueMessage({
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Hello there'
        });

        mockGetIdToken
            .mockResolvedValueOnce('stale-token')
            .mockResolvedValueOnce('fresh-token');

        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(makeResponse({
                ok: false,
                status: 401,
                error: 'Unauthorized'
            }))
            .mockResolvedValueOnce(makeResponse({ ok: true, status: 200 }));

        const result = await drainOutboxForUser({ fromUserId: 'user-a', fetchImpl });
        expect(result.delivered).toBe(1);
        expect(mockGetIdToken).toHaveBeenCalledWith(false);
        expect(mockGetIdToken).toHaveBeenCalledWith(true);
    });

    test('clearDeliveredOrExpired removes stale items', () => {
        const staleCreatedAt = new Date('2026-02-01T00:00:00.000Z').toISOString();
        const stored = [{
            clientMessageId: 'stale-1',
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Old message',
            createdAt: staleCreatedAt,
            attemptCount: 2,
            nextAttemptAt: staleCreatedAt,
            status: 'pending',
            lastError: null,
        }];
        window.localStorage.setItem(MESSAGE_OUTBOX_STORAGE_KEY, JSON.stringify(stored));

        const removedCount = clearDeliveredOrExpired({ fromUserId: 'user-a' });
        expect(removedCount).toBe(1);
        expect(JSON.parse(window.localStorage.getItem(MESSAGE_OUTBOX_STORAGE_KEY))).toEqual([]);
    });
});
