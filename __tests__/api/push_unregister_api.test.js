import { POST } from '@/app/api/push/unregister/route';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { unregisterPushToken } from '@/lib/push-server';

jest.mock('@/lib/firebase', () => ({
    auth: {
        verifyIdToken: jest.fn()
    },
    firestore: {
        collection: jest.fn()
    }
}));

jest.mock('@/lib/push-server', () => ({
    unregisterPushToken: jest.fn()
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

describe('POST /api/push/unregister', () => {
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

    test('returns 400 for invalid token body', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const req = createRequest({
            token: 'auth-token',
            body: { token: 'short' }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Invalid push token');
    });

    test('returns 403 when sender does not map to an app user', async () => {
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
            token: 'auth-token',
            body: { token: 'valid_token_value_1234567890' }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toBe('Unauthorized sender');
    });

    test('unregisters push token for authenticated sender', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ email: 'jed.piezas@gmail.com' });

        const usersCollection = {
            where: jest.fn(() => ({
                limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        empty: false,
                        docs: [{ data: () => ({ id: 'user-1', email: 'jed.piezas@gmail.com' }) }]
                    })
                }))
            }))
        };

        firestore.collection.mockImplementation((name) => {
            if (name === 'users') return usersCollection;
            throw new Error(`Unexpected collection ${name}`);
        });

        const req = createRequest({
            token: 'auth-token',
            body: { token: 'valid_token_value_1234567890' }
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(unregisterPushToken).toHaveBeenCalledWith({
            userId: 'user-1',
            token: 'valid_token_value_1234567890'
        });
    });
});
