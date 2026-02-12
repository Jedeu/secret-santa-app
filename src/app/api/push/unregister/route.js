import { NextResponse } from 'next/server';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { unregisterPushToken } from '@/lib/push-server';

function getBearerToken(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    return authHeader.substring(7);
}

function isValidPushToken(token) {
    if (typeof token !== 'string') return false;

    const normalized = token.trim();
    return normalized.length >= 20 && normalized.length <= 4096;
}

export async function POST(request) {
    try {
        if (!adminAuth || !firestore) {
            return NextResponse.json({ error: 'Push service unavailable' }, { status: 503 });
        }

        const bearerToken = getBearerToken(request);
        if (!bearerToken) {
            return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });
        }

        const decodedToken = await adminAuth.verifyIdToken(bearerToken);
        const senderEmail = decodedToken?.email;

        if (!senderEmail) {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        const body = await request.json();
        const pushToken = typeof body?.token === 'string' ? body.token.trim() : '';

        if (!isValidPushToken(pushToken)) {
            return NextResponse.json({ error: 'Invalid push token' }, { status: 400 });
        }

        const senderSnapshot = await firestore.collection('users')
            .where('email', '==', senderEmail.toLowerCase())
            .limit(1)
            .get();

        if (senderSnapshot.empty) {
            return NextResponse.json({ error: 'Unauthorized sender' }, { status: 403 });
        }

        const sender = senderSnapshot.docs[0].data();

        await unregisterPushToken({
            userId: sender.id,
            token: pushToken,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Push unregister failed:', error);

        if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to unregister push token' }, { status: 500 });
    }
}
