/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRealtimeUnreadCounts, updateLastReadTimestamp } from '../../src/hooks/useRealtimeMessages';
import { RealtimeMessagesProvider } from '../../src/context/RealtimeMessagesContext';
import { onSnapshot } from 'firebase/firestore';

// Mock dependencies
jest.mock('../../src/lib/firebase-client', () => ({
    firestore: {}
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    onSnapshot: jest.fn(),
    orderBy: jest.fn()
}));

jest.mock('../../src/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

// Mock useUser
jest.mock('../../src/hooks/useUser', () => ({
    useUser: jest.fn(() => ({
        user: { id: 'user1', name: 'Test User' },
        loading: false
    }))
}));

// Mock lastReadClient (accepts every valid update)
jest.mock('../../src/lib/lastReadClient', () => ({
    updateLastReadTimestamp: jest.fn((userId, conversationId, observedAt) => Boolean(userId && conversationId && observedAt)),
    getLastReadTimestamp: jest.fn(() => Promise.resolve(new Date(0).toISOString())),
    getCachedTimestamp: jest.fn(() => new Date(0).toISOString()),
    subscribeToLastRead: jest.fn(() => () => { }),
    flushPendingWrites: jest.fn(() => Promise.resolve()),
    resetLastReadState: jest.fn(),
}));

import {
    updateLastReadTimestamp as mockUpdateLastRead,
    subscribeToLastRead as mockSubscribeToLastRead,
} from '../../src/lib/lastReadClient';

describe('Unread Count Optimization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const wrapper = ({ children }) => (
        <RealtimeMessagesProvider>{children}</RealtimeMessagesProvider>
    );

    it('should update lastRead timestamp through the client utility and report acceptance', () => {
        expect(updateLastReadTimestamp('user1', 'user2', null, '2026-01-01T00:00:00.000Z')).toBe(true);
        expect(mockUpdateLastRead).toHaveBeenCalledWith('user1', 'user1_user2', '2026-01-01T00:00:00.000Z');
    });

    it('should not recreate listeners when lastRead changes', async () => {
        const unsubscribeMock = jest.fn();
        onSnapshot.mockReturnValue(unsubscribeMock);

        const { unmount } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1'),
            { wrapper }
        );

        await waitFor(() => {
            expect(mockSubscribeToLastRead).toHaveBeenCalled();
        });

        // Provider creates two listeners (messages + reactions).
        // Own-marker subscriptions go through lastReadClient, not this onSnapshot.
        expect(onSnapshot).toHaveBeenCalledTimes(2);
        const initialCallCount = onSnapshot.mock.calls.length;

        act(() => {
            updateLastReadTimestamp('user1', 'recipient1', null, '2026-01-01T00:00:00.000Z');
        });

        expect(onSnapshot.mock.calls.length).toBe(initialCallCount);
        expect(unsubscribeMock).not.toHaveBeenCalled();

        unmount();
    });

    it('should derive unread counts from context messages (legacy rows routed by assignment)', async () => {
        let snapshotCallback;
        onSnapshot.mockImplementation((query, options, cb) => {
            if (!snapshotCallback) {
                snapshotCallback = cb; // First listener is messages
            }
            return jest.fn();
        });

        const { result } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1'),
            { wrapper }
        );

        await waitFor(() => {
            expect(mockSubscribeToLastRead).toHaveBeenCalled();
        });

        expect(result.current.recipientUnread).toBe(0);

        act(() => {
            if (snapshotCallback) {
                const mockMessages = [
                    { id: '1', fromId: 'recipient1', toId: 'user1', timestamp: new Date().toISOString() },
                    { id: '2', fromId: 'recipient1', toId: 'user1', timestamp: new Date().toISOString() }
                ];

                snapshotCallback({
                    forEach: (fn) => mockMessages.forEach(msg => fn({ data: () => msg })),
                    size: 2,
                    metadata: { fromCache: false },
                    docChanges: () => []
                });
            }
        });

        expect(result.current.recipientUnread).toBe(2);
        expect(result.current.santaUnread).toBe(0);
    });
});
