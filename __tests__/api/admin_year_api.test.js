import { POST as closePOST } from '@/app/api/admin/year/close/route';
import { POST as startPOST } from '@/app/api/admin/year/start/route';
import { auth as adminAuth } from '@/lib/firebase';
import { ADMIN_EMAILS } from '@/lib/config';
import { AdmissionError, closeYear, startNewYear } from '@/lib/participant-admission';

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        closeYear: jest.fn(),
        startNewYear: jest.fn(),
    };
});

const ADMIN = { uid: 'admin-uid', email: ADMIN_EMAILS[0], email_verified: true };

function createRequest({ token = 'admin-token', body = {}, invalidJson = false } = {}) {
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

const ROUTES = [
    [
        'close',
        closePOST,
        { year: 2025 },
        () => closeYear,
        { year: 2025, state: 'closed', epoch: 1, closedYears: [2025], changed: true },
    ],
    [
        'start',
        startPOST,
        { fromYear: 2025, targetYear: 2026 },
        () => startNewYear,
        { year: 2026, state: 'active', epoch: 2, closedYears: [2025], changed: true, participants: 7 },
    ],
];

const LEGACY_FLAG_VALUES = [['unset', undefined], ['"false"', 'false'], ['"true"', 'true']];

function setEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

describe('admin year routes', () => {
    let savedNodeEnv;
    let savedFlag;

    beforeEach(() => {
        jest.clearAllMocks();
        savedNodeEnv = process.env.NODE_ENV;
        savedFlag = process.env.YEAR_TRANSITIONS_ENABLED;
        setEnv('YEAR_TRANSITIONS_ENABLED', undefined);
        adminAuth.verifyIdToken.mockResolvedValue(ADMIN);
    });

    afterEach(() => {
        setEnv('NODE_ENV', savedNodeEnv);
        setEnv('YEAR_TRANSITIONS_ENABLED', savedFlag);
    });

    describe.each(ROUTES)('%s', (_name, POST, validBody, lib, okResult) => {
        test('401 without a token', async () => {
            const res = await POST(createRequest({ token: null, body: validBody }));

            expect(res.status).toBe(401);
            expect((await res.json()).code).toBe('UNAUTHENTICATED');
            expect(lib()).not.toHaveBeenCalled();
        });

        test('401 for an invalid token', async () => {
            adminAuth.verifyIdToken.mockRejectedValue(Object.assign(new Error('bad'), { code: 'auth/argument-error' }));

            const res = await POST(createRequest({ body: validBody }));

            expect(res.status).toBe(401);
            expect(lib()).not.toHaveBeenCalled();
        });

        test('403 ADMIN_REQUIRED for a non-admin', async () => {
            adminAuth.verifyIdToken.mockResolvedValue({ uid: 'member-uid', email: 'member@example.test', email_verified: true });

            const res = await POST(createRequest({ body: validBody }));

            expect(res.status).toBe(403);
            expect((await res.json()).code).toBe('ADMIN_REQUIRED');
            expect(lib()).not.toHaveBeenCalled();
        });

        test('403 EMAIL_NOT_VERIFIED outside development', async () => {
            adminAuth.verifyIdToken.mockResolvedValue({ ...ADMIN, email_verified: false });

            const res = await POST(createRequest({ body: validBody }));

            expect(res.status).toBe(403);
            expect((await res.json()).code).toBe('EMAIL_NOT_VERIFIED');
            expect(lib()).not.toHaveBeenCalled();
        });

        test('400 INVALID_YEAR for a body that is not JSON', async () => {
            const res = await POST(createRequest({ invalidJson: true }));

            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('INVALID_YEAR');
            expect(lib()).not.toHaveBeenCalled();
        });

        test('500 INTERNAL for an unexpected error, logging the message only', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
            lib().mockRejectedValue(new Error('boom'));

            const res = await POST(createRequest({ body: validBody }));
            const data = await res.json();

            expect(res.status).toBe(500);
            expect(data).toEqual({ error: 'The action did not complete. Check the current state and try again.', code: 'INTERNAL' });
            expect(spy).toHaveBeenCalledWith(expect.any(String), 'boom');
            spy.mockRestore();
        });

        describe.each(LEGACY_FLAG_VALUES)('in production with YEAR_TRANSITIONS_ENABLED %s', (_label, value) => {
            beforeEach(() => {
                process.env.NODE_ENV = 'production';
                setEnv('YEAR_TRANSITIONS_ENABLED', value);
            });

            test('verified admin → 200', async () => {
                lib().mockResolvedValue(okResult);

                const res = await POST(createRequest({ body: validBody }));

                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ success: true, ...okResult });
                expect(lib()).toHaveBeenCalledTimes(1);
                expect(lib()).toHaveBeenCalledWith(validBody);
            });

            test('401 missing token', async () => {
                const res = await POST(createRequest({ token: null, body: validBody }));

                expect(res.status).toBe(401);
                expect((await res.json()).code).toBe('UNAUTHENTICATED');
                expect(lib()).not.toHaveBeenCalled();
            });

            test('403 verified non-admin', async () => {
                adminAuth.verifyIdToken.mockResolvedValue({ uid: 'member-uid', email: 'member@example.test', email_verified: true });

                const res = await POST(createRequest({ body: validBody }));

                expect(res.status).toBe(403);
                expect((await res.json()).code).toBe('ADMIN_REQUIRED');
                expect(lib()).not.toHaveBeenCalled();
            });

            test('403 unverified admin', async () => {
                adminAuth.verifyIdToken.mockResolvedValue({ ...ADMIN, email_verified: false });

                const res = await POST(createRequest({ body: validBody }));

                expect(res.status).toBe(403);
                expect((await res.json()).code).toBe('EMAIL_NOT_VERIFIED');
                expect(lib()).not.toHaveBeenCalled();
            });

            test('400 bad JSON', async () => {
                const res = await POST(createRequest({ invalidJson: true }));

                expect(res.status).toBe(400);
                expect((await res.json()).code).toBe('INVALID_YEAR');
                expect(lib()).not.toHaveBeenCalled();
            });
        });
    });

    describe('close', () => {
        test.each([
            ['missing', {}],
            ['a string', { year: '2025' }],
            ['before 2025', { year: 2024 }],
            ['fractional', { year: 2025.5 }],
        ])('400 INVALID_YEAR for a year that is %s', async (_label, body) => {
            const res = await closePOST(createRequest({ body }));

            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('INVALID_YEAR');
            expect(closeYear).not.toHaveBeenCalled();
        });

        test.each([
            ['YEAR_MISMATCH', 409],
            ['SERVICE_UNAVAILABLE', 503],
            ['INVALID_YEAR', 400],
        ])('maps %s to %i', async (code, status) => {
            closeYear.mockRejectedValue(new AdmissionError(code));

            const res = await closePOST(createRequest({ body: { year: 2025 } }));

            expect(res.status).toBe(status);
            expect((await res.json()).code).toBe(code);
        });

        test('200 with the lifecycle after the call', async () => {
            closeYear.mockResolvedValue({ year: 2025, state: 'closed', epoch: 1, closedYears: [2025], changed: true });

            const res = await closePOST(createRequest({ body: { year: 2025 } }));

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                success: true,
                year: 2025,
                state: 'closed',
                epoch: 1,
                closedYears: [2025],
                changed: true,
            });
            expect(closeYear).toHaveBeenCalledWith({ year: 2025 });
        });
    });

    describe('start', () => {
        test.each([
            ['fromYear missing', { targetYear: 2026 }],
            ['targetYear missing', { fromYear: 2025 }],
            ['fromYear a string', { fromYear: '2025', targetYear: 2026 }],
            ['targetYear out of range', { fromYear: 2025, targetYear: 10000 }],
        ])('400 INVALID_YEAR when %s', async (_label, body) => {
            const res = await startPOST(createRequest({ body }));

            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('INVALID_YEAR');
            expect(startNewYear).not.toHaveBeenCalled();
        });

        test.each([
            ['INVALID_YEAR', 400],
            ['ROSTER_NOT_CONFIGURED', 409],
            ['YEAR_NOT_CLOSED', 409],
            ['YEAR_MISMATCH', 409],
            ['STALE_REQUEST', 409],
            ['YEAR_NOT_EMPTY', 409],
            ['SERVICE_UNAVAILABLE', 503],
        ])('maps %s to %i', async (code, status) => {
            startNewYear.mockRejectedValue(new AdmissionError(code));

            const res = await startPOST(createRequest({ body: { fromYear: 2025, targetYear: 2026 } }));

            expect(res.status).toBe(status);
            expect((await res.json()).code).toBe(code);
        });

        test('200 with the participant count when the year started', async () => {
            startNewYear.mockResolvedValue({
                year: 2026, state: 'active', epoch: 2, closedYears: [2025], changed: true, participants: 7,
            });

            const res = await startPOST(createRequest({ body: { fromYear: 2025, targetYear: 2026 } }));

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                success: true,
                year: 2026,
                state: 'active',
                epoch: 2,
                closedYears: [2025],
                changed: true,
                participants: 7,
            });
            expect(startNewYear).toHaveBeenCalledWith({ fromYear: 2025, targetYear: 2026 });
        });

        test('200 with participants null when nothing changed', async () => {
            startNewYear.mockResolvedValue({
                year: 2026, state: 'active', epoch: 2, closedYears: [2025], changed: false, participants: null,
            });

            const res = await startPOST(createRequest({ body: { fromYear: 2025, targetYear: 2026 } }));

            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ success: true, changed: false, participants: null });
        });
    });
});
