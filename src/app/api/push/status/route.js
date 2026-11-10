import { NextResponse } from 'next/server';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { getPushRegistrationStatus } from '@/lib/push-server';
import { verifyRequestToken, admissionErrorResponse } from '@/lib/participant-admission';

function isValidPushToken(token) {
    if (typeof token !== 'string') return false;

    const normalized = token.trim();
    return normalized.length >= 20 && normalized.length <= 4096;
}

/**
 * Report this device token's registration state: { epoch, revision, mine, enabled }.
 * Push mutations must present the returned epoch and revision.
 */
export async function POST(request) {
    try {
        if (!adminAuth || !firestore) {
            return NextResponse.json({ error: 'Push service unavailable' }, { status: 503 });
        }

        const decodedToken = await verifyRequestToken(request);

        const body = await request.json();
        const pushToken = typeof body?.token === 'string' ? body.token.trim() : '';

        if (!isValidPushToken(pushToken)) {
            return NextResponse.json({ error: 'Invalid push token' }, { status: 400 });
        }

        const status = await getPushRegistrationStatus({ decodedToken, token: pushToken });

        return NextResponse.json({
            success: true,
            epoch: status.epoch,
            revision: status.revision,
            mine: status.mine,
            enabled: status.enabled,
        });
    } catch (error) {
        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Push status failed:', error);

        if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to read push status' }, { status: 500 });
    }
}
