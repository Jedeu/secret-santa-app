'use client';

import { getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { clientAuth } from '@/lib/firebase-client';

/**
 * Per-device push registration.
 *
 * - Preference (desired state, per account): 'secret-santa-push-pref:{authUid}' =
 *   'enabled' | 'disabled'. Written ONLY as the first synchronous statement of an
 *   explicit enable or disable click. Never rolled back, never written after an await.
 * - Device intent: PUSH_INTENT_KEY = { id, authUid }. Names which operation may start
 *   network work on this device. Not desired state and never a storage CAS.
 * - Every reconcile round reads /api/push/status and then ALWAYS registers the
 *   currently stored preference with that epoch/revision, so the newest acknowledged
 *   action rotates the revision and every older in-flight request gets 409.
 *
 * PushResult: 'registered' | 'disabled' | 'skipped' | 'aborted'
 */

export const PUSH_INTENT_KEY = 'secret-santa-push-intent';
const PUSH_PREFERENCE_PREFIX = 'secret-santa-push-pref:';
const LEGACY_PUSH_TOKEN_KEY = 'secret-santa-push-token';
const REQUEST_TIMEOUT_MS = 15 * 1000;
const MAX_RECONCILE_ROUNDS = 3;

// Realm-local state
let pushGeneration = 0;
let lastKnown = null; // { authUid, token, epoch, revision }
const subscribers = new Set();
let storageListener = null;

class PushAbortedError extends Error {
    constructor() {
        super('Push operation superseded');
        this.name = 'PushAbortedError';
        this.isPushAborted = true;
    }
}

function getStorage() {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return null;
    }
    return window.localStorage;
}

function preferenceKey(authUid) {
    return PUSH_PREFERENCE_PREFIX + authUid;
}

function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const randomHex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return `${randomHex()}${randomHex()}-${randomHex()}-4${randomHex().slice(1)}-a${randomHex().slice(1)}-${randomHex()}${randomHex()}${randomHex()}`;
}

function notifySubscribers() {
    subscribers.forEach((callback) => {
        try {
            callback();
        } catch (error) {
            console.error('Push state subscriber failed:', error);
        }
    });
}

function readIntent() {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const parsed = JSON.parse(storage.getItem(PUSH_INTENT_KEY));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function writeIntent(authUid) {
    const id = generateId();
    const storage = getStorage();
    if (storage) {
        storage.setItem(PUSH_INTENT_KEY, JSON.stringify({ id, authUid: authUid ?? null }));
    }
    return id;
}

function writePreference(authUid, value) {
    const storage = getStorage();
    if (storage && authUid) {
        storage.setItem(preferenceKey(authUid), value);
    }
}

function hasRequiredPushEnv() {
    return Boolean(
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
        && process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
        && process.env.NEXT_PUBLIC_FIREBASE_APP_ID
    );
}

function getMessagingInstance() {
    if (typeof window === 'undefined') return null;

    try {
        const apps = getApps();
        if (!apps.length) {
            return null;
        }

        return getMessaging(apps[0]);
    } catch (error) {
        console.error('Firebase messaging unavailable:', error);
        return null;
    }
}

async function getServiceWorkerRegistration() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        throw new Error('Service worker is not available in this browser.');
    }

    return navigator.serviceWorker.ready;
}

function makeOperation(authUid, intentId) {
    return {
        generation: pushGeneration,
        authUid,
        intentId,
        user: clientAuth?.currentUser ?? null,
        cancelled: false,
        controllers: new Set(),
    };
}

function isCurrent(op) {
    return !op.cancelled
        && op.generation === pushGeneration
        && (clientAuth?.currentUser?.uid ?? null) === op.authUid
        && readIntent()?.id === op.intentId;
}

function ensureCurrent(op) {
    if (!isCurrent(op)) {
        throw new PushAbortedError();
    }
}

function isAbort(error) {
    return error?.isPushAborted === true;
}

function requestError(result, fallback) {
    const error = new Error(result?.data?.error || fallback || `Push request failed with status ${result?.status}`);
    error.status = result?.status;
    error.code = result?.data?.code;
    return error;
}

async function postJson(op, pathname, body) {
    ensureCurrent(op);
    if (!op.user || typeof op.user.getIdToken !== 'function') {
        throw new Error('Not authenticated. Please sign in again.');
    }
    const idToken = await op.user.getIdToken();
    ensureCurrent(op);
    if (!idToken) {
        throw new Error('Not authenticated. Please sign in again.');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    if (controller) op.controllers.add(controller);

    let response;
    try {
        // Immediately before the request.
        ensureCurrent(op);
        response = await fetch(pathname, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify(body),
            ...(controller ? { signal: controller.signal } : {}),
        });
    } finally {
        if (timer) clearTimeout(timer);
        if (controller) op.controllers.delete(controller);
    }
    ensureCurrent(op);

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    ensureCurrent(op);

    return { ok: !!response.ok, status: response.status, data };
}

async function obtainFcmToken(op) {
    const messaging = getMessagingInstance();
    if (!messaging) {
        throw new Error('Firebase messaging is not initialized.');
    }

    const serviceWorkerRegistration = await getServiceWorkerRegistration();
    ensureCurrent(op);

    const token = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration,
    });
    ensureCurrent(op);

    if (!token) {
        throw new Error('No push token returned from FCM.');
    }
    return token;
}

/**
 * At most three rounds; every round registers the stored preference with a fresh
 * status epoch/revision (including when the server already matches). No no-op outcome.
 */
async function reconcile(op) {
    const token = await obtainFcmToken(op);

    for (let round = 1; round <= MAX_RECONCILE_ROUNDS; round += 1) {
        ensureCurrent(op);
        const status = await postJson(op, '/api/push/status', { token });
        if (!status.ok) {
            throw requestError(status, 'Failed to read push status');
        }

        ensureCurrent(op);
        const desired = getPushPreference(op.authUid) === 'enabled';

        const registration = await postJson(op, '/api/push/register', {
            token,
            expectedEpoch: status.data?.epoch,
            expectedRevision: status.data?.revision ?? null,
            enabled: desired,
        });

        if (registration.ok) {
            lastKnown = {
                authUid: op.authUid,
                token,
                epoch: registration.data?.epoch,
                revision: registration.data?.revision ?? null,
            };
            return desired ? 'registered' : 'disabled';
        }

        if (registration.status !== 409) {
            throw requestError(registration, 'Failed to register push token');
        }
    }

    return 'aborted';
}

function ensureStorageListener() {
    if (storageListener || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    storageListener = (event) => {
        const key = event?.key ?? null;
        if (key === null || key === PUSH_INTENT_KEY || (typeof key === 'string' && key.startsWith(PUSH_PREFERENCE_PREFIX))) {
            // Refresh subscribers only; never start a reconcile from another tab's change.
            notifySubscribers();
        }
    };
    window.addEventListener('storage', storageListener);
}

function releaseStorageListener() {
    if (!storageListener || subscribers.size > 0) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', storageListener);
    }
    storageListener = null;
}

export function isPushSupported() {
    return (
        typeof window !== 'undefined'
        && 'Notification' in window
        && typeof navigator !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && hasRequiredPushEnv()
    );
}

export function getPushPreference(authUid) {
    const storage = getStorage();
    if (!storage || !authUid) return null;
    const value = storage.getItem(preferenceKey(authUid));
    return value === 'enabled' || value === 'disabled' ? value : null;
}

export function subscribePushState(callback) {
    subscribers.add(callback);
    ensureStorageListener();
    return () => {
        subscribers.delete(callback);
        releaseStorageListener();
    };
}

export async function enablePushForCurrentUser({ authUid } = {}) {
    if (!isPushSupported()) {
        throw new Error('Push notifications are not supported in this environment.');
    }
    if (!authUid) {
        throw new Error('Not authenticated. Please sign in again.');
    }

    // Synchronous, unconditional, before any await.
    writePreference(authUid, 'enabled');
    const intentId = writeIntent(authUid);
    const op = makeOperation(authUid, intentId);
    notifySubscribers();

    try {
        if (Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            // No storage write after this point.
            if (!isCurrent(op)) {
                return 'aborted';
            }
            if (permission !== 'granted') {
                const error = new Error('Push permission was not granted.');
                error.code = 'PERMISSION_DENIED';
                throw error;
            }
        }

        return await reconcile(op);
    } catch (error) {
        if (isAbort(error)) return 'aborted';
        throw error;
    }
}

export async function disablePushForCurrentUser({ authUid } = {}) {
    if (!authUid) {
        throw new Error('Not authenticated. Please sign in again.');
    }

    // Synchronous, unconditional, before any await.
    writePreference(authUid, 'disabled');
    const intentId = writeIntent(authUid);
    const op = makeOperation(authUid, intentId);
    notifySubscribers();

    if (!isPushSupported() || Notification.permission !== 'granted') {
        // No token can be obtained; nothing on this device can be unregistered now.
        return 'disabled';
    }

    try {
        return await reconcile(op);
    } catch (error) {
        if (isAbort(error)) return 'aborted';
        throw error;
    }
}

export async function syncPushTokenIfGranted({ authUid } = {}) {
    if (!authUid || (clientAuth?.currentUser?.uid ?? null) !== authUid) {
        return 'skipped';
    }

    const storage = getStorage();
    if (storage) {
        storage.removeItem(LEGACY_PUSH_TOKEN_KEY);
    }

    if (!isPushSupported() || Notification.permission !== 'granted') {
        return 'skipped';
    }

    if (!getMessagingInstance()) {
        return 'skipped';
    }

    const stored = readIntent();
    const intentId = stored?.authUid === authUid && typeof stored?.id === 'string'
        ? stored.id
        : writeIntent(authUid);
    const op = makeOperation(authUid, intentId);

    try {
        return await reconcile(op);
    } catch (error) {
        if (isAbort(error)) return 'aborted';
        throw error;
    }
}

/**
 * Sign-out release: write a no-account intent, then send at most one owner-checked
 * unregister with known (or freshly read) preconditions. Never touches the preference.
 */
export async function releasePushRegistration({ timeoutMs = 3000 } = {}) {
    const user = clientAuth?.currentUser ?? null;
    const intentId = writeIntent(null);

    if (!user?.uid) {
        lastKnown = null;
        return false;
    }

    const op = {
        generation: pushGeneration,
        authUid: user.uid,
        intentId,
        user,
        cancelled: false,
        controllers: new Set(),
    };
    const known = lastKnown && lastKnown.authUid === user.uid ? lastKnown : null;

    const work = (async () => {
        let preconditions = known;
        if (!preconditions) {
            if (!isPushSupported() || Notification.permission !== 'granted') {
                return false;
            }
            const token = await obtainFcmToken(op);
            const status = await postJson(op, '/api/push/status', { token });
            if (!status.ok || !status.data?.mine) {
                return false;
            }
            preconditions = {
                token,
                epoch: status.data.epoch,
                revision: status.data.revision ?? null,
            };
        }

        const result = await postJson(op, '/api/push/unregister', {
            token: preconditions.token,
            expectedEpoch: preconditions.epoch,
            expectedRevision: preconditions.revision,
        });
        return result.ok && result.data?.changed === true;
    })().catch((error) => {
        if (!isAbort(error)) {
            console.error('Push release failed:', error);
        }
        return false;
    });

    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            op.cancelled = true;
            op.controllers.forEach((controller) => {
                try { controller.abort(); } catch { /* ignore */ }
            });
            resolve(false);
        }, timeoutMs);
    });

    try {
        return await Promise.race([work, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
        lastKnown = null;
    }
}

export function cancelPushOperations() {
    pushGeneration += 1;
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
