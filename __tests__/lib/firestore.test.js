import { getUserByEmail, createUser, sendMessage, getMessages, getAllUsers, batchUpdateUsers, markAsRead, getLastRead, resetDatabase } from '@/lib/firestore';

// Mock Firebase Admin SDK
jest.mock('@/lib/firebase', () => ({
    firestore: {
        collection: jest.fn(function () { return this; }),
        where: jest.fn(function () { return this; }),
        limit: jest.fn(function () { return this; }),
        orderBy: jest.fn(function () { return this; }),
        get: jest.fn(),
        doc: jest.fn(() => ({
            set: jest.fn(),
            get: jest.fn(),
            update: jest.fn(),
            ref: 'mockRef'
        })),
        batch: jest.fn(),
    }
}));

// Get reference to the mocked firestore for test setup
import { firestore as mockFirestore } from '@/lib/firebase';

describe('Firestore Functions (Unit Tests with Mocks)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getUserByEmail', () => {
        test('should return user when found', async () => {
            const mockUser = { id: '1', name: 'Alice', email: 'alice@example.com' };
            mockFirestore.get.mockResolvedValueOnce({
                empty: false,
                docs: [{ data: () => mockUser }]
            });

            const user = await getUserByEmail('alice@example.com');

            expect(user).toEqual(mockUser);
            expect(mockFirestore.collection).toHaveBeenCalledWith('users');
            expect(mockFirestore.where).toHaveBeenCalledWith('email', '==', 'alice@example.com');
        });

        test('should return null when user not found', async () => {
            mockFirestore.get.mockResolvedValueOnce({ empty: true });

            const user = await getUserByEmail('notfound@example.com');

            expect(user).toBeNull();
        });
    });

    describe('createUser', () => {
        test('should create user with normalized name', async () => {
            const mockDoc = { set: jest.fn().mockResolvedValue(undefined) };
            mockFirestore.doc.mockReturnValue(mockDoc);

            const newUser = { id: '1', name: 'alice smith', email: 'alice@example.com' };

            await createUser(newUser);

            expect(mockFirestore.collection).toHaveBeenCalledWith('users');
            expect(mockFirestore.doc).toHaveBeenCalledWith('1');
            expect(mockDoc.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Alice Smith', // Should be title-cased
                    email: 'alice@example.com'
                })
            );
        });
    });

    describe('sendMessage', () => {
        test('should send message to Firestore', async () => {
            const mockDoc = { set: jest.fn().mockResolvedValue(undefined) };
            mockFirestore.doc.mockReturnValue(mockDoc);

            const msg = { id: 'm1', fromId: '1', toId: '2', content: 'Hello', timestamp: '2023-01-01T10:00:00Z' };

            await sendMessage(msg);

            expect(mockFirestore.collection).toHaveBeenCalledWith('messages');
            expect(mockFirestore.doc).toHaveBeenCalledWith('m1');
            expect(mockDoc.set).toHaveBeenCalledWith(msg);
        });
    });

    describe('getMessages', () => {
        test('should retrieve conversation between two users', async () => {
            const msg1 = { id: 'm1', fromId: '1', toId: '2', content: 'Hi', timestamp: '2023-01-01T10:00:00Z' };
            const msg2 = { id: 'm2', fromId: '2', toId: '1', content: 'Hello', timestamp: '2023-01-01T10:01:00Z' };

            // Mock two separate queries (sent and received)
            mockFirestore.get
                .mockResolvedValueOnce({
                    forEach: (cb) => [msg1].forEach(msg => cb({ data: () => msg }))
                })
                .mockResolvedValueOnce({
                    forEach: (cb) => [msg2].forEach(msg => cb({ data: () => msg }))
                });

            const conversation = await getMessages('1', '2');

            expect(conversation).toHaveLength(2);
            expect(conversation[0].id).toBe('m1');
            expect(conversation[1].id).toBe('m2');
        });
    });

    describe('getAllUsers', () => {
        test('should retrieve all users', async () => {
            const users = [
                { id: '1', name: 'Alice' },
                { id: '2', name: 'Bob' }
            ];

            mockFirestore.get.mockResolvedValueOnce({
                forEach: (cb) => users.forEach(user => cb({ data: () => user }))
            });

            const result = await getAllUsers();

            expect(result).toEqual(users);
            expect(mockFirestore.collection).toHaveBeenCalledWith('users');
        });
    });

    describe('batchUpdateUsers', () => {
        test('should batch update multiple users', async () => {
            const mockBatch = {
                update: jest.fn(),
                commit: jest.fn().mockResolvedValue(undefined)
            };
            mockFirestore.batch.mockReturnValue(mockBatch);
            mockFirestore.doc.mockReturnValue({ ref: 'mockRef' });

            const updates = [
                { id: '1', recipientId: '2', gifterId: '3' },
                { id: '2', recipientId: '1', gifterId: '4' }
            ];

            await batchUpdateUsers(updates);

            expect(mockFirestore.batch).toHaveBeenCalled();
            expect(mockBatch.update).toHaveBeenCalledTimes(2);
            expect(mockBatch.commit).toHaveBeenCalled();
        });
    });

    describe('markAsRead and getLastRead', () => {
        test('should mark conversation as read', async () => {
            const mockDoc = { set: jest.fn().mockResolvedValue(undefined) };
            mockFirestore.doc.mockReturnValue(mockDoc);

            await markAsRead('user1', 'conv_1_2');

            expect(mockFirestore.collection).toHaveBeenCalledWith('lastRead');
            expect(mockFirestore.doc).toHaveBeenCalledWith('user1_conv_1_2');
            expect(mockDoc.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user1',
                    conversationId: 'conv_1_2'
                })
            );
        });

        test('should get last read timestamp', async () => {
            const mockData = { userId: 'user1', conversationId: 'conv_1_2', lastReadAt: '2023-01-01T10:00:00Z' };
            const mockDoc = {
                get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => mockData
                })
            };
            mockFirestore.doc.mockReturnValue(mockDoc);

            const result = await getLastRead('user1', 'conv_1_2');

            expect(result).toEqual(mockData);
        });

        test('should return null when no read status exists', async () => {
            const mockDoc = {
                get: jest.fn().mockResolvedValue({ exists: false })
            };
            mockFirestore.doc.mockReturnValue(mockDoc);

            const result = await getLastRead('user1', 'conv_1_2');

            expect(result).toBeNull();
        });
    });

    describe('resetDatabase', () => {
        test('should delete all documents from all collections', async () => {
            const mockBatch = {
                delete: jest.fn(),
                commit: jest.fn().mockResolvedValue(undefined)
            };
            mockFirestore.batch.mockReturnValue(mockBatch);

            // Mock empty collections with docs array
            mockFirestore.get.mockResolvedValue({
                docs: [],
                forEach: jest.fn()
            });

            await resetDatabase();

            expect(mockFirestore.collection).toHaveBeenCalledWith('users');
            expect(mockFirestore.collection).toHaveBeenCalledWith('messages');
            expect(mockFirestore.collection).toHaveBeenCalledWith('lastRead');
            expect(mockBatch.commit).toHaveBeenCalledTimes(3);
        });
    });
});
