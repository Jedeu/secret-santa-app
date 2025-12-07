/**
 * @jest-environment jsdom
 *
 * Tests for the authentication timing.
 * Updated to verify Context-based auth gating.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useRealtimeAllMessages } from '@/hooks/useRealtimeMessages';
import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';
import { useUser } from '@/hooks/useUser';

// Mock Firebase Firestore SDK
const mockOnSnapshot = jest.fn();
const mockQuery = jest.fn();
const mockCollection = jest.fn();
const mockOrderBy = jest.fn();

jest.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    query: (...args) => mockQuery(...args),
    where: jest.fn(),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    orderBy: (...args) => mockOrderBy(...args),
}));

// Mock firebase-client
jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true }
}));

// Mock useUser
jest.mock('@/hooks/useUser', () => ({
    useUser: jest.fn()
}));

// Mock the listener tracker
jest.mock('@/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

describe('Authentication Timing & Gating', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        mockCollection.mockReturnValue('mockCollection');
        mockOrderBy.mockReturnValue('mockOrderBy');
        mockQuery.mockReturnValue('mockQuery');
        mockOnSnapshot.mockReturnValue(jest.fn());
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // Wrapper providing Context
    const wrapper = ({ children }) => (
        <RealtimeMessagesProvider>
            {children}
        </RealtimeMessagesProvider>
    );

    test('should NOT subscribe when user is NOT authenticated', async () => {
        useUser.mockReturnValue({ user: null, loading: false });

        renderHook(() => useRealtimeAllMessages(), { wrapper });

        // Give it a moment (though it should be immediate)
        await waitFor(() => { }, { timeout: 100 });

        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    test('should subscribe when user IS authenticated', async () => {
        useUser.mockReturnValue({ user: { id: 'user1' }, loading: false });

        renderHook(() => useRealtimeAllMessages(), { wrapper });

        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalled();
        });
    });

    test('should NOT subscribe while auth is LOADING', async () => {
        useUser.mockReturnValue({ user: null, loading: true });

        renderHook(() => useRealtimeAllMessages(), { wrapper });

        await waitFor(() => { }, { timeout: 100 });

        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    test('should subscribe after auth completes (loading -> authenticated)', async () => {
        // Start loading
        useUser.mockReturnValue({ user: null, loading: true });
        const { rerender } = renderHook(() => useRealtimeAllMessages(), { wrapper });

        expect(mockOnSnapshot).not.toHaveBeenCalled();

        // Finish loading, user authenticated
        useUser.mockReturnValue({ user: { id: 'user1' }, loading: false });
        rerender();

        // Should now subscribe
        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalled();
        });
    });
});
