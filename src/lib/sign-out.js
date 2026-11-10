'use client';
import { signOut } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase-client';
import { flushPendingWrites, resetLastReadState } from '@/lib/lastReadClient';
import { cancelOutboxDrains } from '@/lib/message-outbox';
import { cancelPushOperations, releasePushRegistration } from '@/lib/push-client';

const SIGN_OUT_GRACE_MS = 3000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sign out with best-effort cleanup:
 * 1. flush read markers and release this device's push registration (≤ 3s total);
 * 2. cancel realm-local outbox drains, push operations and read-marker state;
 * 3. sign out of Firebase Auth.
 */
export async function signOutCurrentUser() {
    await Promise.race([
        Promise.allSettled([
            flushPendingWrites(),
            releasePushRegistration({ timeoutMs: SIGN_OUT_GRACE_MS }),
        ]),
        sleep(SIGN_OUT_GRACE_MS),
    ]);

    cancelOutboxDrains();
    cancelPushOperations();
    resetLastReadState();

    if (clientAuth) {
        await signOut(clientAuth);
    }
}
