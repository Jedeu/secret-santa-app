import { POST } from '@/app/api/messages/send/route';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { sendIncomingMessagePush } from '@/lib/push-server';

jest.mock('@/lib/firebase', () => ({
    auth: {
        verifyIdToken: jest.fn()
    },
    firestore: {
        collection: jest.fn()
    }
}));

jest.mock('@/lib/push-server', () => ({
    sendIncomingMessagePush: jest.fn()
}));

function createRequest({ token = null, body = {} } = {}) {
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

function createFirestoreMocks({
    sender = { id: 'real-user-id', email: 'jed.piezas@gmail.com' },
    recipientExists = true,
    messageDoc = null
} = {}) {
    const usersCollection = {
        where: jest.fn(() => ({
            limit: jest.fn(() => ({
                get: jest.fn().mockResolvedValue(
                    sender
                        ? { empty: false, docs: [{ data: () => sender }] }
                        : { empty: true, docs: [] }
                )
            }))
        })),
        doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: recipientExists })
        }))
    };

    const messagesCollection = {
        doc: jest.fn(() => messageDoc)
    };

    firestore.collection.mockImplementation((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'messages') return messagesCollection;
        throw new Error(`Unexpected collection ${name}`);
    });

    return { usersCollection, messagesCollection };
}

describe('POST /api/messages/send', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sendIncomingMessagePush.mockResolvedValue({
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            cleanedTokenCount: 0
        });
    });

    test('returns 401 when auth header is missing', async () => {
        const req = createRequest();
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toMatch(/No token provided/);
    });

    test('returns 400 when content is empty', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });
        const req = createRequest({
            token: 'token',
            body: { toId: 'user-2', content: '   ' }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Message cannot be empty');
    });

    test('returns 400 for invalid clientMessageId', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });
        const req = createRequest({
            token: 'token',
            body: { toId: 'user-2', content: 'Hello', clientMessageId: 'not-a-uuid' }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/clientMessageId/);
    });

    test('returns 400 for invalid clientCreatedAt', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });
        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello',
                clientMessageId: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
                clientCreatedAt: 'not-a-date'
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/clientCreatedAt/);
    });

    test('returns 403 when authenticated sender is not a known user', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'unknown@example.com' });
        createFirestoreMocks({ sender: null });

        const req = createRequest({
            token: 'token',
            body: { toId: 'user-2', content: 'Hello' }
        });
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toBe('Unauthorized sender');
    });

    test('writes message using authenticated sender identity and deterministic id', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const messageDoc = {
            create: jest.fn().mockResolvedValue(undefined),
            get: jest.fn()
        };
        const { messagesCollection } = createFirestoreMocks({ messageDoc });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
                clientMessageId: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
                clientCreatedAt: '2026-02-12T20:00:00.000Z',
                fromId: 'forged-id'
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.replayed).toBeUndefined();
        expect(messagesCollection.doc).toHaveBeenCalledWith('4fa2bcc4-35df-4cd2-ac69-7632f6fd2472');
        expect(messageDoc.create).toHaveBeenCalledWith(
            expect.objectContaining({
                id: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
                fromId: 'real-user-id',
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
                clientMessageId: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
                clientCreatedAt: '2026-02-12T20:00:00.000Z'
            })
        );
        expect(sendIncomingMessagePush).toHaveBeenCalledWith({
            toUserId: 'user-2',
            conversationId: 'santa_real-user-id_recipient_user-2'
        });
    });

    test('returns replayed success without duplicate push when idempotent message already exists', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const existingMessage = {
            id: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
            fromId: 'real-user-id',
            toId: 'user-2',
            content: 'Hello from server route',
            conversationId: 'santa_real-user-id_recipient_user-2',
            clientMessageId: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
            clientCreatedAt: '2026-02-12T20:00:00.000Z',
            timestamp: '2026-02-12T20:00:05.000Z'
        };

        const messageDoc = {
            create: jest.fn().mockRejectedValue({ code: 'already-exists' }),
            get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => existingMessage
            })
        };
        createFirestoreMocks({ messageDoc });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
                clientMessageId: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
                clientCreatedAt: '2026-02-12T20:00:00.000Z'
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.replayed).toBe(true);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('returns 409 when existing message with same id conflicts', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const messageDoc = {
            create: jest.fn().mockRejectedValue({ code: 'already-exists' }),
            get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                    id: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
                    fromId: 'real-user-id',
                    toId: 'user-2',
                    content: 'Different content',
                    conversationId: 'santa_real-user-id_recipient_user-2'
                })
            })
        };
        createFirestoreMocks({ messageDoc });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
                clientMessageId: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472'
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.error).toBe('Message id conflict');
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('retries transient write error then succeeds', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const messageDoc = {
            create: jest.fn()
                .mockRejectedValueOnce({ code: 'unavailable' })
                .mockResolvedValueOnce(undefined),
            get: jest.fn()
        };
        createFirestoreMocks({ messageDoc });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2'
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(messageDoc.create).toHaveBeenCalledTimes(2);
        expect(sendIncomingMessagePush).toHaveBeenCalledTimes(1);
    });

    test('returns success when push dispatch fails (fail-open)', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });
        sendIncomingMessagePush.mockRejectedValue(new Error('FCM temporarily unavailable'));

        const messageDoc = {
            create: jest.fn().mockResolvedValue(undefined),
            get: jest.fn()
        };
        createFirestoreMocks({ messageDoc });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(sendIncomingMessagePush).toHaveBeenCalledWith({
            toUserId: 'user-2',
            conversationId: 'santa_real-user-id_recipient_user-2'
        });
    });

    test('returns 500 and does not push if write keeps failing', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const messageDoc = {
            create: jest.fn().mockRejectedValue({ code: 'resource-exhausted' }),
            get: jest.fn()
        };
        createFirestoreMocks({ messageDoc });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to send message');
        expect(messageDoc.create).toHaveBeenCalledTimes(3);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });
});
