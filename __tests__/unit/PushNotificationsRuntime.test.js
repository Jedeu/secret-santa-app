/**
 * @jest-environment jsdom
 */

import { act, render } from '@testing-library/react';
import PushNotificationsRuntime from '@/components/PushNotificationsRuntime';
import { useToast } from '@/components/ClientProviders';
import {
    attachForegroundListener,
    cancelPushOperations,
    syncPushTokenIfGranted,
} from '@/lib/push-client';

jest.mock('@/components/ClientProviders', () => ({
    useToast: jest.fn(),
}));

jest.mock('@/lib/push-client', () => ({
    attachForegroundListener: jest.fn(),
    cancelPushOperations: jest.fn(),
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
        syncPushTokenIfGranted.mockResolvedValue('registered');
        attachForegroundListener.mockImplementation((callback) => {
            foregroundHandler = callback;
            return unsubscribe;
        });
    });

    test('syncs with the auth uid and shows toast using contextual payload body from data first', async () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        expect(syncPushTokenIfGranted).toHaveBeenCalledTimes(1);
        expect(syncPushTokenIfGranted).toHaveBeenCalledWith({ authUid: 'uid-1' });
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
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        act(() => {
            foregroundHandler?.({ data: {}, notification: {} });
        });

        expect(showToast).toHaveBeenCalledWith('You have a new message', 'success');
    });

    test('does not show toast when document is hidden', () => {
        visibilityState = 'hidden';
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        act(() => {
            foregroundHandler?.({
                data: { notificationBody: 'You have a new message from your recipient' },
            });
        });

        expect(showToast).not.toHaveBeenCalled();
    });

    test('does nothing without both a user and an auth uid', () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid={null} />);
        render(<PushNotificationsRuntime currentUser={null} authUid="uid-1" />);

        expect(syncPushTokenIfGranted).not.toHaveBeenCalled();
        expect(attachForegroundListener).not.toHaveBeenCalled();
    });

    test('a throwing foreground listener does not throw from render', () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        attachForegroundListener.mockImplementation(() => {
            throw new Error('messaging unavailable');
        });

        expect(() => render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />)).not.toThrow();
        console.error.mockRestore();
    });

    test('cleanup cancels push operations and unsubscribes', () => {
        const { unmount } = render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        unmount();

        expect(cancelPushOperations).toHaveBeenCalledTimes(1);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
