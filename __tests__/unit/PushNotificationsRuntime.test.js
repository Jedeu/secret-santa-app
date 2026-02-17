/**
 * @jest-environment jsdom
 */

import { act, render } from '@testing-library/react';
import PushNotificationsRuntime from '@/components/PushNotificationsRuntime';
import { useToast } from '@/components/ClientProviders';
import { attachForegroundListener, syncPushTokenIfGranted } from '@/lib/push-client';

jest.mock('@/components/ClientProviders', () => ({
    useToast: jest.fn(),
}));

jest.mock('@/lib/push-client', () => ({
    attachForegroundListener: jest.fn(),
    syncPushTokenIfGranted: jest.fn(),
}));

describe('PushNotificationsRuntime', () => {
    const showToast = jest.fn();
    const unsubscribe = jest.fn();
    let foregroundHandler = null;
    let visibilityState = 'visible';

    beforeEach(() => {
        jest.clearAllMocks();
        foregroundHandler = null;
        visibilityState = 'visible';

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState,
        });

        useToast.mockReturnValue({ showToast });
        syncPushTokenIfGranted.mockResolvedValue('push-token-123');
        attachForegroundListener.mockImplementation((callback) => {
            foregroundHandler = callback;
            return unsubscribe;
        });
    });

    test('shows toast using contextual payload body from data first', async () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} />);

        expect(syncPushTokenIfGranted).toHaveBeenCalledTimes(1);
        expect(attachForegroundListener).toHaveBeenCalledTimes(1);

        act(() => {
            foregroundHandler?.({
                data: { notificationBody: 'You have a new message from Santa' },
                notification: { body: 'Fallback body' },
            });
        });

        expect(showToast).toHaveBeenCalledWith('You have a new message from Santa', 'success');
    });

    test('falls back to generic body when payload has no notification text', () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} />);

        act(() => {
            foregroundHandler?.({ data: {}, notification: {} });
        });

        expect(showToast).toHaveBeenCalledWith('You have a new message', 'success');
    });

    test('does not show toast when document is hidden', () => {
        visibilityState = 'hidden';
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} />);

        act(() => {
            foregroundHandler?.({
                data: { notificationBody: 'You have a new message from your recipient' },
            });
        });

        expect(showToast).not.toHaveBeenCalled();
    });
});
