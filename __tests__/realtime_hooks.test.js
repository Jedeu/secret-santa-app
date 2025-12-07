/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useRealtimeAllMessages, useRealtimeUnreadCounts } from '@/hooks/useRealtimeMessages';
import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';
import { useUser } from '@/hooks/useUser';

// Mock fetch for unread counts (still uses API polling)
global.fetch = jest.fn();

// Mock Firebase Firestore SDK
const mockOnSnapshot = jest.fn();
const mockQuery = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();

jest.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    query: (...args) => mockQuery(...args),
    where: (...args) => mockWhere(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    orderBy: (...args) => mockOrderBy(...args),
}));

// Mock firebase-client - now provides a firestore instance
jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true }
}));

// Mock useUser hook
jest.mock('@/hooks/useUser', () => ({
    useUser: jest.fn()
}));

// Mock the listener tracker to avoid console noise
jest.mock('@/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

/**
 * Helper to extract the callback from onSnapshot calls
 */
function extractSnapshotCallback(callArgs) {
    if (typeof callArgs[1] === 'object' && typeof callArgs[2] === 'function') {
        return { callback: callArgs[2], errorCallback: callArgs[3] };
    }
    if (typeof callArgs[1] === 'function') {
        return { callback: callArgs[1], errorCallback: callArgs[2] };
    }
    return { callback: null, errorCallback: null };
}

// Mock lastReadClient for cache priming tests
const mockFetchLastRead = jest.fn();
const mockGetCachedTimestamp = jest.fn();
jest.mock('@/lib/lastReadClient', () => ({
    getLastReadTimestamp: (...args) => mockFetchLastRead(...args),
    getCachedTimestamp: (...args) => mockGetCachedTimestamp(...args),
}));


describe('Realtime Hooks with Context', () => {
    let mockUser = { id: 'user1', name: 'Test User' };

    beforeEach(() => {
        jest.clearAllMocks();
        fetch.mockClear();
        mockFetchLastRead.mockClear();
        mockGetCachedTimestamp.mockClear();

        // Default mock for fetchLastRead - returns epoch
        mockFetchLastRead.mockResolvedValue(new Date(0).toISOString());
        // Default mock for getCachedTimestamp - returns undefined (no cache)
        mockGetCachedTimestamp.mockReturnValue(undefined);


        // Setup default mock implementations
        mockCollection.mockReturnValue('mockCollection');
        mockWhere.mockReturnValue('mockWhere');
        mockOrderBy.mockReturnValue('mockOrderBy');
        mockQuery.mockReturnValue('mockQuery');
        mockOnSnapshot.mockReturnValue(jest.fn()); // Unsubscribe mock

        // Default useUser to return authenticated user
        useUser.mockReturnValue({
            user: mockUser,
            loading: false,
            error: null
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // Wrapper component to provide Context
    const wrapper = ({ children }) => (
        <RealtimeMessagesProvider>
            {children}
        </RealtimeMessagesProvider>
    );

    describe('useRealtimeAllMessages', () => {
        test('should return messages from Context', async () => {
            const mockMessages = [
                { id: '1', fromId: 'user1', toId: 'user2', content: 'Hello', timestamp: '2025-11-20T10:00:00Z' }
            ];

            let snapshotCallback;
            mockOnSnapshot.mockImplementation((...args) => {
                const { callback } = extractSnapshotCallback(args);
                snapshotCallback = callback;
                return jest.fn();
            });

            const { result } = renderHook(() => useRealtimeAllMessages(), { wrapper });

            await waitFor(() => {
                expect(mockOnSnapshot).toHaveBeenCalled();
            });

            // Simulate update
            await act(async () => {
                snapshotCallback({
                    forEach: (cb) => mockMessages.forEach(msg => cb({ data: () => msg })),
                    size: mockMessages.length,
                    metadata: { fromCache: false },
                    docChanges: () => mockMessages.map(() => ({}))
                });
            });

            await waitFor(() => {
                expect(result.current).toEqual(mockMessages);
            });
        });
    });

    describe('useRealtimeUnreadCounts', () => {
        test('should filter unread counts correctly client-side', async () => {
            const userId = 'user1';
            const recipientId = 'user2';
            const gifterId = 'user3'; // Santa

            // Mock messages:
            // 1. From recipient (new)
            // 2. From Santa (new)
            // 3. From someone else (ignored)
            // 4. From recipient (old - read)
            const now = new Date();
            const past = new Date(now.getTime() - 10000);
            const future = new Date(now.getTime() + 10000);

            const mockMessages = [
                { id: '1', fromId: recipientId, toId: userId, timestamp: future.toISOString(), conversationId: `santa_${userId}_recipient_${recipientId}` },
                { id: '2', fromId: gifterId, toId: userId, timestamp: future.toISOString(), conversationId: `santa_${gifterId}_recipient_${userId}` },
                { id: '3', fromId: 'other', toId: userId, timestamp: future.toISOString() },
                { id: '4', fromId: recipientId, toId: userId, timestamp: new Date(0).toISOString(), conversationId: `santa_${userId}_recipient_${recipientId}` }
            ];

            // [FIX] Mock getCachedTimestamp to return epoch (valid cache value, not undefined)
            // This simulates the cache being primed with a "no previous reads" state.
            mockGetCachedTimestamp.mockReturnValue(new Date(0).toISOString());

            // Mock query to return distinct identifiers
            mockCollection.mockReturnValue({ path: 'messages' });
            mockQuery.mockImplementation((collectionRef, ...constraints) => {
                // Constraints are mocked as 'mockWhere', 'mockOrderBy' strings in defaults
                // We need more info.
                // Let's rely on the number of arguments or types?
                // Provider query: collection, orderBy -> 2 args
                // Recipient/Santa query: collection, where, where -> 3 args

                return {
                    type: 'query',
                    constraintsCount: constraints.length,
                    constraints
                };
            });

            mockWhere.mockImplementation((field, op, value) => ({ type: 'where', field, value }));
            mockOrderBy.mockImplementation((field, dir) => ({ type: 'orderBy', field, dir }));


            // Capture callbacks for different listeners
            let allMessagesCallback;
            let recipientCallback;
            let santaCallback;

            mockOnSnapshot.mockImplementation((queryObj, ...args) => {
                const { callback } = extractSnapshotCallback([queryObj, ...args]);

                // Identify based on query structure (mocked above)
                if (queryObj && queryObj.constraints && queryObj.constraints.some(c => c.type === 'orderBy')) {
                    // This is the provider's 'allMessages' listener (has orderBy)
                    allMessagesCallback = callback;
                } else if (queryObj && queryObj.constraints && queryObj.constraints.some(c => c.type === 'where' && c.value === recipientId)) {
                    // Recipient listener
                    recipientCallback = callback;
                } else if (queryObj && queryObj.constraints && queryObj.constraints.some(c => c.type === 'where' && c.value === gifterId)) {
                    // Santa listener
                    santaCallback = callback;
                }

                return jest.fn();
            });

            const { result } = renderHook(() => useRealtimeUnreadCounts(userId, recipientId, gifterId), { wrapper });

            // Trigger ALL MESSAGES (Provider)
            await act(async () => {
                if (allMessagesCallback) {
                    allMessagesCallback({
                        forEach: (cb) => mockMessages.forEach(msg => cb({ data: () => msg })),
                        size: mockMessages.length,
                        metadata: { fromCache: false },
                        docChanges: () => mockMessages.map(() => ({}))
                    });
                }
            });

            // Trigger RECIPIENT listener (to update recipientMessagesRef - although logic actually uses allMessages for recipient!)
            // Wait, previous logic for recipient used allMessages? 
            // Let's check implementation:
            // Recipient count uses `allMessages` filter.
            // Santa count uses `santaMessagesRef` (from its own listener).

            // So we need to trigger santaCallback to update santaMessagesRef.
            // And we need to trigger allMessagesCallback to update allMessages for recipient count.

            // Trigger SANTA listener
            await act(async () => {
                const santaDocs = mockMessages.filter(m => m.fromId === gifterId);
                if (santaCallback) {
                    santaCallback({
                        forEach: (cb) => santaDocs.forEach(msg => cb({ data: () => msg })),
                        size: santaDocs.length,
                        metadata: { fromCache: false },
                        docChanges: () => santaDocs.map(() => ({}))
                    });
                }
            });

            // Wait for internal state update
            await waitFor(() => {
                // Should see 1 unread from recipient and 1 from santa
                expect(result.current.recipientUnread).toBe(1);
                expect(result.current.santaUnread).toBe(1);
            });
        });

        test('should fetch initial lastRead timestamps on mount', async () => {
            const userId = 'user1';
            const recipientId = 'user2';
            const gifterId = 'user3';

            // Expected conversation IDs (based on getConversationId logic)
            // santa_[santaId]_recipient_[recipientId] where sender is santa
            const expectedRecipientConvId = `santa_${userId}_recipient_${recipientId}`;
            const expectedSantaConvId = `santa_${gifterId}_recipient_${userId}`;

            // Configure mock to return specific timestamps
            const recipientLastRead = new Date('2025-01-01T12:00:00Z').toISOString();
            const santaLastRead = new Date('2025-01-01T13:00:00Z').toISOString();

            mockFetchLastRead.mockImplementation((uid, convId) => {
                if (convId === expectedRecipientConvId) return Promise.resolve(recipientLastRead);
                if (convId === expectedSantaConvId) return Promise.resolve(santaLastRead);
                return Promise.resolve(new Date(0).toISOString());
            });

            // Setup basic query mocks
            mockCollection.mockReturnValue({ path: 'messages' });
            mockQuery.mockReturnValue({ type: 'query', constraints: [{ type: 'orderBy' }] });
            mockOnSnapshot.mockImplementation((...args) => {
                const { callback } = extractSnapshotCallback(args);
                // Immediately fire with empty messages
                if (callback) {
                    callback({
                        forEach: () => { },
                        size: 0,
                        metadata: { fromCache: false },
                        docChanges: () => []
                    });
                }
                return jest.fn();
            });

            const { result } = renderHook(() => useRealtimeUnreadCounts(userId, recipientId, gifterId), { wrapper });

            // Wait for the primeCache effect to complete
            await waitFor(() => {
                // fetchLastRead should be called for both conversations
                expect(mockFetchLastRead).toHaveBeenCalledWith(userId, expectedRecipientConvId);
                expect(mockFetchLastRead).toHaveBeenCalledWith(userId, expectedSantaConvId);
            });

            // Verify it was called exactly twice (once per conversation)
            expect(mockFetchLastRead).toHaveBeenCalledTimes(2);
        });
    });
});
