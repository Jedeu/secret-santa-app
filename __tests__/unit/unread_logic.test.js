/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRealtimeUnreadCounts, updateLastReadTimestamp } from '../../src/hooks/useRealtimeMessages';
import { RealtimeMessagesProvider } from '../../src/context/RealtimeMessagesContext';
import { firestore } from '../../src/lib/firebase-client';
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

// Mock lastReadClient
jest.mock('../../src/lib/lastReadClient', () => ({
    updateLastReadTimestamp: jest.fn(),
    getLastReadTimestamp: jest.fn(() => Promise.resolve(new Date(0).toISOString())),
    getCachedTimestamp: jest.fn(() => new Date(0).toISOString()),
    subscribeToLastRead: jest.fn(() => () => { })
}));

import { updateLastReadTimestamp as mockUpdateLastRead, getLastReadTimestamp as mockGetLastRead } from '../../src/lib/lastReadClient';

describe('Unread Count Optimization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const wrapper = ({ children }) => (
        <RealtimeMessagesProvider>{children}</RealtimeMessagesProvider>
    );

    it('should update lastRead timestamp without triggering full listener recreation', () => {
        // This verify that updating lastRead calls the client utility
        updateLastReadTimestamp('user1', 'user2');
        expect(mockUpdateLastRead).toHaveBeenCalled();
    });

    it('should not recreate listeners when lastRead changes', async () => {
        const unsubscribeMock = jest.fn();
        onSnapshot.mockReturnValue(unsubscribeMock);

        const { unmount } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1'),
            { wrapper }
        );

        // Wait for primeCache to settle
        await waitFor(() => {
            expect(mockGetLastRead).toHaveBeenCalled();
        });

        // Initial subscription count (1 for allMessages from provider)
        // Note: usage of useRealtimeUnreadCounts doesn't create NEW listeners anymore!
        // It uses the Context's allMessages listener.
        // So strict listener count check on the Hook is irrelevant if the Hook doesn't create listeners.
        // But the Provider creates ONE.
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        const initialCallCount = onSnapshot.mock.calls.length;

        // Simulate user marking messages as read
        act(() => {
            updateLastReadTimestamp('user1', 'recipient1');
        });

        // Listeners should NOT be recreated
        expect(onSnapshot.mock.calls.length).toBe(initialCallCount);
        expect(unsubscribeMock).not.toHaveBeenCalled();

        unmount();
    });

    it('should derive unread counts from context messages', async () => {
        // This relies on the Provider's allMessages state.
        // Since we mock onSnapshot, we need to simulate the callback to populate state.

        let snapshotCallback;
        onSnapshot.mockImplementation((query, options, cb) => {
            snapshotCallback = cb; // Capture callback
            return jest.fn();
        });

        const { result } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1'),
            { wrapper }
        );

        // Wait for primeCache to settle
        await waitFor(() => {
            expect(mockGetLastRead).toHaveBeenCalled();
        });

        // Initially 0
        expect(result.current.recipientUnread).toBe(0);

        // Inject messages via the captured Provider listener callback
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

        // Now should have 2 unread
        expect(result.current.recipientUnread).toBe(2);
    });
});
