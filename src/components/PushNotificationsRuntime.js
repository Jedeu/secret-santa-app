'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ClientProviders';
import {
    attachForegroundListener,
    cancelPushOperations,
    syncPushTokenIfGranted,
} from '@/lib/push-client';

export default function PushNotificationsRuntime({ currentUser, authUid }) {
    const { showToast } = useToast();
    const userId = currentUser?.id;

    useEffect(() => {
        if (!userId || !authUid) {
            return undefined;
        }

        syncPushTokenIfGranted({ authUid }).catch((error) => {
            console.error('Push token sync failed:', error);
        });

        let unsubscribe = () => { };
        try {
            unsubscribe = attachForegroundListener((payload) => {
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                    return;
                }

                const notificationBody = payload?.data?.notificationBody
                    || payload?.notification?.body
                    || 'You have a new message';
                showToast(notificationBody, 'success');
            });
        } catch (error) {
            console.error('Push foreground listener failed:', error);
        }

        return () => {
            cancelPushOperations();
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [userId, authUid, showToast]);

    return null;
}
