/**
 * @jest-environment jsdom
 */

import { render, renderHook, screen, act, waitFor } from '@testing-library/react';
import {
    RealtimeMessagesProvider,
    useRealtimeMessagesContext,
    updateLastReadTimestamp,
} from '@/context/RealtimeMessagesContext';
import { useUser } from '@/hooks/useUser';
import { LEGACY_ACTIVE_SEASON } from '../helpers/useUser-mock';
import {
    updateLastReadTimestamp as mockClientUpdate,
    flushPendingWrites as mockFlushPendingWrites,
    resetLastReadState as mockResetLastReadState,
} from '@/lib/lastReadClient';

// Mock methods
const mockOnSnapshot = jest.fn();
const mockQuery = jest.fn();
const mockCollection = jest.fn();
const mockOrderBy = jest.fn();
const mockWhere = jest.fn();

jest.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    query: (...args) => mockQuery(...args),
    where: (...args) => mockWhere(...args),
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
    getCachedTimestamp: jest.fn().mockReturnValue('1970-01-01T00:00:00.000Z'),
    flushPendingWrites: jest.fn(() => Promise.resolve()),
    resetLastReadState: jest.fn(),
}));

// Test Consumer Component
function TestConsumer() {
    const context = useRealtimeMessagesContext();
    return (
        <div>
            <div data-testid="loading">{context.allMessagesLoading.toString()}</div>
            <div data-testid="msg-count">{context.allMessages.length}</div>
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

function renderProvider() {
    return render(
        <RealtimeMessagesProvider>
            <TestConsumer />
        </RealtimeMessagesProvider>
    );
}

describe('RealtimeMessagesContext', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOnSnapshot.mockReturnValue(jest.fn());
        mockCollection.mockReturnValue('mockCollection');
        mockQuery.mockReturnValue('mockQuery');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should wait for auth before loading', async () => {
        useUser.mockReturnValue({ user: null, loading: true });

        renderProvider();

        expect(screen.getByTestId('loading')).toHaveTextContent('true');
        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    test('should load messages when authenticated', async () => {
        useUser.mockReturnValue({ user: { id: 'u1' }, season: LEGACY_ACTIVE_SEASON, loading: false });

        let snapshotCallback;
        mockOnSnapshot.mockImplementation((...args) => {
            const { callback } = extractSnapshotCallback(args);
            if (!snapshotCallback) {
                snapshotCallback = callback;
            }
            return jest.fn();
        });

        renderProvider();

        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalled();
        });

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

    test('listens on the root collections for the open 2025 season', async () => {
        useUser.mockReturnValue({ user: { id: 'u1' }, season: LEGACY_ACTIVE_SEASON, loading: false });

        renderProvider();

        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
        });
        expect(mockCollection).toHaveBeenCalledWith({ _isMock: true }, 'messages');
        expect(mockCollection).toHaveBeenCalledWith({ _isMock: true }, 'reactions');
    });

    test('a closed season creates no listeners and exposes empty data', async () => {
        useUser.mockReturnValue({
            user: { id: 'u1' },
            season: { year: 2025, state: 'closed', epoch: 1, closedYears: [2025] },
            loading: false,
        });

        renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });
        expect(screen.getByTestId('msg-count')).toHaveTextContent('0');
        expect(mockOnSnapshot).not.toHaveBeenCalled();
        expect(mockCollection).not.toHaveBeenCalled();
    });

    test('an active 2026 season listens on the years/2026 collections', async () => {
        useUser.mockReturnValue({
            user: { id: 'u1' },
            season: { year: 2026, state: 'active', epoch: 2, closedYears: [2025] },
            loading: false,
        });

        renderProvider();

        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
        });
        expect(mockCollection).toHaveBeenCalledWith({ _isMock: true }, 'years', '2026', 'messages');
        expect(mockCollection).toHaveBeenCalledWith({ _isMock: true }, 'years', '2026', 'reactions');
        expect(mockCollection).not.toHaveBeenCalledWith({ _isMock: true }, 'messages');
    });

    test('a user without a season creates no listeners', async () => {
        useUser.mockReturnValue({ user: { id: 'u1' }, season: null, loading: false });

        renderProvider();

        await waitFor(() => {
            expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });
        expect(mockOnSnapshot).not.toHaveBeenCalled();
    });

    test('a new user object with the same id does not recreate listeners', async () => {
        useUser.mockReturnValue({ user: { id: 'u1', recipientId: null }, season: LEGACY_ACTIVE_SEASON, loading: false });

        const { rerender } = renderProvider();
        await waitFor(() => {
            expect(mockOnSnapshot).toHaveBeenCalledTimes(2); // messages + reactions
        });

        useUser.mockReturnValue({ user: { id: 'u1', recipientId: 'u2' }, season: LEGACY_ACTIVE_SEASON, loading: false });
        rerender(
            <RealtimeMessagesProvider>
                <TestConsumer />
            </RealtimeMessagesProvider>
        );

        expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
    });

    test('a permission-denied retry timer does not fire after unmount', async () => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        useUser.mockReturnValue({ user: { id: 'u1' }, season: LEGACY_ACTIVE_SEASON, loading: false });

        const errorCallbacks = [];
        mockOnSnapshot.mockImplementation((...args) => {
            errorCallbacks.push(extractSnapshotCallback(args).errorCallback);
            return jest.fn();
        });

        const { unmount } = renderProvider();
        expect(mockOnSnapshot).toHaveBeenCalledTimes(2);

        act(() => {
            errorCallbacks.forEach((callback) => callback({ code: 'permission-denied' }));
        });

        unmount();
        act(() => {
            jest.advanceTimersByTime(5000);
        });

        expect(mockOnSnapshot).toHaveBeenCalledTimes(2);
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    test('a permission-denied error retries after 2 seconds while mounted', async () => {
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        useUser.mockReturnValue({ user: { id: 'u1' }, season: LEGACY_ACTIVE_SEASON, loading: false });

        const errorCallbacks = [];
        mockOnSnapshot.mockImplementation((...args) => {
            errorCallbacks.push(extractSnapshotCallback(args).errorCallback);
            return jest.fn();
        });

        renderProvider();
        act(() => {
            errorCallbacks[0]({ code: 'permission-denied' });
        });
        act(() => {
            jest.advanceTimersByTime(2000);
        });

        expect(mockOnSnapshot).toHaveBeenCalledTimes(3);
        console.error.mockRestore();
        console.warn.mockRestore();
    });

    test('flushes markers on pagehide and resets read state on unmount', () => {
        useUser.mockReturnValue({ user: { id: 'u1' }, season: LEGACY_ACTIVE_SEASON, loading: false });

        const { unmount } = renderProvider();
        act(() => {
            window.dispatchEvent(new Event('pagehide'));
        });
        expect(mockFlushPendingWrites).toHaveBeenCalled();

        unmount();
        expect(mockResetLastReadState).toHaveBeenCalled();
    });

    test('updateLastReadTimestamp notifies subscribers only when the client accepted the update', () => {
        useUser.mockReturnValue({ user: { id: 'u1' }, season: LEGACY_ACTIVE_SEASON, loading: false });
        const wrapper = ({ children }) => (
            <RealtimeMessagesProvider>{children}</RealtimeMessagesProvider>
        );
        const { result } = renderHook(() => useRealtimeMessagesContext(), { wrapper });

        const listener = jest.fn();
        const unsubscribe = result.current.subscribeToLastReadChanges(listener);

        mockClientUpdate.mockReturnValueOnce(false);
        expect(updateLastReadTimestamp('u1', 'u2', 'conv-1', '2026-01-01T00:00:00.000Z')).toBe(false);
        expect(listener).not.toHaveBeenCalled();

        mockClientUpdate.mockReturnValueOnce(true);
        expect(updateLastReadTimestamp('u1', 'u2', 'conv-1', '2026-01-02T00:00:00.000Z')).toBe(true);
        expect(mockClientUpdate).toHaveBeenLastCalledWith('u1', 'conv-1', '2026-01-02T00:00:00.000Z');
        expect(listener).toHaveBeenCalledWith('u1', 'conv-1', '2026-01-02T00:00:00.000Z');

        unsubscribe();
    });

    test('should error if used outside provider', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => {
            render(<TestConsumer />);
        }).toThrow('useRealtimeMessagesContext must be used within a RealtimeMessagesProvider');

        spy.mockRestore();
    });
});
