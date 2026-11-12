'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ClientProviders';
import {
    isPushSupported,
    getPushPreference,
    subscribePushState,
    enablePushForCurrentUser,
    disablePushForCurrentUser,
    retryPushRegistration,
    isPushTimeoutError,
} from '@/lib/push-client';

const ENABLE_NOT_REGISTERED_NOTE = 'Notifications are on, but this device is not registered yet. It will retry the next time the app opens.';
const DISABLE_NOT_FINISHED_NOTE = 'Notifications are off. This device will finish unregistering the next time the app opens.';
const ENABLE_TIMED_OUT_NOTE = 'Notification setup timed out before this device was confirmed. Tap Try again, or it will retry the next time the app opens.';
const PERMISSION_NOT_GRANTED_NOTE = 'Notifications are not allowed on this device yet. Tap Enable notifications to try again.';

function detectIOS() {
    if (typeof navigator === 'undefined') return false;

    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function detectStandaloneMode() {
    if (typeof window === 'undefined') return false;

    const mediaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
    const iosStandalone = window.navigator?.standalone === true;

    return Boolean(mediaStandalone || iosStandalone);
}

function readPermission() {
    return typeof Notification !== 'undefined' ? Notification.permission : 'default';
}

function isPermissionError(error) {
    if (isPushTimeoutError(error)) return false;
    return error?.code === 'PERMISSION_DENIED' || Boolean(error?.message?.includes('permission'));
}

/**
 * Feedback for a failed enable or retry, evaluated when the attempt settles.
 * @returns {{ text: string, retry: boolean } | null}
 */
function enableFailureNote(error, uid) {
    // A newer disable elsewhere wins; never bring back stale "enabled" text.
    if (getPushPreference(uid) !== 'enabled') return null;

    const permission = readPermission();
    // The existing blocked hint shows instead.
    if (permission === 'denied') return null;
    if (permission !== 'granted') {
        return { text: PERMISSION_NOT_GRANTED_NOTE, retry: false };
    }

    if (isPushTimeoutError(error)) {
        return {
            text: error.stage ? `${ENABLE_TIMED_OUT_NOTE} (step: ${error.stage})` : ENABLE_TIMED_OUT_NOTE,
            retry: true,
        };
    }

    return { text: ENABLE_NOT_REGISTERED_NOTE, retry: true };
}

/**
 * Per-device push toggle. Desired state is this account's stored preference, changed
 * only by this toggle (in any tab); effective = desired 'enabled' + permission granted.
 */
export default function PushNotificationsControl({ compact = false, authUid = null }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [preference, setPreference] = useState(null);
    const [supported, setSupported] = useState(false);
    const [permission, setPermission] = useState('default');
    const [iosDevice, setIosDevice] = useState(false);
    const [standaloneMode, setStandaloneMode] = useState(false);
    // { text: string, retry: boolean } | null
    const [registrationNote, setRegistrationNote] = useState(null);
    const lastPreferenceRef = useRef(null);
    // Only the latest attempt for the current account may touch the UI after an await.
    const attemptRef = useRef(0);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        // Browser-only capabilities must be synced after mount; deriving them
        // during render would mismatch the server-rendered HTML on hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSupported(isPushSupported());
        setPermission(readPermission());
        setIosDevice(detectIOS());
        setStandaloneMode(detectStandaloneMode());
    }, []);

    // Desired state follows this account's preference, including changes from other tabs.
    useEffect(() => {
        const sync = () => {
            const next = getPushPreference(authUid);
            if (next !== lastPreferenceRef.current) {
                lastPreferenceRef.current = next;
                setRegistrationNote(null);
            }
            setPreference(next);
            setPermission(readPermission());
        };

        sync();
        const unsubscribe = subscribePushState(sync);

        return () => {
            unsubscribe();
            // Account change or unmount: a pending attempt's late result must not touch
            // this UI. Starts no async work.
            attemptRef.current += 1;
            setLoading(false);
            setRegistrationNote(null);
        };
    }, [authUid]);

    const iosInstallRequired = useMemo(
        () => iosDevice && !standaloneMode,
        [iosDevice, standaloneMode]
    );

    const effectiveEnabled = preference === 'enabled' && permission === 'granted';

    const refreshAfterAttempt = (uid) => {
        const next = getPushPreference(uid);
        lastPreferenceRef.current = next;
        setPreference(next);
        setPermission(readPermission());
        setLoading(false);
    };

    const togglePush = async () => {
        if (!authUid) return;
        const attempt = ++attemptRef.current;
        const uid = authUid;
        const isLive = () => attemptRef.current === attempt;
        setLoading(true);
        setRegistrationNote(null);

        const disabling = effectiveEnabled;

        try {
            if (disabling) {
                const result = await disablePushForCurrentUser({ authUid: uid });
                if (isLive() && result !== 'aborted') {
                    showToast('Push notifications disabled.', 'success');
                }
                return;
            }

            const result = await enablePushForCurrentUser({ authUid: uid });
            if (isLive() && result !== 'aborted') {
                showToast('Push notifications enabled.', 'success');
            }
        } catch (error) {
            console.error('Push toggle failed:', error);
            if (!isLive()) return;

            if (disabling) {
                if (getPushPreference(uid) === 'disabled') {
                    setRegistrationNote({ text: DISABLE_NOT_FINISHED_NOTE, retry: false });
                }
            } else if (isPermissionError(error)) {
                showToast('Notifications permission is blocked. Enable it in browser settings.');
            } else {
                setRegistrationNote(enableFailureNote(error, uid));
            }
        } finally {
            if (isLive()) refreshAfterAttempt(uid);
        }
    };

    const retryRegistration = async () => {
        if (!authUid || loading) return;
        const attempt = ++attemptRef.current;
        const uid = authUid;
        const isLive = () => attemptRef.current === attempt;
        setLoading(true);
        setRegistrationNote(null);

        try {
            const result = await retryPushRegistration({ authUid: uid });
            if (isLive() && result === 'registered') {
                showToast('Push notifications enabled.', 'success');
            }
        } catch (error) {
            console.error('Push registration retry failed:', error);
            if (isLive()) {
                setRegistrationNote(enableFailureNote(error, uid));
            }
        } finally {
            if (isLive()) refreshAfterAttempt(uid);
        }
    };

    const showRetry = Boolean(registrationNote?.retry) && preference === 'enabled' && permission === 'granted';

    if (!supported) {
        return (
            <span style={{ fontSize: compact ? '11px' : '12px', color: 'var(--text-muted)' }}>
                Notifications unavailable
            </span>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: compact ? 'flex-start' : 'stretch' }}>
            <button
                type="button"
                onClick={togglePush}
                disabled={loading || iosInstallRequired || !authUid}
                style={{
                    background: effectiveEnabled ? '#198754' : 'var(--surface-highlight)',
                    color: effectiveEnabled ? 'white' : 'var(--foreground)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: compact ? '4px 8px' : '6px 10px',
                    fontSize: compact ? '11px' : '12px',
                    cursor: loading || iosInstallRequired || !authUid ? 'not-allowed' : 'pointer',
                    opacity: loading || iosInstallRequired || !authUid ? 0.7 : 1,
                    whiteSpace: 'nowrap'
                }}
            >
                {loading
                    ? 'Saving...'
                    : effectiveEnabled
                        ? 'Disable notifications'
                        : 'Enable notifications'}
            </button>

            {registrationNote && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: compact ? '180px' : 'none' }}>
                    {registrationNote.text}
                </span>
            )}

            {showRetry && (
                <button
                    type="button"
                    onClick={retryRegistration}
                    disabled={loading || !authUid}
                    style={{
                        background: 'var(--surface-highlight)',
                        color: 'var(--foreground)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: compact ? '4px 8px' : '6px 10px',
                        fontSize: compact ? '11px' : '12px',
                        cursor: loading || !authUid ? 'not-allowed' : 'pointer',
                        opacity: loading || !authUid ? 0.7 : 1,
                    }}
                >
                    Try again
                </button>
            )}

            {iosInstallRequired && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: compact ? '180px' : 'none' }}>
                    Install to Home Screen to enable iOS notifications.
                </span>
            )}

            {!iosInstallRequired && permission === 'denied' && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: compact ? '180px' : 'none' }}>
                    Browser permission is blocked. Enable notifications in settings.
                </span>
            )}
        </div>
    );
}
