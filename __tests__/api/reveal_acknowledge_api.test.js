import { POST } from '@/app/api/reveal/acknowledge/route';
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
        collection: jest.fn((path) => ({
            doc: (id) => ({ path: path + '/' + id })
        }))
    }
}));

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        verifyRequestToken: jest.fn(),
        runFencedTransaction: jest.fn(),
    };
});

// Synthetic ids only.
const DECODED = { uid: 'auth-alpha', email: 'alpha@example.test', email_verified: true };
const PROFILE_ID = 'alpha-2026';
const RECIPIENT_ID = 'bravo-2026';
const GIFTER_ID = 'charlie-2026';
const STORED_AT = '2026-11-02T08:00:00.000Z';

const AUTO_PENDING = {
    id: PROFILE_ID,
    name: 'Alpha',
    email: 'alpha@example.test',
    oauthId: 'auth-alpha',
    image: null,
    recipientId: RECIPIENT_ID,
    gifterId: GIFTER_ID,
    drawMode: 'auto',
    revealAckRecipientId: null,
    revealAckAt: null,
};
const AUTO_ACKED = { ...AUTO_PENDING, revealAckRecipientId: RECIPIENT_ID, revealAckAt: STORED_AT };

const VALID_BODY = { year: 2026, epoch: 2, userId: PROFILE_ID, recipientId: RECIPIENT_ID };

const RESPONSE_KEYS = ['success', 'changed', 'year', 'epoch', 'userId', 'recipientId', 'acknowledgedAt'];

function createRequest({ token = 'token', body = VALID_BODY, invalidJson = false } = {}) {
    return {
        headers: {
            get: (name) => (name === 'Authorization' && token ? `Bearer ${token}` : null),
        },
        json: async () => {
            if (invalidJson) throw new SyntaxError('Unexpected token');
            return body;
        },
    };
}

/**
 * The fenced transaction calls work(tx, ctx) with the active 2026 season and the
 * caller's profile; ctx can be overridden per test.
 */
function useFence({ user = AUTO_PENDING, ...ctx } = {}) {
    const tx = { update: jest.fn() };
    runFencedTransaction.mockImplementation(async (decoded, work) => work(tx, {
        uid: DECODED.uid,
        email: DECODED.email,
        epoch: 2,
        year: 2026,
        state: 'active',
        user,
        profileId: PROFILE_ID,
        ...ctx,
    }));
    return tx;
}

describe('POST /api/reveal/acknowledge', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyRequestToken.mockResolvedValue(DECODED);
    });

    test('401 without a token; the transaction never runs', async () => {
        verifyRequestToken.mockRejectedValue(new AdmissionError('UNAUTHENTICATED', 'Unauthorized: No token provided'));

        const res = await POST(createRequest({ token: null }));

        expect(res.status).toBe(401);
        expect((await res.json()).code).toBe('UNAUTHENTICATED');
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test('a non-JSON body -> 400 INVALID_REQUEST without a transaction', async () => {
        const res = await POST(createRequest({ invalidJson: true }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid acknowledgment request.', code: 'INVALID_REQUEST' });
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test.each([
        ['an empty body', {}],
        ['a null body', null],
        ['a missing recipientId', { year: 2026, epoch: 2, userId: PROFILE_ID }],
        ['a missing userId', { year: 2026, epoch: 2, recipientId: RECIPIENT_ID }],
        ['a missing epoch', { year: 2026, userId: PROFILE_ID, recipientId: RECIPIENT_ID }],
        ['a string year', { ...VALID_BODY, year: '2026' }],
        ['an invalid year', { ...VALID_BODY, year: 2024 }],
        ['epoch 0', { ...VALID_BODY, epoch: 0 }],
        ['a fractional epoch', { ...VALID_BODY, epoch: 1.5 }],
        ['an empty userId', { ...VALID_BODY, userId: '' }],
        ['a userId containing /', { ...VALID_BODY, userId: 'alpha/2026' }],
        ['a 129-character userId', { ...VALID_BODY, userId: 'u'.repeat(129) }],
        ['a 129-character recipientId', { ...VALID_BODY, recipientId: 'r'.repeat(129) }],
        ['a non-string recipientId', { ...VALID_BODY, recipientId: 42 }],
    ])('%s -> 400 INVALID_REQUEST without a transaction', async (_label, body) => {
        const res = await POST(createRequest({ body }));

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('INVALID_REQUEST');
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test('a 128-character id is accepted by validation', async () => {
        const longId = 'p'.repeat(128);
        useFence({ user: { ...AUTO_PENDING, id: longId }, profileId: longId });

        const res = await POST(createRequest({ body: { ...VALID_BODY, userId: longId } }));

        expect(res.status).toBe(200);
    });

    test('a pending profile: 200 changed true and exactly the two ack fields on the caller profile', async () => {
        const tx = useFence();

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({
            success: true,
            changed: true,
            year: 2026,
            epoch: 2,
            userId: PROFILE_ID,
            recipientId: RECIPIENT_ID,
            acknowledgedAt: expect.any(String),
        });
        expect(Number.isNaN(Date.parse(data.acknowledgedAt))).toBe(false);
        expect(tx.update).toHaveBeenCalledTimes(1);
        const [ref, fields] = tx.update.mock.calls[0];
        expect(ref).toEqual({ path: `years/2026/users/${PROFILE_ID}` });
        expect(fields).toEqual({ revealAckRecipientId: RECIPIENT_ID, revealAckAt: data.acknowledgedAt });
        // Default fencing: a closed year is refused before any write.
        expect(runFencedTransaction).toHaveBeenCalledTimes(1);
        expect(runFencedTransaction).toHaveBeenCalledWith(DECODED, expect.any(Function));
        expect(runFencedTransaction.mock.calls[0][2]?.allowClosed).not.toBe(true);
    });

    test('in 2025 the write targets the root users collection', async () => {
        const tx = useFence({ year: 2025, epoch: 1 });

        const res = await POST(createRequest({ body: { ...VALID_BODY, year: 2025, epoch: 1 } }));

        expect(res.status).toBe(200);
        expect(tx.update.mock.calls[0][0]).toEqual({ path: `users/${PROFILE_ID}` });
    });

    test('an acknowledged profile: 200 changed false with the stored time and no write', async () => {
        const tx = useFence({ user: AUTO_ACKED });

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toEqual({
            success: true,
            changed: false,
            year: 2026,
            epoch: 2,
            userId: PROFILE_ID,
            recipientId: RECIPIENT_ID,
            acknowledgedAt: STORED_AT,
        });
        expect(tx.update).not.toHaveBeenCalled();
    });

    test('an acknowledged profile without a stored time replays with acknowledgedAt null', async () => {
        const tx = useFence({ user: { ...AUTO_ACKED, revealAckAt: undefined } });

        const data = await (await POST(createRequest())).json();

        expect(data).toMatchObject({ changed: false, acknowledgedAt: null });
        expect(tx.update).not.toHaveBeenCalled();
    });

    test.each([
        ['a wrong year', { body: { ...VALID_BODY, year: 2025 } }],
        ['a wrong epoch', { body: { ...VALID_BODY, epoch: 3 } }],
        ['a userId that is not the caller profile', { body: { ...VALID_BODY, userId: 'delta-2026' } }],
        ['a user.id that is not the profile id', { ctx: { user: { ...AUTO_PENDING, id: 'other-2026' } } }],
        ['a wrong recipientId', { body: { ...VALID_BODY, recipientId: 'delta-2026' } }],
    ])('%s -> 409 REVEAL_STALE with no write', async (_label, { body = VALID_BODY, ctx = {} }) => {
        const tx = useFence(ctx);

        const res = await POST(createRequest({ body }));

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: 'Your recipient information changed. Reloading it now.',
            code: 'REVEAL_STALE',
        });
        expect(tx.update).not.toHaveBeenCalled();
    });

    test('a manual profile -> 409 REVEAL_NOT_APPLICABLE with no write', async () => {
        const manual = { ...AUTO_PENDING };
        delete manual.drawMode;
        const tx = useFence({ user: manual });

        const res = await POST(createRequest());

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: 'There is no recipient reveal to acknowledge.',
            code: 'REVEAL_NOT_APPLICABLE',
        });
        expect(tx.update).not.toHaveBeenCalled();
    });

    test.each([
        ['an unknown drawMode', { ...AUTO_PENDING, drawMode: 'other' }],
        ['a null recipient', { ...AUTO_PENDING, recipientId: null }],
        ['a self recipient', { ...AUTO_PENDING, recipientId: PROFILE_ID }],
    ])('an invalid profile (%s) -> 409 REVEAL_UNAVAILABLE with no write', async (_label, user) => {
        const tx = useFence({ user });

        const res = await POST(createRequest());

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: 'Your recipient is not available. Ask an admin for help.',
            code: 'REVEAL_UNAVAILABLE',
        });
        expect(tx.update).not.toHaveBeenCalled();
    });

    test.each([
        ['YEAR_CLOSED', 409],
        ['ACCESS_DENIED', 403],
        ['SERVICE_UNAVAILABLE', 503],
    ])('admission error %s maps to %i', async (code, status) => {
        runFencedTransaction.mockRejectedValue(new AdmissionError(code));

        const res = await POST(createRequest());

        expect(res.status).toBe(status);
        expect((await res.json()).code).toBe(code);
    });

    test('an unexpected error -> 500 INTERNAL; only the error message is logged', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        runFencedTransaction.mockRejectedValue(new Error('boom'));

        const res = await POST(createRequest());

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Could not save. Try again.', code: 'INTERNAL' });
        expect(spy.mock.calls).toEqual([['Reveal acknowledgment failed:', 'boom']]);
        spy.mockRestore();
    });

    test('the 200 body has exactly the documented keys (no profile, no other participant data)', async () => {
        useFence();
        const pending = await (await POST(createRequest())).json();

        useFence({ user: AUTO_ACKED });
        const replay = await (await POST(createRequest())).json();

        [pending, replay].forEach((data) => {
            expect(Object.keys(data).sort()).toEqual([...RESPONSE_KEYS].sort());
            expect(JSON.stringify(data)).not.toContain(GIFTER_ID);
            expect(JSON.stringify(data)).not.toContain('alpha@example.test');
        });
    });
});
