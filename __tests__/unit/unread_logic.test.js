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

describe('Unread Refresh Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    it('should dispatch unread-refresh event when updating last read timestamp', () => {
        const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
        updateLastReadTimestamp('user1', 'user2');

        expect(dispatchSpy).toHaveBeenCalledWith(expect.any(Event));
        expect(dispatchSpy.mock.calls[0][0].type).toBe('unread-refresh');
    });

    it('should re-subscribe when unread-refresh event is dispatched', () => {
        // Setup mock for onSnapshot
        const unsubscribeMock = jest.fn();
        onSnapshot.mockReturnValue(unsubscribeMock);

        const { result, unmount } = renderHook(() =>
            useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
        );

        // Initial subscription count (1 for recipient, 1 for santa)
        expect(onSnapshot).toHaveBeenCalledTimes(2);

        // Trigger refresh
        act(() => {
            window.dispatchEvent(new Event('unread-refresh'));
        });

        // Should have unsubscribed and re-subscribed
        // The exact number depends on how React handles the effect re-run, 
        // but we expect new calls to onSnapshot
        expect(onSnapshot.mock.calls.length).toBeGreaterThan(2);

        unmount();
    });
});
