import { POST } from '@/app/api/push/status/route';
import { auth as adminAuth } from '@/lib/firebase';
import { getPushRegistrationStatus } from '@/lib/push-server';
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
    getPushRegistrationStatus: jest.fn()
}));

const DECODED = { uid: 'auth-uid-1', email: 'member@example.test', email_verified: true };
const PUSH_TOKEN = 'valid_token_value_1234567890';

function createRequest({ token = 'auth-token', body = {} } = {}) {
    return {
        headers: {
            get: (name) => (name === 'Authorization' && token ? `Bearer ${token}` : null)
        },
        json: async () => body
    };
}

describe('POST /api/push/status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        adminAuth.verifyIdToken.mockResolvedValue(DECODED);
    });

    test('returns 401 without a bearer token', async () => {
        const res = await POST(createRequest({ token: null, body: { token: PUSH_TOKEN } }));

        expect(res.status).toBe(401);
        expect(getPushRegistrationStatus).not.toHaveBeenCalled();
    });

    test('returns 400 for an invalid push token', async () => {
        const res = await POST(createRequest({ body: { token: 'short' } }));

        expect(res.status).toBe(400);
    });

    test('returns 200 with epoch, revision, ownership and enabled state', async () => {
        getPushRegistrationStatus.mockResolvedValue({ epoch: 4, revision: 'rev-9', mine: true, enabled: false });

        const res = await POST(createRequest({ body: { token: PUSH_TOKEN } }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({ success: true, epoch: 4, revision: 'rev-9', mine: true, enabled: false });
        expect(getPushRegistrationStatus).toHaveBeenCalledWith({ decodedToken: DECODED, token: PUSH_TOKEN });
    });

    test('returns a null revision for a missing or legacy row', async () => {
        getPushRegistrationStatus.mockResolvedValue({ epoch: 1, revision: null, mine: false, enabled: false });

        const res = await POST(createRequest({ body: { token: PUSH_TOKEN } }));
        const data = await res.json();

        expect(data.revision).toBeNull();
        expect(data.mine).toBe(false);
    });

    test.each([
        ['ACCESS_DENIED', 403],
        ['EMAIL_NOT_VERIFIED', 403],
        ['PROFILE_CONFLICT', 409],
        ['SERVICE_UNAVAILABLE', 503],
    ])('maps %s to %i', async (code, status) => {
        getPushRegistrationStatus.mockRejectedValue(new AdmissionError(code));

        const res = await POST(createRequest({ body: { token: PUSH_TOKEN } }));
        const data = await res.json();

        expect(res.status).toBe(status);
        expect(data.code).toBe(code);
    });
});
