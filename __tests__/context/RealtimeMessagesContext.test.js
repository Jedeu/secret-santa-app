/**
 * @jest-environment jsdom
 */

import { render, screen, act, waitFor } from '@testing-library/react';
import { RealtimeMessagesProvider, useRealtimeMessagesContext } from '@/context/RealtimeMessagesContext';
import { useUser } from '@/hooks/useUser';

// Mock methods
const mockOnSnapshot = jest.fn();
const mockQuery = jest.fn();
const mockCollection = jest.fn();
const mockOrderBy = jest.fn();
const mockWhere = jest.fn(); // Added missing mock

jest.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    query: (...args) => mockQuery(...args),
    where: (...args) => mockWhere(...args), // Added missing mock
    onSnapshot: (...args) => mockOnSnapshot(...args),
    orderBy: (...args) => mockOrderBy(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true }
}));

jest.mock('@/hooks/useUser', () => ({
    useUser: jest.fn()
}));

jest.mock('@/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

jest.mock('@/lib/lastReadClient', () => ({
    updateLastReadTimestamp: jest.fn(),
    getCachedTimestamp: jest.fn().mockReturnValue('1970-01-01T00:00:00.000Z')
}));

// Test Consumer Component
function TestConsumer() {
    const context = useRealtimeMessagesContext();
    return (
        <div>
            <div data-testid="loading">{context.allMessagesLoading.toString()}</div>
            <div data-testid="msg-count">{context.allMessages.length}</div>
            <button onClick={() => context.updateLastReadTimestamp('u1', 'u2')}>Update Last Read</button>
        </div>
    );
}

function extractSnapshotCallback(callArgs) {
    if (typeof callArgs[1] === 'object' && typeof callArgs[2] === 'function') {
        return { callback: callArgs[2], errorCallback: callArgs[3] };
    }
    if (typeof callArgs[1] === 'function') {
        return { callback: callArgs[1], errorCallback: callArgs[2] };
    }
    return { callback: null, errorCallback: null };
}


describe('RealtimeMessagesContext', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOnSnapshot.mockReturnValue(jest.fn());
        mockCollection.mockReturnValue('mockCollection');
        mockQuery.mockReturnValue('mockQuery');
    });

    test('should wait for auth before loading', async () => {
        useUser.mockReturnValue({ user: null, loading: true });

        render(
            <RealtimeMessagesProvider>
                <TestConsumer />
            </RealtimeMessagesProvider>
        );

        // Initially loading should be true (default state)
        // But since auth is loading, it stays true
        expect(screen.getByTestId('loading')).toHaveTextContent('true');
        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    test('should load messages when authenticated', async () => {
        useUser.mockReturnValue({ user: { id: 'u1' }, loading: false });

        let snapshotCallback;
        mockOnSnapshot.mockImplementation((...args) => {
            const { callback } = extractSnapshotCallback(args);
            snapshotCallback = callback;
            return jest.fn();
        });

        render(
            <RealtimeMessagesProvider>
                <TestConsumer />
            </RealtimeMessagesProvider>
        );

        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalled();
        });

        // Simulate data
        await act(async () => {
            snapshotCallback({
                forEach: (cb) => [{ data: () => ({ id: 1 }) }].forEach(cb),
                size: 1,
                metadata: { fromCache: false },
                docChanges: () => []
            });
        });

        expect(screen.getByTestId('msg-count')).toHaveTextContent('1');
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    test('should error if used outside provider', () => {
        // Suppress console.error for this test (React logs errors for boundary)
        const spy = jest.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => {
            render(<TestConsumer />);
        }).toThrow('useRealtimeMessagesContext must be used within a RealtimeMessagesProvider');

        spy.mockRestore();
    });
});
