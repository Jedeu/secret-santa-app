'use client';

import { getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { clientAuth } from '@/lib/firebase-client';

const PUSH_TOKEN_STORAGE_KEY = 'secret-santa-push-token';

function hasRequiredPushEnv() {
    return Boolean(
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
        && process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
        && process.env.NEXT_PUBLIC_FIREBASE_APP_ID
    );
}

function getStoredPushToken() {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
}

function setStoredPushToken(token) {
    if (typeof window === 'undefined') return;

    if (token) {
        window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
        return;
    }

    window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}

function getMessagingInstance() {
    if (typeof window === 'undefined') return null;

    const apps = getApps();
    if (!apps.length) {
        return null;
    }

    return getMessaging(apps[0]);
}

async function getAuthHeaders() {
    const idToken = await clientAuth?.currentUser?.getIdToken?.();

    if (!idToken) {
        throw new Error('Not authenticated. Please sign in again.');
    }

    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
    };
}

async function postPushToken(pathname, token) {
    const headers = await getAuthHeaders();

    const response = await fetch(pathname, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token }),
    });

    if (!response.ok) {
        let errorMessage = 'Push request failed';

        try {
            const errorData = await response.json();
            if (errorData?.error) {
                errorMessage = errorData.error;
            }
        } catch {
            // Keep fallback message
        }

        throw new Error(errorMessage);
    }
}

async function getServiceWorkerRegistration() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        throw new Error('Service worker is not available in this browser.');
    }

    return navigator.serviceWorker.ready;
}

export function isPushSupported() {
    return (
        typeof window !== 'undefined'
        && 'Notification' in window
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && hasRequiredPushEnv()
    );
}

export async function enablePushForCurrentUser() {
    if (!isPushSupported()) {
        throw new Error('Push notifications are not supported in this environment.');
    }

    let permission = Notification.permission;
    if (permission !== 'granted') {
        permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
        throw new Error('Push permission was not granted.');
    }

    const messaging = getMessagingInstance();
    if (!messaging) {
        throw new Error('Firebase messaging is not initialized.');
    }

    const serviceWorkerRegistration = await getServiceWorkerRegistration();

    const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration,
    });

    if (!token) {
        throw new Error('No push token returned from FCM.');
    }

    await postPushToken('/api/push/register', token);
    setStoredPushToken(token);

    return token;
}

export async function disablePushForCurrentUser() {
    const storedToken = getStoredPushToken();

    if (storedToken) {
        await postPushToken('/api/push/unregister', storedToken);
        setStoredPushToken(null);
        return true;
    }

    // If there is no locally cached token, consider the device disabled already.
    return true;
}

export async function syncPushTokenIfGranted() {
    if (!isPushSupported()) {
        return null;
    }

    if (Notification.permission !== 'granted') {
        setStoredPushToken(null);
        return null;
    }

    const messaging = getMessagingInstance();
    if (!messaging) {
        return null;
    }

    const serviceWorkerRegistration = await getServiceWorkerRegistration();

    const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration,
    });

    if (!token) {
        return null;
    }

    const existingToken = getStoredPushToken();

    if (existingToken !== token) {
        await postPushToken('/api/push/register', token);
    }

    setStoredPushToken(token);
    return token;
}

export function attachForegroundListener(onIncomingMessage) {
    if (!isPushSupported()) {
        return () => { };
    }

    const messaging = getMessagingInstance();
    if (!messaging) {
        return () => { };
    }

    return onMessage(messaging, (payload) => {
        if (typeof onIncomingMessage === 'function') {
            onIncomingMessage(payload);
        }
    });
}
