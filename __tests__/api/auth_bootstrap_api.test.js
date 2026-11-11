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

function createRequest({ clientHeader = '2' } = {}) {
    const headers = { authorization: 'Bearer token' };
    if (clientHeader !== null) {
        headers['x-secret-santa-client'] = clientHeader;
    }
    return {
        headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
        json: async () => ({})
    };
}

describe('POST /api/auth/bootstrap', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyRequestToken.mockResolvedValue(DECODED);
    });

    test('returns 200 with the resolved user and the season, verifying the index', async () => {
        const user = { id: 'user-uuid-1', name: 'Member', email: 'member@example.test', recipientId: null, gifterId: null };
        resolveParticipant.mockResolvedValue({
            uid: DECODED.uid,
            email: DECODED.email,
            user,
            epoch: 2,
            year: 2026,
            state: 'active',
            closedYears: [2025],
        });

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({ success: true, user, year: 2026, yearState: 'active', epoch: 2, closedYears: [2025] });
        expect(resolveParticipant).toHaveBeenCalledWith(DECODED, { verifyIndex: true, requireLegacyYear: false });
    });

    test('a closed season is reported as yearState closed', async () => {
        resolveParticipant.mockResolvedValue({
            uid: DECODED.uid,
            email: DECODED.email,
            user: { id: 'u1' },
            epoch: 1,
            year: 2025,
            state: 'closed',
            closedYears: [2025],
        });

        const data = await (await POST(createRequest())).json();

        expect(data).toMatchObject({ year: 2025, yearState: 'closed', epoch: 1, closedYears: [2025] });
    });

    test.each([
        ['without the client header', null],
        ['with another client version', '1'],
    ])('%s the legacy year is required', async (_label, clientHeader) => {
        resolveParticipant.mockResolvedValue({
            uid: DECODED.uid, email: DECODED.email, user: { id: 'u1' }, epoch: 1, year: 2025, state: 'active', closedYears: [],
        });

        const res = await POST(createRequest({ clientHeader }));

        expect(res.status).toBe(200);
        expect(resolveParticipant).toHaveBeenCalledWith(DECODED, { verifyIndex: true, requireLegacyYear: true });
    });

    test.each([
        ['UNAUTHENTICATED', 401],
        ['ACCESS_DENIED', 403],
        ['EMAIL_NOT_VERIFIED', 403],
        ['PROFILE_CONFLICT', 409],
        ['YEAR_CLOSED', 409],
        ['CLIENT_UPDATE_REQUIRED', 409],
        ['SERVICE_UNAVAILABLE', 503],
    ])('maps %s to %i', async (code, status) => {
        resolveParticipant.mockRejectedValue(new AdmissionError(code));

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(status);
        expect(data.code).toBe(code);
    });

    test('an old client after Start gets the reload message', async () => {
        resolveParticipant.mockRejectedValue(new AdmissionError('CLIENT_UPDATE_REQUIRED'));

        const data = await (await POST(createRequest({ clientHeader: null }))).json();

        expect(data.error).toBe('A new version of the app is available. Reload the page (or close and reopen the app) to continue.');
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
