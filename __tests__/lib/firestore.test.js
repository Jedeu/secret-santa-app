import { assignUsersInTransaction, ensureAllParticipants } from '@/lib/firestore';
import * as firestoreModule from '@/lib/firestore';
import {
    assertYearOpen,
    ensureParticipantProfiles,
    AdmissionError,
} from '@/lib/participant-admission';

// Mock Firebase Admin SDK
jest.mock('@/lib/firebase', () => ({
    firestore: {
        collection: jest.fn(),
        runTransaction: jest.fn(),
    }
}));

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        assertYearOpen: jest.fn(),
        ensureParticipantProfiles: jest.fn(),
    };
});

// Get reference to the mocked firestore for test setup
import { firestore as mockFirestore } from '@/lib/firebase';

describe('Firestore server helpers (unit tests with mocks)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        assertYearOpen.mockResolvedValue({ epoch: 1, year: 2025 });
        ensureParticipantProfiles.mockResolvedValue({ year: 2025, created: 0, linked: 0, existing: 0 });
    });

    test('only the two server helpers are exported (no reset or user helpers)', () => {
        expect(Object.keys(firestoreModule).sort()).toEqual(['assignUsersInTransaction', 'ensureAllParticipants']);
    });

    describe('ensureAllParticipants', () => {
        test('seeds the active year through ensureParticipantProfiles with no arguments', async () => {
            const result = await ensureAllParticipants();

            expect(ensureParticipantProfiles).toHaveBeenCalledTimes(1);
            expect(ensureParticipantProfiles).toHaveBeenCalledWith();
            expect(result).toEqual({ year: 2025, created: 0, linked: 0, existing: 0 });
        });

        test('propagates YEAR_CLOSED', async () => {
            ensureParticipantProfiles.mockRejectedValue(new AdmissionError('YEAR_CLOSED'));

            await expect(ensureAllParticipants()).rejects.toMatchObject({ code: 'YEAR_CLOSED' });
        });
    });

    describe('assignUsersInTransaction', () => {
        function useAssignTransaction(users) {
            const collections = {};
            mockFirestore.collection.mockImplementation((name) => {
                if (!collections[name]) {
                    collections[name] = { __name: name, doc: jest.fn((id) => ({ id, collection: name })) };
                }
                return collections[name];
            });
            const tx = {
                get: jest.fn(async () => ({
                    docs: users.map((user) => ({ id: user.id, data: () => user }))
                })),
                update: jest.fn(),
            };
            mockFirestore.runTransaction.mockImplementation(async (fn) => fn(tx));
            return { tx, collections };
        }

        test('reads the open year users inside the transaction and writes the built pairs', async () => {
            const users = [{ id: 'u1' }, { id: 'u2' }];
            const { tx, collections } = useAssignTransaction(users);
            const buildUpdates = jest.fn(() => ([
                { id: 'u1', recipientId: 'u2', gifterId: 'u2' },
                { id: 'u2', recipientId: 'u1', gifterId: 'u1' },
            ]));

            const result = await assignUsersInTransaction(buildUpdates);

            expect(assertYearOpen).toHaveBeenCalledWith(tx);
            expect(mockFirestore.collection).toHaveBeenCalledWith('users');
            expect(tx.get).toHaveBeenCalledWith(collections.users);
            expect(buildUpdates).toHaveBeenCalledWith([
                expect.objectContaining({ id: 'u1' }),
                expect.objectContaining({ id: 'u2' }),
            ]);
            expect(tx.update).toHaveBeenCalledTimes(2);
            expect(tx.update).toHaveBeenCalledWith({ id: 'u1', collection: 'users' }, { recipientId: 'u2', gifterId: 'u2' });
            expect(result).toEqual({ usersFound: 2, updated: 2 });
        });

        test('in 2026 the pairs are written under years/2026/users', async () => {
            assertYearOpen.mockResolvedValue({ epoch: 2, year: 2026 });
            const { tx } = useAssignTransaction([{ id: 'u1' }, { id: 'u2' }]);

            await assignUsersInTransaction(() => ([
                { id: 'u1', recipientId: 'u2', gifterId: 'u2' },
                { id: 'u2', recipientId: 'u1', gifterId: 'u1' },
            ]));

            expect(mockFirestore.collection).toHaveBeenCalledWith('years/2026/users');
            expect(mockFirestore.collection).not.toHaveBeenCalledWith('users');
            expect(tx.update).toHaveBeenCalledWith({ id: 'u1', collection: 'years/2026/users' }, { recipientId: 'u2', gifterId: 'u2' });
        });

        test.each(['YEAR_CLOSED', 'SERVICE_UNAVAILABLE'])('rejects with %s and writes nothing', async (code) => {
            const { tx } = useAssignTransaction([{ id: 'u1' }, { id: 'u2' }]);
            assertYearOpen.mockRejectedValue(new AdmissionError(code));
            const buildUpdates = jest.fn();

            await expect(assignUsersInTransaction(buildUpdates)).rejects.toMatchObject({ code });
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
