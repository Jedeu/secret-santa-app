/**
 * Tests for updated /api/admin/reset endpoint - now re-initializes participants
 */

import { POST } from '@/app/api/admin/reset/route';
import * as firestore from '@/lib/firestore';
import { auth as adminAuth } from '@/lib/firebase';

jest.mock('@/lib/firestore');
jest.mock('@/lib/participants', () => ({
    PARTICIPANTS: [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
    ]
}));

describe('POST /api/admin/reset - With Participant Re-initialization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should reset database and re-initialize participants for admin', async () => {
        // Mock Firebase Admin Auth token verification
        adminAuth.verifyIdToken.mockResolvedValue({
            uid: 'admin-uid',
            email: 'jed.piezas@gmail.com'
        });

        firestore.resetDatabase.mockResolvedValue();
        firestore.ensureAllParticipants.mockResolvedValue();

        const req = {
            method: 'POST',
            headers: {
                get: (name) => name === 'Authorization' ? 'Bearer fake-token' : null
            }
        };

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.message).toMatch(/re-initialized/i);

        // Verify both functions were called
        expect(firestore.resetDatabase).toHaveBeenCalled();
        expect(firestore.ensureAllParticipants).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ name: 'Alice', email: 'alice@example.com' }),
                expect.objectContaining({ name: 'Bob', email: 'bob@example.com' })
            ])
        );
    });

    test('should deny access to non-admin users', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({
            uid: 'user-uid',
            email: 'not-admin@example.com'
        });

        const req = {
            method: 'POST',
            headers: {
                get: (name) => name === 'Authorization' ? 'Bearer fake-token' : null
            }
        };

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toMatch(/Admin access required/);
        expect(firestore.resetDatabase).not.toHaveBeenCalled();
    });

    test('should deny access when not authenticated', async () => {
        // No Authorization header

        const req = {
            method: 'POST',
            headers: {
                get: () => null
            }
        };

        const res = await POST(req);

        expect(res.status).toBe(401);
        expect(firestore.resetDatabase).not.toHaveBeenCalled();
    });

    test('should handle reset errors gracefully', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({
            uid: 'admin-uid',
            email: 'jed.piezas@gmail.com'
        });

        firestore.resetDatabase.mockRejectedValue(new Error('Database error'));

        const req = {
            method: 'POST',
            headers: {
                get: (name) => name === 'Authorization' ? 'Bearer fake-token' : null
            }
        };

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to reset database');
    });

    test('should handle participant initialization errors', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({
            uid: 'admin-uid',
            email: 'jed.piezas@gmail.com'
        });

        firestore.resetDatabase.mockResolvedValue();
        firestore.ensureAllParticipants.mockRejectedValue(new Error('Init error'));

        const req = {
            method: 'POST',
            headers: {
                get: (name) => name === 'Authorization' ? 'Bearer fake-token' : null
            }
        };

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to reset database');
    });

    test('should call functions in correct order', async () => {
        adminAuth.verifyIdToken.mockResolvedValue({
            uid: 'admin-uid',
            email: 'jed.piezas@gmail.com'
        });

        const callOrder = [];
        firestore.resetDatabase.mockImplementation(() => {
            callOrder.push('reset');
            return Promise.resolve();
        });
        firestore.ensureAllParticipants.mockImplementation(() => {
            callOrder.push('initialize');
            return Promise.resolve();
        });

        const req = {
            method: 'POST',
            headers: {
                get: (name) => name === 'Authorization' ? 'Bearer fake-token' : null
            }
        };

        await POST(req);

        // Verify reset happens before initialization
        expect(callOrder).toEqual(['reset', 'initialize']);
    });
});
