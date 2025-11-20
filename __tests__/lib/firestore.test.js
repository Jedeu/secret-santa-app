import { getUserByEmail, createUser, sendMessage, getMessages, getAllUsers, batchUpdateUsers, markAsRead, getLastRead, resetDatabase } from '@/lib/firestore';
import fs from 'fs';
import path from 'path';

// Mock fs to avoid writing to disk
jest.mock('fs');
jest.mock('path', () => ({
    join: jest.fn(() => '/mock/db.json'),
    dirname: jest.fn(() => '/mock')
}));

// Mock Firebase (we want to test local fallback logic mostly, or mock firestore if we can)
// Since the app uses local fallback when firestore is not init, we'll test that path for simplicity
// as it covers the core logic. Ideally we'd mock the firestore module itself.
jest.mock('@/lib/firebase', () => ({
    firestore: null // Force local DB fallback
}));

describe('Firestore (Local Fallback)', () => {
    const mockDbPath = '/mock/db.json';
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        // path mocks are handled in factory

        // Initial DB state
        mockDb = {
            users: [],
            messages: [],
            lastRead: []
        };

        // Mock fs.existsSync
        fs.existsSync.mockImplementation((p) => {
            if (p === mockDbPath) return true;
            if (p === '/mock') return true;
            return false;
        });

        // Mock fs.readFileSync
        fs.readFileSync.mockImplementation(() => JSON.stringify(mockDb));

        // Mock fs.writeFileSync
        fs.writeFileSync.mockImplementation((p, data) => {
            if (p === mockDbPath) {
                mockDb = JSON.parse(data);
            }
        });
    });

    test('createUser adds a user to the DB', async () => {
        const newUser = { id: '1', name: 'Alice', email: 'alice@example.com' };
        await createUser(newUser);

        expect(mockDb.users).toHaveLength(1);
        expect(mockDb.users[0]).toEqual(newUser);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('getUserByEmail finds the correct user', async () => {
        mockDb.users = [{ id: '1', name: 'Alice', email: 'alice@example.com' }];

        const user = await getUserByEmail('alice@example.com');
        expect(user).toEqual(mockDb.users[0]);

        const notFound = await getUserByEmail('bob@example.com');
        expect(notFound).toBeNull();
    });

    test('sendMessage adds a message', async () => {
        const msg = { id: 'm1', fromId: '1', toId: '2', content: 'Hello' };
        await sendMessage(msg);

        expect(mockDb.messages).toHaveLength(1);
        expect(mockDb.messages[0]).toEqual(msg);
    });

    test('getMessages retrieves conversation between two users', async () => {
        mockDb.messages = [
            { id: 'm1', fromId: '1', toId: '2', content: 'Hi', timestamp: '2023-01-01T10:00:00Z' },
            { id: 'm2', fromId: '2', toId: '1', content: 'Hello', timestamp: '2023-01-01T10:01:00Z' },
            { id: 'm3', fromId: '1', toId: '3', content: 'Other', timestamp: '2023-01-01T10:02:00Z' }
        ];

        const conversation = await getMessages('1', '2');
        expect(conversation).toHaveLength(2);
        expect(conversation[0].id).toBe('m1');
        expect(conversation[1].id).toBe('m2');
    });

    test('batchUpdateUsers updates multiple users', async () => {
        mockDb.users = [
            { id: '1', name: 'Alice', recipientId: null },
            { id: '2', name: 'Bob', recipientId: null }
        ];

        const updates = [
            { id: '1', recipientId: '2' },
            { id: '2', recipientId: '1' }
        ];

        await batchUpdateUsers(updates);

        expect(mockDb.users[0].recipientId).toBe('2');
        expect(mockDb.users[1].recipientId).toBe('1');
    });

    test('markAsRead and getLastRead work correctly', async () => {
        await markAsRead('1', 'conv_1_2');

        const lastRead = await getLastRead('1', 'conv_1_2');
        expect(lastRead).toBeDefined();
        expect(lastRead.userId).toBe('1');
        expect(lastRead.conversationId).toBe('conv_1_2');
        expect(lastRead.lastReadAt).toBeDefined();
    });

    test('resetDatabase clears all data', async () => {
        mockDb.users = [{ id: '1', name: 'Alice' }];
        mockDb.messages = [{ id: 'm1', content: 'Hi' }];
        mockDb.lastRead = [{ userId: '1', conversationId: 'c1' }];

        await resetDatabase();

        expect(mockDb.users).toHaveLength(0);
        expect(mockDb.messages).toHaveLength(0);
        expect(mockDb.lastRead).toHaveLength(0);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });
});
