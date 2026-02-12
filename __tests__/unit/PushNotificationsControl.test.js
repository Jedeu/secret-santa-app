/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PushNotificationsControl from '@/components/PushNotificationsControl';
import { useToast } from '@/components/ClientProviders';
import {
    isPushSupported,
    enablePushForCurrentUser,
    disablePushForCurrentUser,
} from '@/lib/push-client';

jest.mock('@/components/ClientProviders', () => ({
    useToast: jest.fn(),
}));

jest.mock('@/lib/push-client', () => ({
    isPushSupported: jest.fn(),
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

describe('PushNotificationsControl', () => {
    const showToast = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        useToast.mockReturnValue({ showToast });
        isPushSupported.mockReturnValue(true);
        enablePushForCurrentUser.mockResolvedValue('push-token-123');
        disablePushForCurrentUser.mockResolvedValue(true);

        mockNotificationPermission('default');

        window.matchMedia = jest.fn().mockReturnValue({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        });
    });

    test('shows unsupported state when push is unavailable', async () => {
        isPushSupported.mockReturnValue(false);

        render(<PushNotificationsControl />);

        expect(await screen.findByText('Notifications unavailable')).toBeInTheDocument();
    });

    test('enables notifications on toggle click', async () => {
        render(<PushNotificationsControl />);

        const button = await screen.findByRole('button', { name: 'Enable notifications' });
        fireEvent.click(button);

        await waitFor(() => {
            expect(enablePushForCurrentUser).toHaveBeenCalledTimes(1);
            expect(showToast).toHaveBeenCalledWith('Push notifications enabled.', 'success');
        });
    });

    test('disables notifications after enabling', async () => {
        render(<PushNotificationsControl />);

        const enableButton = await screen.findByRole('button', { name: 'Enable notifications' });
        fireEvent.click(enableButton);

        const disableButton = await screen.findByRole('button', { name: 'Disable notifications' });
        fireEvent.click(disableButton);

        await waitFor(() => {
            expect(disablePushForCurrentUser).toHaveBeenCalledTimes(1);
            expect(showToast).toHaveBeenCalledWith('Push notifications disabled.', 'success');
        });
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

        window.matchMedia = jest.fn().mockReturnValue({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        });

        render(<PushNotificationsControl compact />);

        expect(await screen.findByText('Install to Home Screen to enable iOS notifications.')).toBeInTheDocument();
    });
});
