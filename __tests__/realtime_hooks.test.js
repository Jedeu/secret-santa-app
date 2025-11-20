/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useRealtimeMessages, useRealtimeAllMessages, useRealtimeUnreadCounts } from '@/hooks/useRealtimeMessages';

// Mock fetch
global.fetch = jest.fn();

// Mock firebase-client before importing hooks
jest.mock('@/lib/firebase-client', () => ({
    firestore: null, // Simulate no Firestore (local dev mode)
    useClientFirestore: jest.fn(() => false)
}));

describe('useRealtimeMessages Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fetch.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should fetch messages on mount (polling fallback)', async () => {
        const mockMessages = [
            { id: '1', fromId: 'user1', toId: 'user2', content: 'Hello', timestamp: new Date().toISOString() },
            { id: '2', fromId: 'user2', toId: 'user1', content: 'Hi', timestamp: new Date().toISOString() }
        ];

        fetch.mockResolvedValue({
            ok: true,
            json: async () => mockMessages
        });

        const { result } = renderHook(() => useRealtimeMessages('user1', 'user2'));

        // Should start with empty array
        expect(result.current).toEqual([]);

        // Wait for fetch to complete
        await waitFor(() => {
            expect(result.current.length).toBe(2);
        });

        expect(fetch).toHaveBeenCalledWith('/api/messages?userId=user1');
        expect(result.current).toEqual(mockMessages);
    });

    test('should filter messages for specific conversation', async () => {
        const mockMessages = [
            { id: '1', fromId: 'user1', toId: 'user2', content: 'Hello', timestamp: new Date().toISOString() },
            { id: '2', fromId: 'user2', toId: 'user1', content: 'Hi', timestamp: new Date().toISOString() },
            { id: '3', fromId: 'user1', toId: 'user3', content: 'Hey user3', timestamp: new Date().toISOString() }
        ];

        fetch.mockResolvedValue({
            ok: true,
            json: async () => mockMessages
        });

        const { result } = renderHook(() => useRealtimeMessages('user1', 'user2'));

        await waitFor(() => {
            expect(result.current.length).toBe(2);
        });

        // Should only include messages between user1 and user2
        expect(result.current).toEqual([
            mockMessages[0],
            mockMessages[1]
        ]);
    });

    test('should poll messages at regular intervals', async () => {
        jest.useFakeTimers();

        fetch.mockResolvedValue({
            ok: true,
            json: async () => []
        });

        const { unmount } = renderHook(() => useRealtimeMessages('user1', 'user2'));

        // Initial fetch
        await waitFor(() => {
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        // Fast-forward 2 seconds (polling interval)
        jest.advanceTimersByTime(2000);

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        // Fast-forward another 2 seconds
        jest.advanceTimersByTime(2000);

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledTimes(3);
        });

        unmount();
        jest.useRealTimers();
    });

    test('should cleanup interval on unmount', async () => {
        jest.useFakeTimers();

        fetch.mockResolvedValue({
            ok: true,
            json: async () => []
        });

        const { unmount } = renderHook(() => useRealtimeMessages('user1', 'user2'));

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        // Unmount the hook
        unmount();

        // Fast-forward time - should not trigger more fetches
        jest.advanceTimersByTime(10000);

        expect(fetch).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    test('should handle fetch errors gracefully', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        fetch.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useRealtimeMessages('user1', 'user2'));

        await waitFor(() => {
            expect(fetch).toHaveBeenCalled();
        });

        // Should remain empty array on error
        expect(result.current).toEqual([]);
        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});

describe('useRealtimeAllMessages Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fetch.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should fetch all messages on mount', async () => {
        const mockMessages = [
            { id: '1', fromId: 'user1', toId: 'user2', content: 'Hello', timestamp: '2025-11-20T10:00:00Z' },
            { id: '2', fromId: 'user2', toId: 'user1', content: 'Hi', timestamp: '2025-11-20T10:01:00Z' }
        ];

        fetch.mockResolvedValue({
            ok: true,
            json: async () => mockMessages
        });

        const { result } = renderHook(() => useRealtimeAllMessages());

        await waitFor(() => {
            expect(result.current.length).toBe(2);
        });

        expect(fetch).toHaveBeenCalledWith('/api/messages');
        expect(result.current).toEqual(mockMessages);
    });

    test('should poll all messages at 3 second intervals', async () => {
        jest.useFakeTimers();

        fetch.mockResolvedValue({
            ok: true,
            json: async () => []
        });

        renderHook(() => useRealtimeAllMessages());

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        jest.advanceTimersByTime(3000);

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        jest.useRealTimers();
    });
});

describe('useRealtimeUnreadCounts Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fetch.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should fetch unread counts on mount', async () => {
        const mockUnreadData = {
            recipientUnread: 3,
            santaUnread: 1
        };

        fetch.mockResolvedValue({
            ok: true,
            json: async () => mockUnreadData
        });

        const { result } = renderHook(() => useRealtimeUnreadCounts('user1'));

        await waitFor(() => {
            expect(result.current.recipientUnread).toBe(3);
            expect(result.current.santaUnread).toBe(1);
        });

        expect(fetch).toHaveBeenCalledWith('/api/unread?userId=user1');
    });

    test('should return zero counts initially', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ recipientUnread: 5, santaUnread: 2 })
        });

        const { result } = renderHook(() => useRealtimeUnreadCounts('user1'));

        // Should start with zeros
        expect(result.current.recipientUnread).toBe(0);
        expect(result.current.santaUnread).toBe(0);

        // Wait for the update to complete to avoid "act" warning
        await waitFor(() => {
            expect(result.current.recipientUnread).toBe(5);
        });
    });

    test('should not fetch if userId is undefined', async () => {
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({})
        });

        renderHook(() => useRealtimeUnreadCounts(undefined));

        // Wait a bit to ensure no fetch happens
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(fetch).not.toHaveBeenCalled();
    });

    test('should handle fetch errors gracefully', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        fetch.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useRealtimeUnreadCounts('user1'));

        await waitFor(() => {
            expect(fetch).toHaveBeenCalled();
        });

        // Should remain at zero on error
        expect(result.current.recipientUnread).toBe(0);
        expect(result.current.santaUnread).toBe(0);
        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});
