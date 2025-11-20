import { POST, GET } from '@/app/api/messages/route';
import { getServerSession } from "next-auth/next";
import * as firestore from '@/lib/firestore';

// Mock dependencies
jest.mock("next-auth/next");
jest.mock('@/lib/firestore');
jest.mock('@/auth.config', () => ({
    authOptions: {}
}));

describe('API /messages', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /messages', () => {
        test('POST /messages - Success (Send to Recipient)', async () => {
            getServerSession.mockResolvedValue({ user: { email: 'alice@example.com' } });

            const alice = { id: '1', name: 'Alice', email: 'alice@example.com', recipientId: '2' };
            firestore.getUserByEmail.mockResolvedValue(alice);
            firestore.getUserById.mockResolvedValue(alice);
            firestore.sendMessage.mockResolvedValue();

            const req = new Request('http://localhost/api/messages', {
                method: 'POST',
                body: JSON.stringify({ fromId: '1', toId: '2', content: 'Hello' })
            });

            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.content).toBe('Hello');
            expect(firestore.sendMessage).toHaveBeenCalled();
        });

        test('POST /messages - Forbidden (Send to random user)', async () => {
            getServerSession.mockResolvedValue({ user: { email: 'alice@example.com' } });

            const alice = { id: '1', name: 'Alice', email: 'alice@example.com', recipientId: '2', gifterId: '3' };
            firestore.getUserByEmail.mockResolvedValue(alice);
            firestore.getUserById.mockResolvedValue(alice);

            // Alice tries to message user 4 (not recipient or Santa)
            const req = new Request('http://localhost/api/messages', {
                method: 'POST',
                body: JSON.stringify({ fromId: '1', toId: '4', content: 'Hello' })
            });

            const res = await POST(req);
            expect(res.status).toBe(403);
        });
    });

    describe('GET /messages (Public Feed)', () => {
        test('GET /messages - Anonymizes Santa names', async () => {
            const messages = [
                { id: 'm1', fromId: '1', toId: '2', content: 'Ho Ho Ho' } // Alice (1) -> Bob (2)
            ];
            const users = [
                { id: '1', name: 'Alice', recipientId: '2' },
                { id: '2', name: 'Bob', gifterId: '1' }
            ];

            firestore.getAllMessagesWithCache.mockResolvedValue(messages);
            firestore.getAllUsersWithCache.mockResolvedValue(users);

            const req = new Request('http://localhost/api/messages');
            const res = await GET(req);
            const data = await res.json();

            expect(data).toHaveLength(1);
            expect(data[0].fromName).toBe('Secret Santa'); // Should be masked
            expect(data[0].toName).toBe('Bob');
            expect(data[0].isSantaMsg).toBe(true);
        });
    });
});
