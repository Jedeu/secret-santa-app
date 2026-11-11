import { POST } from '@/app/api/dev/assign/route';
import { assignUsersInTransaction } from '@/lib/firestore';
import { AdmissionError } from '@/lib/participant-admission';

jest.mock('@/lib/firestore', () => ({
    assignUsersInTransaction: jest.fn(),
}));

describe('POST /api/dev/assign', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NODE_ENV = 'development';
    });

    afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    test('returns 403 outside development', async () => {
        process.env.NODE_ENV = 'production';

        const res = await POST();

        expect(res.status).toBe(403);
        expect(assignUsersInTransaction).not.toHaveBeenCalled();
    });

    test('maps SERVICE_UNAVAILABLE to 503', async () => {
        assignUsersInTransaction.mockRejectedValue(new AdmissionError('SERVICE_UNAVAILABLE'));

        const res = await POST();
        const data = await res.json();

        expect(res.status).toBe(503);
        expect(data.code).toBe('SERVICE_UNAVAILABLE');
    });

    test('maps YEAR_CLOSED to 409', async () => {
        assignUsersInTransaction.mockRejectedValue(new AdmissionError('YEAR_CLOSED'));

        const res = await POST();
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.code).toBe('YEAR_CLOSED');
    });

    test('returns 400 when fewer than two users exist (buildUpdates returns null)', async () => {
        assignUsersInTransaction.mockImplementation(async (buildUpdates) => {
            const updates = buildUpdates([{ id: 'only-user' }]);
            expect(updates).toBeNull();
            return { usersFound: 1, updated: 0 };
        });

        const res = await POST();
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.usersFound).toBe(1);
    });

    test('returns 200 with a reciprocal circular assignment built in the transaction', async () => {
        let built = null;
        assignUsersInTransaction.mockImplementation(async (buildUpdates) => {
            built = buildUpdates([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
            return { usersFound: 3, updated: built.length };
        });

        const res = await POST();
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.assignmentsCount).toBe(3);

        const byId = new Map(built.map((update) => [update.id, update]));
        built.forEach((update) => {
            expect(update.recipientId).not.toBe(update.id);
            expect(byId.get(update.recipientId).gifterId).toBe(update.id);
        });
    });
});
