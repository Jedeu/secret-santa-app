/** @jest-environment jsdom */
import { clientAuth } from '@/lib/firebase-client';
import {
    enqueueMessage,
    drainOutboxForUser,
    getConversationOutboxMessages,
    cancelOutboxDrains,
} from '@/lib/message-outbox';

const OWNER = 'uid-a';

function okResponse(body = {}) {
    return {
        ok: true,
        status: 200,
        json: async () => body,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

async function flushPromises() {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
}

describe('Outbox retry integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.localStorage.clear();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-02-12T20:00:00.000Z'));
        clientAuth.currentUser = {
            uid: OWNER,
            getIdToken: jest.fn().mockResolvedValue('token-123')
        };
        cancelOutboxDrains();
    });

    afterEach(() => {
        jest.useRealTimers();
        clientAuth.currentUser = null;
    });

    test('failed initial send retries and results in exactly one persisted message', async () => {
        const queued = enqueueMessage({
            ownerUid: OWNER,
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'Hello with retry'
        });

        const persistedByClientMessageId = new Map();
        let callCount = 0;

        const fetchImpl = jest.fn(async (_url, options) => {
            const payload = JSON.parse(options.body);
            callCount += 1;

            if (callCount === 1) {
                throw new Error('Network offline');
            }

            if (!persistedByClientMessageId.has(payload.clientMessageId)) {
                persistedByClientMessageId.set(payload.clientMessageId, payload);
                return okResponse({ success: true });
            }

            return okResponse({ success: true, replayed: true });
        });

        const firstDrain = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: 'user-a', fetchImpl });
        expect(firstDrain).toMatchObject({ delivered: 0, retried: 1, failed: 0 });

        const [pending] = getConversationOutboxMessages({
            fromUserId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b'
        });
        expect(pending.status).toBe('pending');
        expect(pending.clientMessageId).toBe(queued.clientMessageId);

        const nextAttemptMs = new Date(pending.nextAttemptAt).getTime();
        jest.setSystemTime(new Date(nextAttemptMs + 1000));

        const secondDrain = await drainOutboxForUser({ ownerUid: OWNER, fromUserId: 'user-a', fetchImpl });
        expect(secondDrain).toMatchObject({ delivered: 1, retried: 0, failed: 0 });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        const firstPayload = JSON.parse(fetchImpl.mock.calls[0][1].body);
        const secondPayload = JSON.parse(fetchImpl.mock.calls[1][1].body);
        expect(firstPayload.clientMessageId).toBe(secondPayload.clientMessageId);
        expect(firstPayload.senderUserId).toBe('user-a');
        expect(persistedByClientMessageId.size).toBe(1);

        expect(getConversationOutboxMessages({
            fromUserId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b'
        })).toHaveLength(0);
    });

    test('an item enqueued while a retry is in flight is delivered by the follow-up pass', async () => {
        const first = enqueueMessage({
            ownerUid: OWNER,
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'first'
        });

        const gate = deferred();
        const delivered = [];
        const fetchImpl = jest.fn(async (_url, options) => {
            const payload = JSON.parse(options.body);
            if (payload.clientMessageId === first.clientMessageId) {
                await gate.promise;
            }
            delivered.push(payload.clientMessageId);
            return okResponse({ success: true });
        });

        const drain = drainOutboxForUser({ ownerUid: OWNER, fromUserId: 'user-a', fetchImpl });
        await flushPromises();

        const second = enqueueMessage({
            ownerUid: OWNER,
            fromUserId: 'user-a',
            toId: 'user-b',
            conversationId: 'santa_user-a_recipient_user-b',
            content: 'second'
        });
        const followUp = drainOutboxForUser({ ownerUid: OWNER, fromUserId: 'user-a', fetchImpl });

        gate.resolve();
        await drain;
        await followUp;

        expect(delivered).toEqual([first.clientMessageId, second.clientMessageId]);
    });
});
