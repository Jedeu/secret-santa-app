/**
 * @jest-environment jsdom
 */

const mockDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockOnSnapshot = jest.fn();
const mockServerTimestamp = jest.fn(() => ({ __type: 'serverTimestamp' }));

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    getDoc: (...args) => mockGetDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    serverTimestamp: (...args) => mockServerTimestamp(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
}));

import {
    clearCache,
    getCachedTimestamp,
    getLastReadTimestamp,
    subscribeToLastRead,
    updateLastReadTimestamp,
} from '@/lib/lastReadClient';

describe('lastReadClient normalization boundary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        clearCache();
        mockDoc.mockReturnValue('lastReadDocRef');
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

    test('subscribeToLastRead uses fallback cache value when serverTimestamp is temporarily null', () => {
        const seed = '2026-02-12T19:00:00.000Z';
        updateLastReadTimestamp('user1', 'conv3');
        // Override optimistic cache with deterministic seed value for this test.
        clearCache();
        // seed cache via getDoc path
        mockGetDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ lastReadAt: seed }),
        });

        return getLastReadTimestamp('user1', 'conv3').then(() => {
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
    });

    test('updateLastReadTimestamp writes serverTimestamp while keeping optimistic ISO cache', async () => {
        updateLastReadTimestamp('user1', 'conv4');

        const optimistic = getCachedTimestamp('user1', 'conv4');
        expect(typeof optimistic).toBe('string');
        expect(mockSetDoc).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(mockServerTimestamp).toHaveBeenCalled();
        expect(mockSetDoc).toHaveBeenCalledWith('lastReadDocRef', expect.objectContaining({
            userId: 'user1',
            conversationId: 'conv4',
            lastReadAt: { __type: 'serverTimestamp' },
        }));
    });
});
