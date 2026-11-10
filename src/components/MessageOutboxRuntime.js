'use client';

import { useEffect } from 'react';
import { cancelOutboxDrains, clearDeliveredOrExpired, drainOutboxForUser } from '@/lib/message-outbox';

export default function MessageOutboxRuntime({ currentUser, authUid }) {
    const userId = currentUser?.id;

    useEffect(() => {
        if (!userId || !authUid) {
            return undefined;
        }

        const runDrain = () => {
            clearDeliveredOrExpired({ fromUserId: userId });
            drainOutboxForUser({ ownerUid: authUid, fromUserId: userId }).catch((error) => {
                console.error('Outbox drain failed:', error);
            });
        };

        runDrain();

        const intervalId = setInterval(runDrain, 30000);
        const onFocus = () => runDrain();
        const onOnline = () => runDrain();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                runDrain();
            }
        };

        window.addEventListener('focus', onFocus);
        window.addEventListener('online', onOnline);
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('online', onOnline);
            document.removeEventListener('visibilitychange', onVisibility);
            cancelOutboxDrains();
        };
    }, [userId, authUid]);

    return null;
}
