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
});
