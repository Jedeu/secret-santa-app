'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ClientProviders';
import {
    isPushSupported,
    getPushPreference,
    subscribePushState,
    enablePushForCurrentUser,
    disablePushForCurrentUser,
} from '@/lib/push-client';

const ENABLE_NOT_REGISTERED_NOTE = 'Notifications are on, but this device is not registered yet. It will retry the next time the app opens.';
const DISABLE_NOT_FINISHED_NOTE = 'Notifications are off. This device will finish unregistering the next time the app opens.';

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
    return error?.code === 'PERMISSION_DENIED' || Boolean(error?.message?.includes('permission'));
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
    const [registrationNote, setRegistrationNote] = useState(null);
    const lastPreferenceRef = useRef(null);

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
        return subscribePushState(sync);
    }, [authUid]);

    const iosInstallRequired = useMemo(
        () => iosDevice && !standaloneMode,
        [iosDevice, standaloneMode]
    );

    const effectiveEnabled = preference === 'enabled' && permission === 'granted';

    const togglePush = async () => {
        if (!authUid) return;
        setLoading(true);
        setRegistrationNote(null);

        const disabling = effectiveEnabled;

        try {
            if (disabling) {
                const result = await disablePushForCurrentUser({ authUid });
                if (result !== 'aborted') {
                    showToast('Push notifications disabled.', 'success');
                }
                return;
            }

            const result = await enablePushForCurrentUser({ authUid });
            if (result !== 'aborted') {
                showToast('Push notifications enabled.', 'success');
            }
        } catch (error) {
            console.error('Push toggle failed:', error);

            if (disabling) {
                setRegistrationNote(DISABLE_NOT_FINISHED_NOTE);
            } else if (isPermissionError(error)) {
                showToast('Notifications permission is blocked. Enable it in browser settings.');
            } else {
                setRegistrationNote(ENABLE_NOT_REGISTERED_NOTE);
            }
        } finally {
            setPermission(readPermission());
            setPreference(getPushPreference(authUid));
            lastPreferenceRef.current = getPushPreference(authUid);
            setLoading(false);
        }
    };

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
                    {registrationNote}
                </span>
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
