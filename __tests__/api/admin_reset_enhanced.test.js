/**
 * Tests for /api/admin/reset - exclusive, fail-closed reset + participant reseed
 */

import { POST } from '@/app/api/admin/reset/route';
import * as firestore from '@/lib/firestore';
import { auth as adminAuth } from '@/lib/firebase';
import { ADMIN_EMAILS } from '@/lib/config';
import { AdmissionError } from '@/lib/participant-admission';

jest.mock('@/lib/firestore');
jest.mock('@/lib/participants', () => ({
    PARTICIPANTS: [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
    ]
}));

const ADMIN_EMAIL = ADMIN_EMAILS[0];

function createRequest(withToken = true) {
    return {
        method: 'POST',
        headers: {
            get: (name) => (withToken && name === 'Authorization' ? 'Bearer fake-token' : null)
        }
    };
}

describe('POST /api/admin/reset', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('resets and reseeds participants for an admin, with no hooks', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: ADMIN_EMAIL });
        firestore.resetAndReseedParticipants.mockResolvedValue();

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.message).toMatch(/re-initialized/i);

        expect(firestore.resetAndReseedParticipants).toHaveBeenCalledTimes(1);
        const args = firestore.resetAndReseedParticipants.mock.calls[0];
        expect(args).toHaveLength(1);
        expect(args[0]).toEqual([
            { name: 'Alice', email: 'alice@example.com' },
            { name: 'Bob', email: 'bob@example.com' }
        ]);
        expect(firestore.resetDatabase).not.toHaveBeenCalled();
        expect(firestore.ensureAllParticipants).not.toHaveBeenCalled();
    });

    test('should deny access to non-admin users', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ uid: 'user-uid', email: 'not-admin@example.com' });

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toMatch(/Admin access required/);
        expect(firestore.resetAndReseedParticipants).not.toHaveBeenCalled();
    });

    test('should deny access when not authenticated', async () => {
        const res = await POST(createRequest(false));

        expect(res.status).toBe(401);
        expect(firestore.resetAndReseedParticipants).not.toHaveBeenCalled();
    });

    test('maps RESET_SUPERSEDED to 409', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: ADMIN_EMAIL });
        firestore.resetAndReseedParticipants.mockRejectedValue(new AdmissionError('RESET_SUPERSEDED'));

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.code).toBe('RESET_SUPERSEDED');
    });

    test('other failures return 500 asking to run Reset again', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({ uid: 'admin-uid', email: ADMIN_EMAIL });
        firestore.resetAndReseedParticipants.mockRejectedValue(new Error('Database error'));

        const res = await POST(createRequest());
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Reset did not complete. Run Reset again.');
    });
});
