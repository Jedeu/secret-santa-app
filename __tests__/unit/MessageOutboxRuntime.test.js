/** @jest-environment jsdom */
import { render, act } from '@testing-library/react';
import MessageOutboxRuntime from '@/components/MessageOutboxRuntime';
import { clearDeliveredOrExpired, drainOutboxForUser } from '@/lib/message-outbox';

jest.mock('@/lib/message-outbox', () => ({
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

    test('drains on mount and on polling interval', async () => {
        render(<MessageOutboxRuntime currentUser={{ id: 'user-a' }} />);

        expect(clearDeliveredOrExpired).toHaveBeenCalledWith({ fromUserId: 'user-a' });
        expect(drainOutboxForUser).toHaveBeenCalledWith({ fromUserId: 'user-a' });

        await act(async () => {
            jest.advanceTimersByTime(30000);
        });

        expect(drainOutboxForUser).toHaveBeenCalledTimes(2);
    });

    test('drains on online/focus/visibility events', async () => {
        render(<MessageOutboxRuntime currentUser={{ id: 'user-a' }} />);
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

    test('does nothing without authenticated user id', () => {
        render(<MessageOutboxRuntime currentUser={null} />);
        expect(drainOutboxForUser).not.toHaveBeenCalled();
        expect(clearDeliveredOrExpired).not.toHaveBeenCalled();
    });
});
