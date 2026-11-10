/**
 * @jest-environment jsdom
 */

const mockDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockOnSnapshot = jest.fn();
const mockFromDate = jest.fn((date) => ({ __type: 'Timestamp', __iso: date.toISOString() }));

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    getDoc: (...args) => mockGetDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    Timestamp: { fromDate: (...args) => mockFromDate(...args) },
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
    clientAuth: { currentUser: { uid: 'uid-1' } },
}));

import {
    getCachedTimestamp,
    getLastReadTimestamp,
    resetLastReadState,
    subscribeToLastRead,
    updateLastReadTimestamp,
} from '@/lib/lastReadClient';

describe('lastReadClient normalization boundary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        resetLastReadState();
        mockDoc.mockReturnValue('lastReadDocRef');
        mockSetDoc.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('normalizes Firestore Timestamp to ISO when fetching', async () => {
        const expectedIso = '2026-02-12T18:00:00.000Z';
        const timestampValue = {
            toDate: () => new Date(expectedIso),
        };

        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ lastReadAt: timestampValue }),
        });

        const result = await getLastReadTimestamp('user1', 'conv1');
        expect(result).toBe(expectedIso);
        expect(getCachedTimestamp('user1', 'conv1')).toBe(expectedIso);
    });

    test('preserves legacy ISO string values when fetching', async () => {
        const expectedIso = '2026-02-12T18:30:00.000Z';

        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ lastReadAt: expectedIso }),
        });

        const result = await getLastReadTimestamp('user1', 'conv2');
        expect(result).toBe(expectedIso);
        expect(getCachedTimestamp('user1', 'conv2')).toBe(expectedIso);
    });

    test('subscribeToLastRead keeps the cached value when the remote value is temporarily null', async () => {
        const seed = '2026-02-12T19:00:00.000Z';
        mockGetDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ lastReadAt: seed }),
        });
        await getLastReadTimestamp('user1', 'conv3');

        let snapshotCallback;
        mockOnSnapshot.mockImplementation((_docRef, onNext) => {
            snapshotCallback = onNext;
            return jest.fn();
        });

        const onValue = jest.fn();
        subscribeToLastRead('user1', 'conv3', onValue);

        snapshotCallback({
            exists: () => true,
            data: () => ({ lastReadAt: null }),
        });

        expect(onValue).toHaveBeenCalledWith(seed);
        expect(getCachedTimestamp('user1', 'conv3')).toBe(seed);
    });

    test('updateLastReadTimestamp writes a Timestamp of exactly the observed message time', async () => {
        const observedAt = '2026-02-12T20:15:30.123Z';
        expect(updateLastReadTimestamp('user1', 'conv4', observedAt)).toBe(true);

        expect(getCachedTimestamp('user1', 'conv4')).toBe(observedAt);
        expect(mockSetDoc).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2000);

        expect(mockFromDate).toHaveBeenCalledWith(new Date(observedAt));
        expect(mockSetDoc).toHaveBeenCalledWith('lastReadDocRef', {
            userId: 'user1',
            conversationId: 'conv4',
            lastReadAt: { __type: 'Timestamp', __iso: observedAt },
        });
    });
});
