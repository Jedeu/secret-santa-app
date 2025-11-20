import { POST } from '@/app/api/auth/route';
import { getServerSession } from "next-auth/next";
import * as firestore from '@/lib/firestore';

// Mock dependencies
jest.mock("next-auth/next");
jest.mock('@/lib/firestore');
jest.mock('@/auth.config', () => ({
    authOptions: {}
}));

describe('API /auth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /auth (setRecipient) - Success', async () => {
        // Mock session
        getServerSession.mockResolvedValue({ user: { email: 'alice@example.com' } });

        // Mock user found
        const mockUser = { id: '1', name: 'Alice', email: 'alice@example.com', recipientId: null };
        firestore.getUserByEmail.mockResolvedValue(mockUser);
        firestore.getAllUsers.mockResolvedValue([mockUser]);
        firestore.createUser.mockResolvedValue({ id: '2', name: 'Natalie' });
        firestore.batchUpdateUsers.mockResolvedValue();

        const req = new Request('http://localhost/api/auth', {
            method: 'POST',
            body: JSON.stringify({ action: 'setRecipient', recipientName: 'Natalie' })
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(firestore.batchUpdateUsers).toHaveBeenCalled();
    });

    test('POST /auth (setRecipient) - Unauthorized', async () => {
        getServerSession.mockResolvedValue(null);

        const req = new Request('http://localhost/api/auth', {
            method: 'POST',
            body: JSON.stringify({ action: 'setRecipient', recipientName: 'Bob' })
        });

        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    test('POST /auth (setRecipient) - Already Assigned', async () => {
        getServerSession.mockResolvedValue({ user: { email: 'alice@example.com' } });

        const mockUser = { id: '1', name: 'Alice', recipientId: 'existing-id' };
        firestore.getUserByEmail.mockResolvedValue(mockUser);

        const req = new Request('http://localhost/api/auth', {
            method: 'POST',
            body: JSON.stringify({ action: 'setRecipient', recipientName: 'Bob' })
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/already assigned/i);
    });

    test('POST /auth (assign) - Success', async () => {
        // Mock admin session (assuming no strict admin check in code for now, or we mock it if it exists)
        // The current code doesn't seem to check for specific admin email for 'assign', 
        // but let's assume it might or we just test the logic.
        // Actually, looking at the code, 'assign' action doesn't check for admin email, 
        // only 'reset' does. 'assign' just checks if enough users exist.

        getServerSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
        firestore.getUserByEmail.mockResolvedValue({ id: 'admin', email: 'admin@example.com' });

        const mockUsers = [
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
            { id: '3', name: 'Charlie' }
        ];
        firestore.getAllUsers.mockResolvedValue(mockUsers);
        firestore.batchUpdateUsers.mockResolvedValue();

        const req = new Request('http://localhost/api/auth', {
            method: 'POST',
            body: JSON.stringify({ action: 'assign' })
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(firestore.batchUpdateUsers).toHaveBeenCalled();

        // Verify that batchUpdateUsers was called with users having recipientId and gifterId
        const updatedUsers = firestore.batchUpdateUsers.mock.calls[0][0];
        expect(updatedUsers).toHaveLength(3);
        updatedUsers.forEach(u => {
            expect(u.recipientId).toBeDefined();
            expect(u.gifterId).toBeDefined();
        });
    });

    test('POST /auth (assign) - Not Enough Users', async () => {
        getServerSession.mockResolvedValue({ user: { email: 'admin@example.com' } });
        firestore.getUserByEmail.mockResolvedValue({ id: 'admin', email: 'admin@example.com' });

        const mockUsers = [{ id: '1', name: 'Alice' }]; // Only 1 user
        firestore.getAllUsers.mockResolvedValue(mockUsers);

        const req = new Request('http://localhost/api/auth', {
            method: 'POST',
            body: JSON.stringify({ action: 'assign' })
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/not enough users/i);
    });
});
