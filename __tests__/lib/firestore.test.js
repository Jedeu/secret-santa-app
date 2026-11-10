import {
    getUserByEmail,
    createUser,
    getAllUsers,
    resetDatabase,
    resetAndReseedParticipants,
    assignUsersInTransaction,
    APP_COLLECTIONS,
} from '@/lib/firestore';
import {
    beginReset,
    assertResetOwner,
    completeReset,
    assertLifecycleActive,
    ensureParticipantProfiles,
    AdmissionError,
} from '@/lib/participant-admission';

// Mock Firebase Admin SDK
jest.mock('@/lib/firebase', () => ({
    firestore: {
        collection: jest.fn(),
        where: jest.fn(),
        limit: jest.fn(),
        orderBy: jest.fn(),
        get: jest.fn(),
        doc: jest.fn(),
        batch: jest.fn(),
        runTransaction: jest.fn(),
    }
}));

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        beginReset: jest.fn(),
        assertResetOwner: jest.fn(),
        completeReset: jest.fn(),
        assertLifecycleActive: jest.fn(),
        ensureParticipantProfiles: jest.fn(),
    };
});

// Get reference to the mocked firestore for test setup
import { firestore as mockFirestore } from '@/lib/firebase';

function useChainableFirestore() {
    mockFirestore.collection.mockImplementation(function () { return this; });
    mockFirestore.where.mockImplementation(function () { return this; });
    mockFirestore.limit.mockImplementation(function () { return this; });
    mockFirestore.orderBy.mockImplementation(function () { return this; });
    mockFirestore.doc.mockImplementation(() => ({
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        ref: 'mockRef'
    }));
}

/**
 * Fake collections for reset tests. Each transaction records the collection it read,
 * the limit it used and how many deletes it issued.
 */
function useResetCollections(docCounts = {}, { failDeleteIn = null } = {}) {
    const remaining = { ...docCounts };
    const transactions = [];

    mockFirestore.collection.mockImplementation((name) => ({
        limit: (n) => ({ __collection: name, __limit: n }),
        doc: (id) => ({ __collection: name, id }),
    }));

    mockFirestore.runTransaction.mockImplementation(async (fn) => {
        const record = { collection: null, limit: null, deletes: 0 };
        transactions.push(record);
        const tx = {
            get: jest.fn(async (query) => {
                record.collection = query.__collection;
                record.limit = query.__limit;
                const available = remaining[query.__collection] || 0;
                const count = Math.min(available, query.__limit);
                remaining[query.__collection] = available - count;
                return {
                    docs: Array.from({ length: count }, (_, i) => ({
                        ref: { collection: query.__collection, i }
                    }))
                };
            }),
            delete: jest.fn((ref) => {
                if (failDeleteIn && ref.collection === failDeleteIn) {
                    throw new Error('delete failed');
                }
                record.deletes += 1;
            }),
        };
        return fn(tx);
    });

    return { transactions };
}

describe('Firestore Functions (Unit Tests with Mocks)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useChainableFirestore();
        beginReset.mockResolvedValue({ resetId: 'reset-1', epoch: 2 });
        assertResetOwner.mockResolvedValue(undefined);
        completeReset.mockResolvedValue(undefined);
        assertLifecycleActive.mockResolvedValue({ epoch: 1 });
        ensureParticipantProfiles.mockResolvedValue({ created: 0, linked: 0, existing: 0 });
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

    describe('resetDatabase', () => {
        test('APP_COLLECTIONS lists every app collection in deletion order', () => {
            expect(APP_COLLECTIONS).toEqual([
                'authIdentities', 'participantIndex', 'users', 'messages',
                'lastRead', 'typing', 'reactions', 'pushTokens'
            ]);
        });

        test('begins, deletes all eight collections in order in owner-checked transactions, then completes', async () => {
            const counts = Object.fromEntries(APP_COLLECTIONS.map((name) => [name, 1]));
            const { transactions } = useResetCollections(counts);

            await resetDatabase();

            expect(beginReset).toHaveBeenCalledTimes(1);

            // Each collection: one transaction deleting its doc, one finding it empty.
            const order = [];
            transactions.forEach((record) => {
                if (order[order.length - 1] !== record.collection) {
                    order.push(record.collection);
                }
            });
            expect(order).toEqual(APP_COLLECTIONS);

            // Every delete transaction checked reset ownership first.
            expect(assertResetOwner).toHaveBeenCalledTimes(transactions.length);
            assertResetOwner.mock.calls.forEach(([, resetId]) => {
                expect(resetId).toBe('reset-1');
            });

            expect(completeReset).toHaveBeenCalledWith('reset-1');
            expect(completeReset.mock.invocationCallOrder[0])
                .toBeGreaterThan(Math.max(...assertResetOwner.mock.invocationCallOrder));
        });

        test('chunks deletes into transactions of at most 400 documents', async () => {
            const { transactions } = useResetCollections({ users: 1201 });

            await resetDatabase();

            const userDeletes = transactions
                .filter((record) => record.collection === 'users')
                .map((record) => record.deletes);
            expect(userDeletes).toEqual([400, 400, 400, 1, 0]);
            transactions.forEach((record) => {
                expect(record.limit).toBeLessThanOrEqual(400);
                expect(record.deletes).toBeLessThanOrEqual(400);
            });
        });

        test('awaits the afterBegin hook before deleting', async () => {
            const { transactions } = useResetCollections({});
            let transactionsAtHook = null;

            await resetDatabase({
                afterBegin: async () => {
                    transactionsAtHook = transactions.length;
                }
            });

            expect(transactionsAtHook).toBe(0);
        });

        test('on a delete error the reset is not completed and the error propagates', async () => {
            useResetCollections({ messages: 3 }, { failDeleteIn: 'messages' });

            await expect(resetDatabase()).rejects.toThrow('delete failed');
            expect(completeReset).not.toHaveBeenCalled();
        });

        test('a superseded reset stops without completing', async () => {
            useResetCollections({ users: 2 });
            assertResetOwner.mockRejectedValueOnce(new AdmissionError('RESET_SUPERSEDED'));

            await expect(resetDatabase()).rejects.toMatchObject({ code: 'RESET_SUPERSEDED' });
            expect(completeReset).not.toHaveBeenCalled();
        });
    });

    describe('resetAndReseedParticipants', () => {
        test('reseeds with the reset id between delete and complete, awaiting hooks in order', async () => {
            useResetCollections({});
            const calls = [];
            ensureParticipantProfiles.mockImplementation(async () => {
                calls.push('reseed');
                return { created: 2, linked: 0, existing: 0 };
            });
            completeReset.mockImplementation(async () => {
                calls.push('complete');
            });
            const participants = [{ name: 'A', email: 'a@example.test' }];

            await resetAndReseedParticipants(participants, {
                afterBegin: async () => { calls.push('afterBegin'); },
                afterDelete: async () => { calls.push('afterDelete'); },
                afterReseed: async () => { calls.push('afterReseed'); },
            });

            expect(ensureParticipantProfiles).toHaveBeenCalledWith(participants, { resetId: 'reset-1' });
            expect(calls).toEqual(['afterBegin', 'afterDelete', 'reseed', 'afterReseed', 'complete']);
        });

        test('a reseed failure leaves the reset incomplete', async () => {
            useResetCollections({});
            ensureParticipantProfiles.mockRejectedValue(new AdmissionError('PROFILE_CONFLICT'));

            await expect(resetAndReseedParticipants([])).rejects.toMatchObject({ code: 'PROFILE_CONFLICT' });
            expect(completeReset).not.toHaveBeenCalled();
        });
    });

    describe('assignUsersInTransaction', () => {
        function useAssignTransaction(users) {
            const usersCollection = {
                __name: 'users',
                doc: jest.fn((id) => ({ id })),
            };
            mockFirestore.collection.mockImplementation(() => usersCollection);
            const tx = {
                get: jest.fn(async () => ({
                    docs: users.map((user) => ({ id: user.id, data: () => user }))
                })),
                update: jest.fn(),
            };
            mockFirestore.runTransaction.mockImplementation(async (fn) => fn(tx));
            return { tx, usersCollection };
        }

        test('reads users inside the transaction and writes the built pairs', async () => {
            const users = [{ id: 'u1' }, { id: 'u2' }];
            const { tx, usersCollection } = useAssignTransaction(users);
            const buildUpdates = jest.fn(() => ([
                { id: 'u1', recipientId: 'u2', gifterId: 'u2' },
                { id: 'u2', recipientId: 'u1', gifterId: 'u1' },
            ]));

            const result = await assignUsersInTransaction(buildUpdates);

            expect(assertLifecycleActive).toHaveBeenCalledWith(tx);
            expect(tx.get).toHaveBeenCalledWith(usersCollection);
            expect(buildUpdates).toHaveBeenCalledWith([
                expect.objectContaining({ id: 'u1' }),
                expect.objectContaining({ id: 'u2' }),
            ]);
            expect(tx.update).toHaveBeenCalledTimes(2);
            expect(tx.update).toHaveBeenCalledWith({ id: 'u1' }, { recipientId: 'u2', gifterId: 'u2' });
            expect(result).toEqual({ usersFound: 2, updated: 2 });
        });

        test('rejects when the lifecycle is not active and writes nothing', async () => {
            const { tx } = useAssignTransaction([{ id: 'u1' }, { id: 'u2' }]);
            assertLifecycleActive.mockRejectedValue(new AdmissionError('RESET_IN_PROGRESS'));
            const buildUpdates = jest.fn();

            await expect(assignUsersInTransaction(buildUpdates)).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS' });
            expect(buildUpdates).not.toHaveBeenCalled();
            expect(tx.update).not.toHaveBeenCalled();
        });

        test('writes nothing when buildUpdates returns null', async () => {
            const { tx } = useAssignTransaction([{ id: 'u1' }]);

            const result = await assignUsersInTransaction(() => null);

            expect(tx.update).not.toHaveBeenCalled();
            expect(result).toEqual({ usersFound: 1, updated: 0 });
        });
    });
});
