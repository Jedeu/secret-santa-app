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

        const unsubscribe = attachForegroundListener(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }

            showToast('You have a new message.', 'success');
        });

        return () => {
            unsubscribe();
        };
    }, [currentUser?.id, showToast]);

    return null;
}
