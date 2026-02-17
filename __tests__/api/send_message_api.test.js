import { POST } from '@/app/api/messages/send/route';
import { auth as adminAuth, firestore } from '@/lib/firebase';

jest.mock('@/lib/firebase', () => ({
    auth: {
        verifyIdToken: jest.fn()
    },
    firestore: {
        collection: jest.fn()
    }
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

describe('POST /api/messages/send', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

    test('returns 403 when authenticated sender is not a known user', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'unknown@example.com' });

        const usersCollection = {
            where: jest.fn(() => ({
                limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ empty: true, docs: [] })
                }))
            }))
        };

        firestore.collection.mockImplementation((name) => {
            if (name === 'users') return usersCollection;
            throw new Error(`Unexpected collection ${name}`);
        });

        const req = createRequest({
            token: 'token',
            body: { toId: 'user-2', content: 'Hello' }
        });
        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toBe('Unauthorized sender');
    });

    test('writes message using authenticated sender identity (ignores forged fromId)', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const recipientGet = jest.fn().mockResolvedValue({ exists: true });
        const addMessage = jest.fn().mockResolvedValue({ id: 'message-doc' });

        const usersCollection = {
            where: jest.fn(() => ({
                limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        empty: false,
                        docs: [{ data: () => ({ id: 'real-user-id', email: 'jed.piezas@gmail.com' }) }]
                    })
                }))
            })),
            doc: jest.fn(() => ({
                get: recipientGet
            }))
        };

        const messagesCollection = {
            add: addMessage
        };

        firestore.collection.mockImplementation((name) => {
            if (name === 'users') return usersCollection;
            if (name === 'messages') return messagesCollection;
            throw new Error(`Unexpected collection ${name}`);
        });

        const req = createRequest({
            token: 'token',
            body: {
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2',
                fromId: 'forged-id'
            }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(addMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                fromId: 'real-user-id',
                toId: 'user-2',
                content: 'Hello from server route',
                conversationId: 'santa_real-user-id_recipient_user-2'
            })
        );
    });
});
