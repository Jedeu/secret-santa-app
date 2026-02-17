'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ClientProviders';
import {
    attachForegroundListener,
    syncPushTokenIfGranted,
} from '@/lib/push-client';

export default function PushNotificationsRuntime({ currentUser }) {
    const { showToast } = useToast();

    useEffect(() => {
        if (!currentUser?.id) {
            return;
        }

        syncPushTokenIfGranted().catch((error) => {
            console.error('Push token sync failed:', error);
        });

        const unsubscribe = attachForegroundListener((payload) => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }

            const notificationBody = payload?.data?.notificationBody
                || payload?.notification?.body
                || 'You have a new message';
            showToast(notificationBody, 'success');
        });

        return () => {
            unsubscribe();
        };
    }, [currentUser?.id, showToast]);

    return null;
}
