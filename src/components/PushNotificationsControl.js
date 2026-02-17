'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ClientProviders';
import {
    isPushSupported,
    enablePushForCurrentUser,
    disablePushForCurrentUser,
} from '@/lib/push-client';

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

export default function PushNotificationsControl({ compact = false }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [supported, setSupported] = useState(false);
    const [permission, setPermission] = useState('default');
    const [iosDevice, setIosDevice] = useState(false);
    const [standaloneMode, setStandaloneMode] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const currentPermission = typeof Notification !== 'undefined'
            ? Notification.permission
            : 'default';

        setSupported(isPushSupported());
        setPermission(currentPermission);
        setEnabled(currentPermission === 'granted');
        setIosDevice(detectIOS());
        setStandaloneMode(detectStandaloneMode());
    }, []);

    const iosInstallRequired = useMemo(
        () => iosDevice && !standaloneMode,
        [iosDevice, standaloneMode]
    );

    const togglePush = async () => {
        setLoading(true);

        try {
            if (enabled) {
                await disablePushForCurrentUser();
                setEnabled(false);
                setPermission(Notification.permission);
                showToast('Push notifications disabled.', 'success');
                return;
            }

            await enablePushForCurrentUser();
            setEnabled(true);
            setPermission(Notification.permission);
            showToast('Push notifications enabled.', 'success');
        } catch (error) {
            console.error('Push toggle failed:', error);

            if (error?.message?.includes('permission')) {
                showToast('Notifications permission is blocked. Enable it in browser settings.');
            } else {
                showToast(error?.message || 'Failed to update push notifications.');
            }

            setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'default');
        } finally {
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
                disabled={loading || iosInstallRequired}
                style={{
                    background: enabled ? '#198754' : 'var(--surface-highlight)',
                    color: enabled ? 'white' : 'var(--foreground)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: compact ? '4px 8px' : '6px 10px',
                    fontSize: compact ? '11px' : '12px',
                    cursor: loading || iosInstallRequired ? 'not-allowed' : 'pointer',
                    opacity: loading || iosInstallRequired ? 0.7 : 1,
                    whiteSpace: 'nowrap'
                }}
            >
                {loading
                    ? 'Saving...'
                    : enabled
                        ? 'Disable notifications'
                        : 'Enable notifications'}
            </button>

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
