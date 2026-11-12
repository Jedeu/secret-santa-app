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
    retryPushRegistration,
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
    retryPushRegistration: jest.fn(),
    isPushTimeoutError: jest.fn((e) => e?.code === 'PUSH_TIMEOUT'),
}));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Each call returns its own pending deferred; `preference` is written synchronously
// first, as the real click paths do.
function pendingCalls(mockFn, preference = null) {
    const calls = [];
    mockFn.mockImplementation(({ authUid } = {}) => {
        if (preference) {
            mockPreferences.set(authUid, preference);
            mockNotify();
        }
        const call = deferred();
        calls.push(call);
        return call.promise;
    });
    return calls;
}

function timeoutError(stage, message = 'Push setup timed out.') {
    return Object.assign(new Error(message), { name: 'PushTimeoutError', code: 'PUSH_TIMEOUT', stage });
}

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
        retryPushRegistration.mockResolvedValue('skipped');

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

    describe('bounded setup feedback', () => {
        const NOTE_TEXT = /timed out|not registered|not allowed|finish unregistering/;
        const PERMISSION_NOT_GRANTED = 'Notifications are not allowed on this device yet. Tap Enable notifications to try again.';

        beforeEach(() => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            console.error.mockRestore();
        });

        // Renders, clicks Enable and lets that enable time out at the token step.
        async function enableThenTimeOut(enables) {
            render(<PushNotificationsControl authUid={AUTH_UID} />);
            fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
            await act(async () => {
                enables[0].reject(timeoutError('token'));
            });
        }

        test('U1. a timeout while granted settles on "Disable notifications" with a step note and Try again, no toast', async () => {
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');

            render(<PushNotificationsControl authUid={AUTH_UID} />);
            fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();

            await act(async () => {
                enables[0].reject(timeoutError('token'));
            });

            expect(screen.queryByText('Saving...')).toBeNull();
            expect(screen.getByRole('button', { name: 'Disable notifications' })).toBeInTheDocument();
            expect(screen.getByText(/timed out/)).toHaveTextContent('(step: token)');
            expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
            expect(showToast).not.toHaveBeenCalled();
        });

        test('U2. a permission-stage timeout while permission is default shows the permission note only', async () => {
            mockNotificationPermission('default');
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');

            render(<PushNotificationsControl authUid={AUTH_UID} />);
            fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
            await act(async () => {
                enables[0].reject(timeoutError('permission'));
            });

            expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
            expect(screen.getByText(PERMISSION_NOT_GRANTED)).toBeInTheDocument();
            expect(screen.queryByText(/step/)).toBeNull();
            expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
            expect(showToast).not.toHaveBeenCalled();
        });

        test('U3. a timeout whose message mentions permission is not "blocked"; PERMISSION_DENIED still is', async () => {
            mockNotificationPermission('default');
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');

            render(<PushNotificationsControl authUid={AUTH_UID} />);
            fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
            await act(async () => {
                enables[0].reject(timeoutError('permission', 'Timed out waiting for notification permission.'));
            });
            expect(showToast).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
            await act(async () => {
                enables[1].reject(Object.assign(new Error('Push permission was not granted.'), { code: 'PERMISSION_DENIED' }));
            });
            expect(showToast).toHaveBeenCalledTimes(1);
            expect(showToast).toHaveBeenCalledWith('Notifications permission is blocked. Enable it in browser settings.');
        });

        test('U4. Try again calls retryPushRegistration once, not enable; registered shows the toast and clears the note', async () => {
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');
            const retries = pendingCalls(retryPushRegistration);
            await enableThenTimeOut(enables);

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
            expect(retryPushRegistration).toHaveBeenCalledTimes(1);
            expect(retryPushRegistration).toHaveBeenCalledWith({ authUid: AUTH_UID });
            expect(enablePushForCurrentUser).toHaveBeenCalledTimes(1);
            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();

            await act(async () => {
                retries[0].resolve('registered');
            });

            expect(showToast).toHaveBeenCalledTimes(1);
            expect(showToast).toHaveBeenCalledWith('Push notifications enabled.', 'success');
            expect(screen.queryByText(NOTE_TEXT)).toBeNull();
            expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Disable notifications' })).toBeInTheDocument();
        });

        test.each([
            ['times out again'],
            ['resolves skipped'],
            ['resolves aborted'],
        ])('U5. a retry that %s never leaves the UI on "Saving..."', async (outcome) => {
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');
            const retries = pendingCalls(retryPushRegistration);
            await enableThenTimeOut(enables);

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();

            await act(async () => {
                if (outcome === 'times out again') {
                    retries[0].reject(timeoutError('request'));
                } else {
                    retries[0].resolve(outcome === 'resolves skipped' ? 'skipped' : 'aborted');
                }
            });

            expect(screen.queryByText('Saving...')).toBeNull();
            expect(showToast).not.toHaveBeenCalled();
            if (outcome === 'times out again') {
                expect(screen.getByText(/timed out/)).toHaveTextContent('(step: request)');
                expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
            } else {
                expect(screen.queryByText(NOTE_TEXT)).toBeNull();
                expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
            }
        });

        test('U6. another tab disabling after a timeout removes the note and Try again', async () => {
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');
            await enableThenTimeOut(enables);
            expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

            act(() => {
                mockPreferences.set(AUTH_UID, 'disabled');
                mockNotify();
            });

            expect(screen.queryByText(NOTE_TEXT)).toBeNull();
            expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
        });

        test.each([
            ['an enable'],
            ['a retry'],
        ])('U7. another tab disables while %s is pending; its later timeout shows no note, no Try again and no toast', async (kind) => {
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');
            const retries = pendingCalls(retryPushRegistration);
            let pending;
            if (kind === 'a retry') {
                await enableThenTimeOut(enables);
                fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
                [pending] = retries;
            } else {
                render(<PushNotificationsControl authUid={AUTH_UID} />);
                fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
                [pending] = enables;
            }
            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();

            act(() => {
                mockPreferences.set(AUTH_UID, 'disabled');
                mockNotify();
            });
            await act(async () => {
                pending.reject(timeoutError('token'));
            });

            expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
            expect(screen.queryByText(NOTE_TEXT)).toBeNull();
            expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
            expect(showToast).not.toHaveBeenCalled();
        });

        test.each([
            ['late-resolves registered'],
            ['late-rejects with a timeout'],
        ])('U8. account switch A to B: A\'s pending enable that %s cannot touch B', async (late) => {
            mockPreferences.set('uid-B', 'disabled');
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');

            const { rerender } = render(<PushNotificationsControl authUid="uid-A" />);
            fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
            expect(mockPreferences.get('uid-A')).toBe('enabled');
            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();

            rerender(<PushNotificationsControl authUid="uid-B" />);
            expect(screen.queryByText('Saving...')).toBeNull();
            expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));
            expect(enablePushForCurrentUser).toHaveBeenLastCalledWith({ authUid: 'uid-B' });
            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();

            await act(async () => {
                if (late === 'late-resolves registered') {
                    enables[0].resolve('registered');
                } else {
                    enables[0].reject(timeoutError('token'));
                }
            });

            expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();
            expect(showToast).not.toHaveBeenCalled();
            expect(screen.queryByText(NOTE_TEXT)).toBeNull();

            await act(async () => {
                enables[1].resolve('registered');
            });

            expect(showToast).toHaveBeenCalledTimes(1);
            expect(showToast).toHaveBeenCalledWith('Push notifications enabled.', 'success');
            expect(screen.getByRole('button', { name: 'Disable notifications' })).toBeInTheDocument();
        });

        test('U9. unmounting while an attempt is pending shows no toast when it settles', async () => {
            const enables = pendingCalls(enablePushForCurrentUser, 'enabled');

            const { unmount } = render(<PushNotificationsControl authUid={AUTH_UID} />);
            fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
            unmount();

            await act(async () => {
                enables[0].resolve('registered');
            });

            expect(showToast).not.toHaveBeenCalled();
        });
    });
});
