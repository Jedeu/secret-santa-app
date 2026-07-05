import { getUserByEmail, createUser, getAllUsers, batchUpdateUsers, resetDatabase } from '@/lib/firestore';

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

    describe('resetDatabase', () => {
        const APP_COLLECTIONS = ['users', 'messages', 'lastRead', 'typing', 'reactions', 'pushTokens'];

        test('should delete documents from every app collection', async () => {
            const mockBatch = {
                delete: jest.fn(),
                commit: jest.fn().mockResolvedValue(undefined)
            };
            mockFirestore.batch.mockReturnValue(mockBatch);

            // One doc per collection
            mockFirestore.get.mockResolvedValue({
                docs: [{ ref: 'mockRef' }]
            });

            await resetDatabase();

            APP_COLLECTIONS.forEach((collectionName) => {
                expect(mockFirestore.collection).toHaveBeenCalledWith(collectionName);
            });
            expect(mockBatch.commit).toHaveBeenCalledTimes(APP_COLLECTIONS.length);
            expect(mockBatch.delete).toHaveBeenCalledTimes(APP_COLLECTIONS.length);
        });

        test('should skip batch commits for empty collections', async () => {
            const mockBatch = {
                delete: jest.fn(),
                commit: jest.fn().mockResolvedValue(undefined)
            };
            mockFirestore.batch.mockReturnValue(mockBatch);

            mockFirestore.get.mockResolvedValue({ docs: [] });

            await resetDatabase();

            expect(mockBatch.commit).not.toHaveBeenCalled();
        });

        test('should chunk deletes into batches of at most 500 operations', async () => {
            const commitCalls = [];
            const batches = [];
            mockFirestore.batch.mockImplementation(() => {
                const batch = {
                    delete: jest.fn(),
                    commit: jest.fn().mockImplementation(() => {
                        commitCalls.push(batch.delete.mock.calls.length);
                        return Promise.resolve();
                    })
                };
                batches.push(batch);
                return batch;
            });

            const manyDocs = Array.from({ length: 1201 }, (_, i) => ({ ref: `ref-${i}` }));
            // First collection has 1201 docs, the rest are empty
            mockFirestore.get
                .mockResolvedValueOnce({ docs: manyDocs })
                .mockResolvedValue({ docs: [] });

            await resetDatabase();

            // 1201 docs -> batches of 500, 500, 201
            expect(commitCalls).toEqual([500, 500, 201]);
            batches.forEach((batch) => {
                expect(batch.delete.mock.calls.length).toBeLessThanOrEqual(500);
                expect(batch.commit).toHaveBeenCalledTimes(1);
            });
        });
    });
});
