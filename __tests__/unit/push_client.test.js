/**
 * @jest-environment jsdom
 */

import {
    isPushSupported,
    enablePushForCurrentUser,
    disablePushForCurrentUser,
    attachForegroundListener,
} from '@/lib/push-client';
import { getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { clientAuth } from '@/lib/firebase-client';

jest.mock('firebase/app', () => ({
    getApps: jest.fn(),
}));

jest.mock('firebase/messaging', () => ({
    getMessaging: jest.fn(),
    getToken: jest.fn(),
    onMessage: jest.fn(),
}));

jest.mock('@/lib/firebase-client', () => ({
    clientAuth: {
        currentUser: {
            getIdToken: jest.fn(),
        },
    },
}));

function configurePushSupport({ permission = 'default' } = {}) {
    Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
            permission,
            requestPermission: jest.fn().mockResolvedValue(permission),
        },
    });

    Object.defineProperty(window, 'PushManager', {
        configurable: true,
        value: function PushManager() { },
    });

    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            ready: Promise.resolve({ scope: '/' }),
        },
    });
}

describe('push-client utilities', () => {
    const originalEnv = {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        senderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        window.localStorage.clear();

        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = 'test-vapid-key';
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'test-sender-id';
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'test-app-id';

        configurePushSupport({ permission: 'granted' });

        getApps.mockReturnValue([{}]);
        getMessaging.mockReturnValue({});
        getToken.mockResolvedValue('push-token-123');
        onMessage.mockImplementation((_messaging, callback) => {
            callback({ data: { type: 'incoming_message' } });
            return jest.fn();
        });

        clientAuth.currentUser.getIdToken.mockResolvedValue('firebase-id-token');

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
    });

    afterAll(() => {
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY = originalEnv.vapidKey;
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = originalEnv.senderId;
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID = originalEnv.appId;
    });

    test('isPushSupported returns true when browser and env requirements are met', () => {
        expect(isPushSupported()).toBe(true);
    });

    test('enablePushForCurrentUser registers token with API', async () => {
        const token = await enablePushForCurrentUser();

        expect(token).toBe('push-token-123');
        expect(fetch).toHaveBeenCalledWith('/api/push/register', expect.objectContaining({
            method: 'POST',
        }));
        expect(window.localStorage.getItem('secret-santa-push-token')).toBe('push-token-123');
    });

    test('disablePushForCurrentUser unregisters stored token', async () => {
        window.localStorage.setItem('secret-santa-push-token', 'push-token-123');

        await disablePushForCurrentUser();

        expect(fetch).toHaveBeenCalledWith('/api/push/unregister', expect.objectContaining({
            method: 'POST',
        }));
        expect(window.localStorage.getItem('secret-santa-push-token')).toBeNull();
    });

    test('attachForegroundListener wires onMessage callback', () => {
        const handler = jest.fn();

        const unsubscribe = attachForegroundListener(handler);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            data: { type: 'incoming_message' },
        }));
        expect(typeof unsubscribe).toBe('function');
    });
});
