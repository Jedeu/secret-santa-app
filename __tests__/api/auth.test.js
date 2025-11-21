import { POST } from '@/app/api/auth/route';
import { getServerSession } from "next-auth/next";
import * as firestore from '@/lib/firestore';

// Mock dependencies
jest.mock("next-auth/next");
jest.mock('@/lib/firestore');
jest.mock('@/lib/participants', () => ({
    PARTICIPANTS: [
        { name: 'Jed', email: 'jed.piezas@gmail.com' },
        { name: 'Natalie', email: 'ncammarasana@gmail.com' },
        { name: 'Chinh', email: 'chinhhuynhlmft@gmail.com' }
    ],
    getParticipantEmail: jest.fn((name) => {
        const participants = {
            'Jed': 'jed.piezas@gmail.com',
            'Natalie': 'ncammarasana@gmail.com',
            'Chinh': 'chinhhuynhlmft@gmail.com'
        };
        return participants[name] || null;
    })
}));
jest.mock('@/auth.config', () => ({
    authOptions: {}
}));

describe('API /auth - Email-Based Recipient Selection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /auth (setRecipient)', () => {
        test('should successfully set recipient using pre-created participant', async () => {
            // Mock session for Jed
            getServerSession.mockResolvedValue({ user: { email: 'jed.piezas@gmail.com' } });

            // Mock Jed and Natalie both existing (pre-created)
            const mockJed = {
                id: 'jed-id',
                name: 'Jed',
                email: 'jed.piezas@gmail.com',
                recipientId: null,
                gifterId: null
            };
            const mockNatalie = {
                id: 'natalie-id',
                name: 'Natalie',
                email: 'ncammarasana@gmail.com',
                recipientId: null,
                gifterId: null
            };

            firestore.getUserByEmail
                .mockResolvedValueOnce(mockJed) // First call for Jed
                .mockResolvedValueOnce(mockNatalie); // Second call for Natalie
            firestore.batchUpdateUsers.mockResolvedValue();

            const req = new Request('http://localhost/api/auth', {
                method: 'POST',
                body: JSON.stringify({ action: 'setRecipient', recipientName: 'Natalie' })
            });

            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);

            // Verify it called batchUpdateUsers with both users
            expect(firestore.batchUpdateUsers).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'jed-id', recipientId: 'natalie-id' }),
                    expect.objectContaining({ id: 'natalie-id', gifterId: 'jed-id' })
                ])
            );
        });

        test('should reject if recipient is already taken', async () => {
            getServerSession.mockResolvedValue({ user: { email: 'jed.piezas@gmail.com' } });

            const mockJed = { id: 'jed-id', email: 'jed.piezas@gmail.com', recipientId: null };
            const mockNatalie = {
                id: 'natalie-id',
                email: 'ncammarasana@gmail.com',
                gifterId: 'someone-else-id' // Already taken!
            };

            firestore.getUserByEmail
                .mockResolvedValueOnce(mockJed)
                .mockResolvedValueOnce(mockNatalie);

            const req = new Request('http://localhost/api/auth', {
                method: 'POST',
                body: JSON.stringify({ action: 'setRecipient', recipientName: 'Natalie' })
            });

            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.error).toMatch(/already been selected/i);
        });

        test('should reject if user already has recipient assigned', async () => {
            getServerSession.mockResolvedValue({ user: { email: 'jed.piezas@gmail.com' } });

            const mockJed = {
                id: 'jed-id',
                recipientId: 'existing-recipient-id' // Already assigned!
            };
            firestore.getUserByEmail.mockResolvedValue(mockJed);

            const req = new Request('http://localhost/api/auth', {
                method: 'POST',
                body: JSON.stringify({ action: 'setRecipient', recipientName: 'Natalie' })
            });

            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.error).toMatch(/already assigned/i);
        });

        test('should reject invalid recipient name', async () => {
            getServerSession.mockResolvedValue({ user: { email: 'jed.piezas@gmail.com' } });
            firestore.getUserByEmail.mockResolvedValue({ id: 'jed-id', recipientId: null });

            const req = new Request('http://localhost/api/auth', {
                method: 'POST',
                body: JSON.stringify({ action: 'setRecipient', recipientName: 'InvalidPerson' })
            });

            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.error).toMatch(/Invalid recipient/i);
        });

        test('should create recipient if not found (fallback)', async () => {
            getServerSession.mockResolvedValue({ user: { email: 'jed.piezas@gmail.com' } });

            const mockJed = { id: 'jed-id', recipientId: null };

            firestore.getUserByEmail
                .mockResolvedValueOnce(mockJed) // Jed
                .mockResolvedValueOnce(null); // Natalie not found

            firestore.createUser.mockResolvedValue({ id: 'new-natalie-id' });
            firestore.batchUpdateUsers.mockResolvedValue();

            const req = new Request('http://localhost/api/auth', {
                method: 'POST',
                body: JSON.stringify({ action: 'setRecipient', recipientName: 'Natalie' })
            });

            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(firestore.createUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Natalie',
                    email: 'ncammarasana@gmail.com'
                })
            );
        });

        test('should require authentication', async () => {
            getServerSession.mockResolvedValue(null);

            const req = new Request('http://localhost/api/auth', {
                method: 'POST',
                body: JSON.stringify({ action: 'setRecipient', recipientName: 'Natalie' })
            });

            const res = await POST(req);
            expect(res.status).toBe(401);
        });
    });
});
