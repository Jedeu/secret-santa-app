'use client';

import { useEffect } from 'react';
import { clearDeliveredOrExpired, drainOutboxForUser } from '@/lib/message-outbox';

export default function MessageOutboxRuntime({ currentUser }) {
    useEffect(() => {
        const userId = currentUser?.id;
        if (!userId) {
            return;
        }

        const runDrain = () => {
            clearDeliveredOrExpired({ fromUserId: userId });
            drainOutboxForUser({ fromUserId: userId }).catch((error) => {
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
        };
    }, [currentUser?.id]);

    return null;
}
