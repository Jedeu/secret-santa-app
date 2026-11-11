import { POST } from '@/app/api/push/register/route';
import { auth as adminAuth } from '@/lib/firebase';
import { registerPushToken } from '@/lib/push-server';
import { AdmissionError } from '@/lib/participant-admission';

jest.mock('@/lib/firebase', () => ({
    auth: {
        verifyIdToken: jest.fn()
    },
    firestore: {
        collection: jest.fn()
    }
}));

jest.mock('@/lib/push-server', () => ({
    registerPushToken: jest.fn()
}));

const DECODED = { uid: 'auth-uid-1', email: 'member@example.test', email_verified: true };
const PUSH_TOKEN = 'valid_token_value_1234567890';

function createRequest({ token = null, body = {}, userAgent = 'Unit Test Agent' } = {}) {
    return {
        headers: {
            get: (name) => {
                if (name === 'Authorization' && token) {
                    return `Bearer ${token}`;
                }

                if (name === 'user-agent') {
                    return userAgent;
                }

                return null;
            }
        },
        json: async () => body
    };
}

function staleError() {
    const error = new Error('Push registration changed; refresh and try again');
    error.code = 'STALE_REGISTRATION';
    return error;
}

describe('POST /api/push/register', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        adminAuth.verifyIdToken.mockResolvedValue(DECODED);
    });

    test('returns 401 when auth header is missing', async () => {
        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toMatch(/No token provided/);
    });

    test('returns 400 for invalid token body', async () => {
        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: 'short', expectedEpoch: 1, expectedRevision: null }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Invalid push token');
    });

    test.each([
        [{ token: PUSH_TOKEN }],
        [{ token: PUSH_TOKEN, expectedEpoch: 1 }],
        [{ token: PUSH_TOKEN, expectedRevision: null }],
    ])('returns 400 PRECONDITION_REQUIRED when a precondition key is missing (%j)', async (body) => {
        const res = await POST(createRequest({ token: 'auth-token', body }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.code).toBe('PRECONDITION_REQUIRED');
        expect(registerPushToken).not.toHaveBeenCalled();
    });

    test.each([
        [{ expectedEpoch: 0, expectedRevision: null }],
        [{ expectedEpoch: 1.5, expectedRevision: null }],
        [{ expectedEpoch: '1', expectedRevision: null }],
        [{ expectedEpoch: 1, expectedRevision: 42 }],
        [{ expectedEpoch: 1, expectedRevision: null, enabled: 'yes' }],
    ])('returns 400 for invalid precondition types (%j)', async (extra) => {
        const res = await POST(createRequest({ token: 'auth-token', body: { token: PUSH_TOKEN, ...extra } }));

        expect(res.status).toBe(400);
        expect(registerPushToken).not.toHaveBeenCalled();
    });

    test('maps STALE_REGISTRATION to 409', async () => {
        registerPushToken.mockRejectedValue(staleError());

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 1, expectedRevision: 'rev-old' }
        }));
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.code).toBe('STALE_REGISTRATION');
    });

    test('maps SERVICE_UNAVAILABLE to 503', async () => {
        registerPushToken.mockRejectedValue(new AdmissionError('SERVICE_UNAVAILABLE'));

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 1, expectedRevision: null }
        }));

        expect(res.status).toBe(503);
    });

    test('registers with the decoded token, preconditions and requested state', async () => {
        registerPushToken.mockResolvedValue({ epoch: 3, revision: 'rev-new', enabled: false });

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 3, expectedRevision: 'rev-old', enabled: false },
            userAgent: 'iPhone Safari'
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({ success: true, epoch: 3, revision: 'rev-new', enabled: false });
        expect(registerPushToken).toHaveBeenCalledWith({
            decodedToken: DECODED,
            token: PUSH_TOKEN,
            expectedEpoch: 3,
            expectedRevision: 'rev-old',
            enabled: false,
            userAgent: 'iPhone Safari'
        });
    });

    test('defaults enabled to true and accepts a null revision', async () => {
        registerPushToken.mockResolvedValue({ epoch: 1, revision: 'rev-1', enabled: true });

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 1, expectedRevision: null }
        }));

        expect(res.status).toBe(200);
        expect(registerPushToken).toHaveBeenCalledWith(expect.objectContaining({
            expectedRevision: null,
            enabled: true
        }));
    });
});
