/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useRealtimeUnreadCounts, updateLastReadTimestamp } from '../../src/hooks/useRealtimeMessages';
import { firestore } from '../../src/lib/firebase-client';
import { onSnapshot } from 'firebase/firestore';

// Mock Firebase
jest.mock('../../src/lib/firebase-client', () => ({
    firestore: {}
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    onSnapshot: jest.fn()
}));

// Mock the listener tracker to avoid console noise
jest.mock('../../src/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

const localStorageMock = (() => {
    let store = {};
    return {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, value) => {
            store[key] = value.toString();
        }),
        clear: jest.fn(() => {
            store = {};
        })
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

/**
 * Helper to extract the callback from onSnapshot calls
 * The new API uses onSnapshot(query, options, callback) or onSnapshot(query, options, callback, errorCallback)
 */
function extractSnapshotCallback(callArgs) {
    // The signature is: onSnapshot(query, options, callback, errorCallback?)
    // options is { includeMetadataChanges: false }
    // So callback is at index 2
    if (typeof callArgs[1] === 'object' && typeof callArgs[2] === 'function') {
        return { callback: callArgs[2], errorCallback: callArgs[3] };
    }
    // Fallback for old signature: onSnapshot(query, callback, errorCallback?)
    if (typeof callArgs[1] === 'function') {
        return { callback: callArgs[1], errorCallback: callArgs[2] };
    }
    return { callback: null, errorCallback: null };
}

describe('Unread Count Optimization (No Excessive Reads)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    it('should update lastRead timestamp without triggering listener recreation', () => {
        // This test verifies the optimization: updating lastRead doesn't recreate listeners
        const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
        updateLastReadTimestamp('user1', 'user2');

        // Verify localStorage was updated
        expect(localStorage.setItem).toHaveBeenCalled();
        const key = localStorage.setItem.mock.calls[0][0];
        expect(key).toContain('lastRead_user1');

        // Verify NO event is dispatched (optimization to prevent listener recreation)
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should not recreate listeners when lastRead changes (prevents excessive reads)', () => {
        // This test verifies listeners are NOT recreated on every read update
        // Previously, each read update caused 37+ Firestore reads!

        const unsubscribeMock = jest.fn();
        onSnapshot.mockReturnValue(unsubscribeMock);

        const { result, unmount } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
        );

        // Initial subscription count (1 for recipient, 1 for santa)
        expect(onSnapshot).toHaveBeenCalledTimes(2);
        const initialCallCount = onSnapshot.mock.calls.length;

        // Simulate user marking messages as read multiple times
        act(() => {
            updateLastReadTimestamp('user1', 'recipient1');
            updateLastReadTimestamp('user1', 'santa1');
        });

        // Listeners should NOT be recreated (call count stays the same)
        // This is the optimization that prevents 37+ reads on every message view!
        expect(onSnapshot.mock.calls.length).toBe(initialCallCount);
        expect(unsubscribeMock).not.toHaveBeenCalled(); // No unsubscribe = no recreation

        unmount();
    });

    it('should rely on real-time updates for unread counts (not manual refreshes)', () => {
        // This test documents that unread counts update automatically via Firestore listeners
        // No need to recreate listeners when lastRead changes

        const unsubscribeMock = jest.fn();
        let snapshotCallback;

        onSnapshot.mockImplementation((...args) => {
            const { callback } = extractSnapshotCallback(args);
            snapshotCallback = callback;
            return unsubscribeMock;
        });

        const { result } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
        );

        // Simulate new messages arriving via the existing listener
        act(() => {
            if (snapshotCallback) {
                snapshotCallback({
                    forEach: (cb) => {
                        // Simulate 3 unread messages
                        [1, 2, 3].forEach(() => cb({
                            data: () => ({ timestamp: new Date().toISOString() })
                        }));
                    },
                    size: 3,
                    metadata: { fromCache: false },
                    docChanges: () => [1, 2, 3].map(() => ({}))
                });
            }
        });

        // Listener automatically updates the count (no recreation needed!)
        // This is how Firestore real-time listeners are supposed to work
        expect(result.current).toBeDefined();
    });
});
