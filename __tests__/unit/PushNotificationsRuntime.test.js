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

    test('syncs with the auth uid and toasts the chat title with the payload body', async () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        expect(syncPushTokenIfGranted).toHaveBeenCalledTimes(1);
        expect(syncPushTokenIfGranted).toHaveBeenCalledWith({ authUid: 'uid-1' });
        expect(attachForegroundListener).toHaveBeenCalledTimes(1);

        act(() => {
            foregroundHandler?.({
                data: { chat: 'santa', body: 'Did you get my hint?' },
                notification: { body: 'Fallback body' },
            });
        });

        expect(showToast).toHaveBeenCalledWith('\ud83c\udf85 Your Santa: Did you get my hint?', 'success');
    });

    test('falls back to generic copy when payload has no notification text', () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        act(() => {
            foregroundHandler?.({ data: {}, notification: {} });
        });

        expect(showToast).toHaveBeenCalledWith('Secret Santa: Sent you a message', 'success');
    });

    test('no toast for the chat already on screen; other chats still toast', () => {
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" activeTab="recipient" />);

        act(() => {
            foregroundHandler?.({ data: { chat: 'recipient', body: 'Sent you a message' } });
        });
        expect(showToast).not.toHaveBeenCalled();

        act(() => {
            foregroundHandler?.({ data: { chat: 'santa', body: 'Hello' } });
        });
        expect(showToast).toHaveBeenCalledWith('\ud83c\udf85 Your Santa: Hello', 'success');
    });

    test('does not show toast when document is hidden', () => {
        visibilityState = 'hidden';
        render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" />);

        act(() => {
            foregroundHandler?.({ data: { chat: 'recipient', body: 'Sent you a message' } });
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

    describe('opening chats, the tray and the Home Screen badge', () => {
        let swListeners;
        let trayNotifications;
        let getNotifications;

        beforeEach(() => {
            swListeners = {};
            trayNotifications = [{ close: jest.fn() }, { close: jest.fn() }];
            getNotifications = jest.fn(() => Promise.resolve(trayNotifications));
            Object.defineProperty(navigator, 'serviceWorker', {
                configurable: true,
                value: {
                    addEventListener: jest.fn((type, handler) => { swListeners[type] = handler; }),
                    removeEventListener: jest.fn(),
                    getRegistration: jest.fn(() => Promise.resolve({ getNotifications })),
                },
            });
            Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: jest.fn(() => Promise.resolve()) });
            Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: jest.fn(() => Promise.resolve()) });
        });

        afterEach(() => {
            delete navigator.serviceWorker;
            delete navigator.setAppBadge;
            delete navigator.clearAppBadge;
            window.history.replaceState(null, '', '/');
        });

        const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

        test('a cold start on /?chat=santa opens the Santa tab and strips the parameter', () => {
            window.history.replaceState(null, '', '/?chat=santa&keep=1');
            const onOpenChat = jest.fn();

            render(<PushNotificationsRuntime currentUser={null} authUid={null} onOpenChat={onOpenChat} />);

            expect(onOpenChat).toHaveBeenCalledWith('santa');
            expect(window.location.search).toBe('?keep=1');
        });

        test('an unknown chat parameter is stripped and ignored', () => {
            window.history.replaceState(null, '', '/?chat=feed');
            const onOpenChat = jest.fn();

            render(<PushNotificationsRuntime currentUser={null} authUid={null} onOpenChat={onOpenChat} />);

            expect(onOpenChat).not.toHaveBeenCalled();
            expect(window.location.search).toBe('');
        });

        test("tapping a notification while the app is open follows FCM's notification-clicked message", () => {
            const onOpenChat = jest.fn();
            render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" onOpenChat={onOpenChat} />);

            act(() => {
                swListeners.message({ data: { isFirebaseMessaging: true, messageType: 'push-received', data: { chat: 'santa' } } });
                swListeners.message({ data: { messageType: 'notification-clicked', data: { chat: 'santa' } } });
            });
            expect(onOpenChat).not.toHaveBeenCalled();

            act(() => {
                swListeners.message({ data: { isFirebaseMessaging: true, messageType: 'notification-clicked', data: { chat: 'recipient' } } });
            });
            expect(onOpenChat).toHaveBeenCalledWith('recipient');
        });

        test('viewing a chat closes its notifications in the tray', async () => {
            const { rerender } = render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" activeTab="feed" />);
            await flush();
            expect(getNotifications).not.toHaveBeenCalled();

            rerender(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" activeTab="santa" />);
            await flush();

            expect(getNotifications).toHaveBeenCalledWith({ tag: 'chat-santa' });
            trayNotifications.forEach((notification) => expect(notification.close).toHaveBeenCalled());
        });

        test('the Home Screen badge shows unread totals only while push is on', async () => {
            const { rerender } = render(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" unreadTotal={3} pushOn />);
            await flush();
            expect(navigator.setAppBadge).toHaveBeenCalledWith(3);

            rerender(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" unreadTotal={3} pushOn={false} />);
            await flush();
            expect(navigator.clearAppBadge).toHaveBeenCalledTimes(1);

            rerender(<PushNotificationsRuntime currentUser={{ id: 'user-1' }} authUid="uid-1" unreadTotal={0} pushOn />);
            await flush();
            expect(navigator.clearAppBadge).toHaveBeenCalledTimes(2);
        });
    });
});
