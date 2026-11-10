import { POST } from '@/app/api/messages/send/route';
import { sendIncomingMessagePush } from '@/lib/push-server';
import {
    verifyRequestToken,
    runFencedTransaction,
    AdmissionError,
} from '@/lib/participant-admission';

jest.mock('@/lib/firebase', () => ({
    auth: {
        verifyIdToken: jest.fn()
    },
    firestore: {
        collection: jest.fn((name) => ({
            doc: (id) => ({ __collection: name, id })
        }))
    }
}));

jest.mock('@/lib/push-server', () => ({
    sendIncomingMessagePush: jest.fn()
}));

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        verifyRequestToken: jest.fn(),
        runFencedTransaction: jest.fn(),
    };
});

const SANTA_ID = 'user-santa';
const RECIPIENT_ID = 'user-recipient';
const OTHER_ID = 'user-other';
const CONV_SANTA_TO_RECIPIENT = `santa_${SANTA_ID}_recipient_${RECIPIENT_ID}`;
const CONV_RECIPIENT_TO_SANTA = `santa_${RECIPIENT_ID}_recipient_${SANTA_ID}`;
const CLIENT_MESSAGE_ID = '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472';
const CLIENT_CREATED_AT = '2026-02-12T20:00:00.000Z';

function createRequest({ token = 'token', body = {} } = {}) {
    return {
        headers: {
            get: (name) => {
                if (name === 'Authorization' && token) {
                    return `Bearer ${token}`;
                }
                return null;
            }
        },
        json: async () => body
    };
}

/**
 * In-memory store + fake fenced transaction. `work` receives a tx with getAll/create.
 */
function useStore({ users, messages = {}, sender }) {
    const store = { users: { ...users }, messages: { ...messages } };
    runFencedTransaction.mockImplementation(async (decoded, work) => {
        const creates = [];
        const tx = {
            getAll: jest.fn(async (...refs) => refs.map((ref) => {
                const data = store[ref.__collection]?.[ref.id];
                return { id: ref.id, exists: !!data, data: () => data };
            })),
            create: jest.fn((ref, data) => creates.push({ ref, data })),
        };
        const result = await work(tx, {
            uid: 'auth-uid',
            email: 'sender@example.test',
            epoch: 1,
            user: store.users[sender],
        });
        creates.forEach(({ ref, data }) => {
            store[ref.__collection][ref.id] = data;
        });
        return result;
    });
    return store;
}

const oneWayUsers = {
    [SANTA_ID]: { id: SANTA_ID, recipientId: RECIPIENT_ID, gifterId: OTHER_ID },
    [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: OTHER_ID, gifterId: SANTA_ID },
    [OTHER_ID]: { id: OTHER_ID, recipientId: SANTA_ID, gifterId: RECIPIENT_ID },
};

const mutualUsers = {
    [SANTA_ID]: { id: SANTA_ID, recipientId: RECIPIENT_ID, gifterId: RECIPIENT_ID },
    [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: SANTA_ID, gifterId: SANTA_ID },
};

describe('POST /api/messages/send', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyRequestToken.mockResolvedValue({ uid: 'auth-uid', email: 'sender@example.test' });
        sendIncomingMessagePush.mockResolvedValue({
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            cleanedTokenCount: 0
        });
    });

    test('returns 401 when auth header is missing', async () => {
        verifyRequestToken.mockRejectedValue(new AdmissionError('UNAUTHENTICATED', 'Unauthorized: No token provided'));

        const res = await POST(createRequest({ token: null }));
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toMatch(/No token provided/);
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test('returns 400 when content is empty', async () => {
        const res = await POST(createRequest({ body: { toId: RECIPIENT_ID, content: '   ' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Message cannot be empty');
    });

    test('returns 400 for invalid clientMessageId', async () => {
        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hello', clientMessageId: 'not-a-uuid' }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/clientMessageId/);
    });

    test('returns 400 for invalid clientCreatedAt', async () => {
        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello',
                clientMessageId: CLIENT_MESSAGE_ID,
                clientCreatedAt: 'not-a-date'
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/clientCreatedAt/);
    });

    test('writes the message in the fenced transaction with the server-resolved sender', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello from server route',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID,
                clientCreatedAt: CLIENT_CREATED_AT,
                senderUserId: SANTA_ID,
                fromId: 'forged-id'
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.replayed).toBeUndefined();
        expect(store.messages[CLIENT_MESSAGE_ID]).toEqual(expect.objectContaining({
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Hello from server route',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT
        }));
        expect(sendIncomingMessagePush).toHaveBeenCalledWith({
            toUserId: RECIPIENT_ID,
            conversationId: CONV_SANTA_TO_RECIPIENT,
            fromUserId: SANTA_ID
        });
    });

    test('resolves the single authorized conversation when none is requested', async () => {
        const store = useStore({ users: oneWayUsers, sender: RECIPIENT_ID });

        const res = await POST(createRequest({
            body: { toId: SANTA_ID, content: 'Thanks Santa', clientMessageId: CLIENT_MESSAGE_ID }
        }));

        expect(res.status).toBe(200);
        expect(store.messages[CLIENT_MESSAGE_ID].conversationId).toBe(CONV_SANTA_TO_RECIPIENT);
    });

    test('wrong pair returns 400 NOT_ASSIGNED and writes nothing', async () => {
        const store = useStore({
            users: { ...oneWayUsers, 'user-stranger': { id: 'user-stranger', recipientId: null, gifterId: null } },
            sender: SANTA_ID
        });

        const res = await POST(createRequest({ body: { toId: 'user-stranger', content: 'Hi' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data).toEqual({ error: 'Invalid conversation for this recipient', code: 'NOT_ASSIGNED' });
        expect(Object.keys(store.messages)).toHaveLength(0);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('false role returns 400 INVALID_CONVERSATION', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_RECIPIENT_TO_SANTA }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.code).toBe('INVALID_CONVERSATION');
        expect(Object.keys(store.messages)).toHaveLength(0);
    });

    test('senderUserId mismatch returns 403 SENDER_MISMATCH', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hi',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                senderUserId: 'user-previous-account'
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.code).toBe('SENDER_MISMATCH');
        expect(Object.keys(store.messages)).toHaveLength(0);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('missing conversation on a mutual pair returns 400 AMBIGUOUS_CONVERSATION', async () => {
        useStore({ users: mutualUsers, sender: SANTA_ID });

        const res = await POST(createRequest({ body: { toId: RECIPIENT_ID, content: 'Hi' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.code).toBe('AMBIGUOUS_CONVERSATION');
    });

    test('recipient missing returns 400', async () => {
        useStore({ users: { [SANTA_ID]: oneWayUsers[SANTA_ID] }, sender: SANTA_ID });

        const res = await POST(createRequest({ body: { toId: RECIPIENT_ID, content: 'Hi' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Recipient not found');
    });

    test('replay with omitted conversationId returns replayed without push', async () => {
        const existing = {
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Hello again',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT,
            timestamp: '2026-02-12T20:00:05.000Z'
        };
        useStore({ users: oneWayUsers, sender: SANTA_ID, messages: { [CLIENT_MESSAGE_ID]: existing } });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello again',
                clientMessageId: CLIENT_MESSAGE_ID,
                clientCreatedAt: CLIENT_CREATED_AT
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.replayed).toBe(true);
        expect(data.message).toEqual(existing);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('replay after assignments changed still returns replayed without push', async () => {
        const existing = {
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Sent before the change',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            timestamp: '2026-02-12T20:00:05.000Z'
        };
        useStore({
            users: {
                [SANTA_ID]: { id: SANTA_ID, recipientId: null, gifterId: null },
                [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: null, gifterId: null },
            },
            sender: SANTA_ID,
            messages: { [CLIENT_MESSAGE_ID]: existing }
        });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Sent before the change',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.replayed).toBe(true);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('second identical POST replays and pushes only once', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });
        const body = {
            toId: RECIPIENT_ID,
            content: 'Hello from server route',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT
        };

        const first = await POST(createRequest({ body }));
        expect((await first.json()).replayed).toBeUndefined();

        const replay = await POST(createRequest({ body }));
        expect((await replay.json()).replayed).toBe(true);

        expect(sendIncomingMessagePush).toHaveBeenCalledTimes(1);
    });

    test('differing content for an existing id returns 409', async () => {
        useStore({
            users: oneWayUsers,
            sender: SANTA_ID,
            messages: {
                [CLIENT_MESSAGE_ID]: {
                    id: CLIENT_MESSAGE_ID,
                    fromId: SANTA_ID,
                    toId: RECIPIENT_ID,
                    content: 'Different content',
                    conversationId: CONV_SANTA_TO_RECIPIENT,
                    clientMessageId: CLIENT_MESSAGE_ID
                }
            }
        });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello from server route',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.error).toBe('Message id conflict');
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('RESET_IN_PROGRESS returns 503 without push', async () => {
        runFencedTransaction.mockRejectedValue(new AdmissionError('RESET_IN_PROGRESS'));

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(503);
        expect(data.code).toBe('RESET_IN_PROGRESS');
        expect(runFencedTransaction).toHaveBeenCalledTimes(1);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('retries a transient transaction error then succeeds', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });
        const succeed = runFencedTransaction.getMockImplementation();
        runFencedTransaction
            .mockImplementationOnce(async () => {
                throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
            })
            .mockImplementation(succeed);

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));

        expect(res.status).toBe(200);
        expect(runFencedTransaction).toHaveBeenCalledTimes(2);
        expect(sendIncomingMessagePush).toHaveBeenCalledTimes(1);
    });

    test('returns 500 and does not push if the transaction keeps failing', async () => {
        runFencedTransaction.mockRejectedValue({ code: 'resource-exhausted' });

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to send message');
        expect(runFencedTransaction).toHaveBeenCalledTimes(3);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('returns success when push dispatch fails (fail-open)', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });
        sendIncomingMessagePush.mockRejectedValue(new Error('FCM temporarily unavailable'));

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
    });
});
