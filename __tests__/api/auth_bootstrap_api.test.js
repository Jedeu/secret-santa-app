import { POST } from '@/app/api/auth/bootstrap/route';
import {
    verifyRequestToken,
    resolveParticipant,
    AdmissionError,
} from '@/lib/participant-admission';

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        verifyRequestToken: jest.fn(),
        resolveParticipant: jest.fn(),
    };
});

const DECODED = { uid: 'auth-uid-1', email: 'member@example.test', email_verified: true };

function createRequest() {
    return {
        headers: { get: (name) => (name === 'Authorization' ? 'Bearer token' : null) },
        json: async () => ({})
    };
}

describe('POST /api/auth/bootstrap', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyRequestToken.mockResolvedValue(DECODED);
    });

    test('returns 200 with the resolved user and verifies the index', async () => {
        const user = { id: 'user-uuid-1', name: 'Member', email: 'member@example.test', recipientId: null, gifterId: null };
        resolveParticipant.mockResolvedValue({ uid: DECODED.uid, email: DECODED.email, user, epoch: 1 });

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({ success: true, user });
        expect(resolveParticipant).toHaveBeenCalledWith(DECODED, { verifyIndex: true });
    });

    test.each([
        ['UNAUTHENTICATED', 401],
        ['ACCESS_DENIED', 403],
        ['EMAIL_NOT_VERIFIED', 403],
        ['PROFILE_CONFLICT', 409],
        ['RESET_IN_PROGRESS', 503],
        ['SERVICE_UNAVAILABLE', 503],
    ])('maps %s to %i', async (code, status) => {
        resolveParticipant.mockRejectedValue(new AdmissionError(code));

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(status);
        expect(data.code).toBe(code);
    });

    test('maps a token error from verifyRequestToken to 401', async () => {
        verifyRequestToken.mockRejectedValue(new AdmissionError('UNAUTHENTICATED', 'Unauthorized: No token provided'));

        const res = await POST(createRequest());

        expect(res.status).toBe(401);
        expect(resolveParticipant).not.toHaveBeenCalled();
    });

    test('PROFILE_CONFLICT message is generic', async () => {
        resolveParticipant.mockRejectedValue(new AdmissionError('PROFILE_CONFLICT'));

        const res = await POST(createRequest());
        const data = await res.json();

        expect(data.error).not.toMatch(/@/);
        expect(data.error).not.toMatch(/\d/);
    });

    test('unexpected errors return 500 INTERNAL', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        resolveParticipant.mockRejectedValue(new Error('boom'));

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.code).toBe('INTERNAL');
        console.error.mockRestore();
    });
});
