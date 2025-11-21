/**
 * Tests for updated /api/admin/reset endpoint - now re-initializes participants
 */

import { POST } from '@/app/api/admin/reset/route';
import { getServerSession } from "next-auth/next";
import * as firestore from '@/lib/firestore';

jest.mock("next-auth/next");
jest.mock('@/lib/firestore');
jest.mock('@/lib/participants', () => ({
    PARTICIPANTS: [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
    ]
}));
jest.mock('@/auth.config', () => ({
    authOptions: {}
}));

describe('POST /api/admin/reset - With Participant Re-initialization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should reset database and re-initialize participants for admin', async () => {
        // Mock admin session
        getServerSession.mockResolvedValue({
            user: { email: 'jed.piezas@gmail.com' }
        });

        firestore.resetDatabase.mockResolvedValue();
        firestore.ensureAllParticipants.mockResolvedValue();

        const req = new Request('http://localhost/api/admin/reset', {
            method: 'POST'
        });

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
        getServerSession.mockResolvedValue({
            user: { email: 'not-admin@example.com' }
        });

        const req = new Request('http://localhost/api/admin/reset', {
            method: 'POST'
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
        expect(firestore.resetDatabase).not.toHaveBeenCalled();
    });

    test('should deny access when not authenticated', async () => {
        getServerSession.mockResolvedValue(null);

        const req = new Request('http://localhost/api/admin/reset', {
            method: 'POST'
        });

        const res = await POST(req);

        expect(res.status).toBe(401);
        expect(firestore.resetDatabase).not.toHaveBeenCalled();
    });

    test('should handle reset errors gracefully', async () => {
        getServerSession.mockResolvedValue({
            user: { email: 'jed.piezas@gmail.com' }
        });

        firestore.resetDatabase.mockRejectedValue(new Error('Database error'));

        const req = new Request('http://localhost/api/admin/reset', {
            method: 'POST'
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to reset database');
    });

    test('should handle participant initialization errors', async () => {
        getServerSession.mockResolvedValue({
            user: { email: 'jed.piezas@gmail.com' }
        });

        firestore.resetDatabase.mockResolvedValue();
        firestore.ensureAllParticipants.mockRejectedValue(new Error('Init error'));

        const req = new Request('http://localhost/api/admin/reset', {
            method: 'POST'
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to reset database');
    });

    test('should call functions in correct order', async () => {
        getServerSession.mockResolvedValue({
            user: { email: 'jed.piezas@gmail.com' }
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

        const req = new Request('http://localhost/api/admin/reset', {
            method: 'POST'
        });

        await POST(req);

        // Verify reset happens before initialization
        expect(callOrder).toEqual(['reset', 'initialize']);
    });
});
