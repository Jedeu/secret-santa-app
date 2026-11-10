/**
 * @jest-environment jsdom
 */

import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import PushNotificationsControl from '@/components/PushNotificationsControl';
import { useToast } from '@/components/ClientProviders';
import {
    isPushSupported,
    getPushPreference,
    subscribePushState,
    enablePushForCurrentUser,
    disablePushForCurrentUser,
} from '@/lib/push-client';

jest.mock('@/components/ClientProviders', () => ({
    useToast: jest.fn(),
}));

// Stateful mock: preference store + subscribers, like the real client.
const mockPreferences = new Map();
const mockSubscribers = new Set();

function mockNotify() {
    mockSubscribers.forEach((callback) => callback());
}

jest.mock('@/lib/push-client', () => ({
    isPushSupported: jest.fn(),
    getPushPreference: jest.fn((authUid) => mockPreferences.get(authUid) ?? null),
    subscribePushState: jest.fn((callback) => {
        mockSubscribers.add(callback);
        return () => mockSubscribers.delete(callback);
    }),
    enablePushForCurrentUser: jest.fn(),
    disablePushForCurrentUser: jest.fn(),
}));

function mockNotificationPermission(permission) {
    const notificationMock = {
        permission,
        requestPermission: jest.fn().mockResolvedValue(permission),
    };

    Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: notificationMock,
    });

    Object.defineProperty(global, 'Notification', {
        configurable: true,
        value: notificationMock,
    });
}

const AUTH_UID = 'uid-1';

describe('PushNotificationsControl', () => {
    const showToast = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockPreferences.clear();
        mockSubscribers.clear();
        useToast.mockReturnValue({ showToast });
        isPushSupported.mockReturnValue(true);

        // Default: the click writes the preference synchronously, then succeeds.
        enablePushForCurrentUser.mockImplementation(async ({ authUid }) => {
            mockPreferences.set(authUid, 'enabled');
            mockNotify();
            return 'registered';
        });
        disablePushForCurrentUser.mockImplementation(async ({ authUid }) => {
            mockPreferences.set(authUid, 'disabled');
            mockNotify();
            return 'disabled';
        });

        mockNotificationPermission('granted');

        window.matchMedia = jest.fn().mockReturnValue({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        });
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop' });
        Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux' });
    });

    test('shows unsupported state when push is unavailable', async () => {
        isPushSupported.mockReturnValue(false);

        render(<PushNotificationsControl authUid={AUTH_UID} />);

        expect(await screen.findByText('Notifications unavailable')).toBeInTheDocument();
    });

    test('enabled preference with granted permission reads "Disable notifications"', async () => {
        mockPreferences.set(AUTH_UID, 'enabled');

        render(<PushNotificationsControl authUid={AUTH_UID} />);

        expect(await screen.findByRole('button', { name: 'Disable notifications' })).toBeInTheDocument();
    });

    test('enabled preference without permission reads "Enable notifications"', async () => {
        mockPreferences.set(AUTH_UID, 'enabled');
        mockNotificationPermission('default');

        render(<PushNotificationsControl authUid={AUTH_UID} />);

        expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
    });

    test('enables then disables through the toggles with the auth uid', async () => {
        render(<PushNotificationsControl authUid={AUTH_UID} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
        await waitFor(() => {
            expect(enablePushForCurrentUser).toHaveBeenCalledWith({ authUid: AUTH_UID });
            expect(showToast).toHaveBeenCalledWith('Push notifications enabled.', 'success');
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Disable notifications' }));
        await waitFor(() => {
            expect(disablePushForCurrentUser).toHaveBeenCalledWith({ authUid: AUTH_UID });
            expect(showToast).toHaveBeenCalledWith('Push notifications disabled.', 'success');
        });
        expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
    });

    test('a failed enable keeps "Disable notifications" and shows the not-registered note', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        enablePushForCurrentUser.mockImplementation(async ({ authUid }) => {
            mockPreferences.set(authUid, 'enabled');
            mockNotify();
            throw new Error('Failed to register push token');
        });

        render(<PushNotificationsControl authUid={AUTH_UID} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));

        expect(await screen.findByText(/this device is not registered yet/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Disable notifications' })).toBeInTheDocument();
        console.error.mockRestore();
    });

    test('a failed disable reads "Enable notifications" and shows the finish-unregistering note', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockPreferences.set(AUTH_UID, 'enabled');
        disablePushForCurrentUser.mockImplementation(async ({ authUid }) => {
            mockPreferences.set(authUid, 'disabled');
            mockNotify();
            throw new Error('Network error');
        });

        render(<PushNotificationsControl authUid={AUTH_UID} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Disable notifications' }));

        expect(await screen.findByText(/finish unregistering/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
        console.error.mockRestore();
    });

    test('an aborted toggle shows no note and no toast', async () => {
        enablePushForCurrentUser.mockImplementation(async ({ authUid }) => {
            mockPreferences.set(authUid, 'enabled');
            mockNotify();
            return 'aborted';
        });

        render(<PushNotificationsControl authUid={AUTH_UID} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));

        await waitFor(() => expect(enablePushForCurrentUser).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Saving...')).toBeNull());
        expect(showToast).not.toHaveBeenCalled();
        expect(screen.queryByText(/not registered yet/)).toBeNull();
        expect(screen.queryByText(/finish unregistering/)).toBeNull();
    });

    test('a preference change from another tab updates the label without calling a toggle', async () => {
        render(<PushNotificationsControl authUid={AUTH_UID} />);
        expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();

        act(() => {
            mockPreferences.set(AUTH_UID, 'enabled');
            mockNotify();
        });

        expect(await screen.findByRole('button', { name: 'Disable notifications' })).toBeInTheDocument();
        expect(enablePushForCurrentUser).not.toHaveBeenCalled();
        expect(disablePushForCurrentUser).not.toHaveBeenCalled();
        expect(subscribePushState).toHaveBeenCalled();
        expect(getPushPreference).toHaveBeenCalledWith(AUTH_UID);
    });

    test('permission denied keeps the existing hint', async () => {
        mockNotificationPermission('denied');

        render(<PushNotificationsControl authUid={AUTH_UID} />);

        expect(await screen.findByText('Browser permission is blocked. Enable notifications in settings.')).toBeInTheDocument();
    });

    test('shows iOS standalone requirement hint', async () => {
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            value: 'iPhone',
        });

        Object.defineProperty(navigator, 'platform', {
            configurable: true,
            value: 'iPhone',
        });

        render(<PushNotificationsControl compact authUid={AUTH_UID} />);

        expect(await screen.findByText('Install to Home Screen to enable iOS notifications.')).toBeInTheDocument();
    });
});
