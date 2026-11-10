import { NextResponse } from 'next/server';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { unregisterPushToken } from '@/lib/push-server';
import { verifyRequestToken, admissionErrorResponse } from '@/lib/participant-admission';

function isValidPushToken(token) {
    if (typeof token !== 'string') return false;

    const normalized = token.trim();
    return normalized.length >= 20 && normalized.length <= 4096;
}

function hasOwn(object, key) {
    return !!object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
}

function isValidExpectedEpoch(value) {
    return Number.isInteger(value) && value > 0;
}

function isValidExpectedRevision(value) {
    return value === null || typeof value === 'string';
}

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

        if (!hasOwn(body, 'expectedEpoch') || !hasOwn(body, 'expectedRevision')) {
            return NextResponse.json({
                error: 'expectedEpoch and expectedRevision are required',
                code: 'PRECONDITION_REQUIRED',
            }, { status: 400 });
        }

        if (!isValidExpectedEpoch(body.expectedEpoch) || !isValidExpectedRevision(body.expectedRevision)) {
            return NextResponse.json({
                error: 'expectedEpoch must be a positive integer and expectedRevision a string or null',
                code: 'INVALID_PRECONDITION',
            }, { status: 400 });
        }

        const result = await unregisterPushToken({
            decodedToken,
            token: pushToken,
            expectedEpoch: body.expectedEpoch,
            expectedRevision: body.expectedRevision,
        });

        return NextResponse.json({
            success: true,
            epoch: result.epoch,
            revision: result.revision,
            changed: result.changed,
        });
    } catch (error) {
        if (error?.code === 'STALE_REGISTRATION') {
            return NextResponse.json({ error: error.message, code: 'STALE_REGISTRATION' }, { status: 409 });
        }

        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Push unregister failed:', error);

        if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to unregister push token' }, { status: 500 });
    }
}
