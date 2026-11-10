/** @jest-environment jsdom */
import { render, act } from '@testing-library/react';
import MessageOutboxRuntime from '@/components/MessageOutboxRuntime';
import { cancelOutboxDrains, clearDeliveredOrExpired, drainOutboxForUser } from '@/lib/message-outbox';

jest.mock('@/lib/message-outbox', () => ({
    cancelOutboxDrains: jest.fn(),
    clearDeliveredOrExpired: jest.fn(),
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 0, retried: 0, failed: 0, skipped: 0 }))
}));

describe('MessageOutboxRuntime', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('drains on mount and on polling interval with the owner uid', async () => {
        render(<MessageOutboxRuntime currentUser={{ id: 'user-a' }} authUid="uid-a" />);

        expect(clearDeliveredOrExpired).toHaveBeenCalledWith({ fromUserId: 'user-a' });
        expect(drainOutboxForUser).toHaveBeenCalledWith({ ownerUid: 'uid-a', fromUserId: 'user-a' });

        await act(async () => {
            jest.advanceTimersByTime(30000);
        });

        expect(drainOutboxForUser).toHaveBeenCalledTimes(2);
    });

    test('drains on online/focus/visibility events', async () => {
        render(<MessageOutboxRuntime currentUser={{ id: 'user-a' }} authUid="uid-a" />);
        jest.clearAllMocks();

        await act(async () => {
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('focus'));
        });

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible'
        });

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(drainOutboxForUser).toHaveBeenCalledTimes(3);
    });

    test('does nothing without an authenticated user id', () => {
        render(<MessageOutboxRuntime currentUser={null} authUid="uid-a" />);
        expect(drainOutboxForUser).not.toHaveBeenCalled();
        expect(clearDeliveredOrExpired).not.toHaveBeenCalled();
    });

    test('does nothing without an auth uid', () => {
        render(<MessageOutboxRuntime currentUser={{ id: 'user-a' }} authUid={null} />);
        expect(drainOutboxForUser).not.toHaveBeenCalled();
    });

    test('cancels drains on unmount', () => {
        const { unmount } = render(<MessageOutboxRuntime currentUser={{ id: 'user-a' }} authUid="uid-a" />);
        expect(cancelOutboxDrains).not.toHaveBeenCalled();

        unmount();

        expect(cancelOutboxDrains).toHaveBeenCalledTimes(1);
    });
});
