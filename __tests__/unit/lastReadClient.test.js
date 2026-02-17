/**
 * @jest-environment jsdom
 *
 * Tests for the lastReadClient module.
 * Verifies the debouncing and caching behavior.
 */

// Mock Firebase Firestore
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockDoc = jest.fn();
const mockOnSnapshot = jest.fn();
const mockServerTimestamp = jest.fn(() => ({ __type: 'serverTimestamp' }));

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    getDoc: (...args) => mockGetDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    serverTimestamp: (...args) => mockServerTimestamp(...args),
}));

// Mock firebase-client
jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true }
}));

// Import after mocks
import {
    getLastReadTimestamp,
    updateLastReadTimestamp,
    getCachedTimestamp,
    clearCache
} from '@/lib/lastReadClient';

describe('lastReadClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        clearCache();

        mockDoc.mockReturnValue('mockDocRef');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('getLastReadTimestamp', () => {
        test('should return epoch timestamp when userId is missing', async () => {
            const result = await getLastReadTimestamp(null, 'conv1');
            expect(result).toBe(new Date(0).toISOString());
        });

        test('should return epoch timestamp when conversationId is missing', async () => {
            const result = await getLastReadTimestamp('user1', null);
            expect(result).toBe(new Date(0).toISOString());
        });

        test('should return cached value if available', async () => {
            // First, we need to cache a value
            // Since clearCache was called, the cache is empty
            // We'll simulate by calling getDoc once first
            const mockTimestamp = '2025-11-20T10:00:00Z';
            mockGetDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => ({ lastReadAt: mockTimestamp })
            });

            // First call fetches from Firestore
            const result1 = await getLastReadTimestamp('user1', 'conv1');
            expect(result1).toBe(mockTimestamp);
            expect(mockGetDoc).toHaveBeenCalledTimes(1);

            // Second call should use cache (no additional Firestore call)
            const result2 = await getLastReadTimestamp('user1', 'conv1');
            expect(result2).toBe(mockTimestamp);
            expect(mockGetDoc).toHaveBeenCalledTimes(1); // Still 1
        });

        test('should return epoch when document does not exist', async () => {
            mockGetDoc.mockResolvedValueOnce({
                exists: () => false
            });

            const result = await getLastReadTimestamp('user1', 'conv2');
            expect(result).toBe(new Date(0).toISOString());
        });
    });

    describe('updateLastReadTimestamp', () => {
        test('should not call Firestore if userId is missing', () => {
            updateLastReadTimestamp(null, 'conv1');
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        test('should not call Firestore if conversationId is missing', () => {
            updateLastReadTimestamp('user1', null);
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        test('should debounce writes (only write after delay)', async () => {
            mockSetDoc.mockResolvedValue();

            // Call update
            updateLastReadTimestamp('user1', 'conv1');

            // Immediately, setDoc should NOT have been called yet
            expect(mockSetDoc).not.toHaveBeenCalled();

            // Advance timers by 1 second (less than debounce)
            jest.advanceTimersByTime(1000);
            expect(mockSetDoc).not.toHaveBeenCalled();

            // Advance to 2 seconds (debounce delay)
            jest.advanceTimersByTime(1000);

            // Need to flush promises
            await Promise.resolve();

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });

        test('should only write once for rapid updates', async () => {
            mockSetDoc.mockResolvedValue();

            // Rapid updates
            updateLastReadTimestamp('user1', 'conv1');
            updateLastReadTimestamp('user1', 'conv1');
            updateLastReadTimestamp('user1', 'conv1');

            // Advance past debounce
            jest.advanceTimersByTime(2100);
            await Promise.resolve();

            // Should only write once
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });
    });

    describe('getCachedTimestamp', () => {
        test('should return undefined for uncached key', () => {
            const result = getCachedTimestamp('userX', 'convY');
            expect(result).toBeUndefined();
        });

        test('should return cached value after getLastReadTimestamp', async () => {
            const mockTimestamp = '2025-11-20T12:00:00Z';
            mockGetDoc.mockResolvedValueOnce({
                exists: () => true,
                data: () => ({ lastReadAt: mockTimestamp })
            });

            await getLastReadTimestamp('user1', 'conv3');

            const cached = getCachedTimestamp('user1', 'conv3');
            expect(cached).toBe(mockTimestamp);
        });
    });
});
