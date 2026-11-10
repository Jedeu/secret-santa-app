import { POST } from '@/app/api/push/unregister/route';
import { auth as adminAuth } from '@/lib/firebase';
import { unregisterPushToken } from '@/lib/push-server';
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
    unregisterPushToken: jest.fn()
}));

const DECODED = { uid: 'auth-uid-1', email: 'member@example.test', email_verified: true };
const PUSH_TOKEN = 'valid_token_value_1234567890';

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
        [{ token: PUSH_TOKEN, expectedRevision: 'rev-1' }],
    ])('returns 400 PRECONDITION_REQUIRED when a precondition key is missing (%j)', async (body) => {
        const res = await POST(createRequest({ token: 'auth-token', body }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.code).toBe('PRECONDITION_REQUIRED');
        expect(unregisterPushToken).not.toHaveBeenCalled();
    });

    test.each([
        [{ expectedEpoch: -1, expectedRevision: null }],
        [{ expectedEpoch: null, expectedRevision: null }],
        [{ expectedEpoch: 1, expectedRevision: {} }],
    ])('returns 400 for invalid precondition types (%j)', async (extra) => {
        const res = await POST(createRequest({ token: 'auth-token', body: { token: PUSH_TOKEN, ...extra } }));

        expect(res.status).toBe(400);
        expect(unregisterPushToken).not.toHaveBeenCalled();
    });

    test('maps STALE_REGISTRATION to 409', async () => {
        const error = new Error('stale');
        error.code = 'STALE_REGISTRATION';
        unregisterPushToken.mockRejectedValue(error);

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 1, expectedRevision: 'rev-old' }
        }));
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.code).toBe('STALE_REGISTRATION');
    });

    test('maps RESET_IN_PROGRESS to 503', async () => {
        unregisterPushToken.mockRejectedValue(new AdmissionError('RESET_IN_PROGRESS'));

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 1, expectedRevision: 'rev-1' }
        }));

        expect(res.status).toBe(503);
    });

    test('unregisters with the decoded token and preconditions', async () => {
        unregisterPushToken.mockResolvedValue({ epoch: 2, revision: 'rev-2', changed: true });

        const res = await POST(createRequest({
            token: 'auth-token',
            body: { token: PUSH_TOKEN, expectedEpoch: 2, expectedRevision: 'rev-1' }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({ success: true, epoch: 2, revision: 'rev-2', changed: true });
        expect(unregisterPushToken).toHaveBeenCalledWith({
            decodedToken: DECODED,
            token: PUSH_TOKEN,
            expectedEpoch: 2,
            expectedRevision: 'rev-1'
        });
    });
});
