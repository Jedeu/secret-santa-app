import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { sendIncomingMessagePush } from '@/lib/push-server';

function getBearerToken(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

export async function POST(request) {
    try {
        if (!adminAuth || !firestore) {
            return NextResponse.json({ error: 'Messaging service unavailable' }, { status: 503 });
        }

        const token = getBearerToken(request);
        if (!token) {
            return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });
        }

        const decodedToken = await adminAuth.verifyIdToken(token);
        const senderEmail = decodedToken?.email;

        if (!senderEmail) {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        const body = await request.json();
        const toId = typeof body?.toId === 'string' ? body.toId.trim() : '';
        const content = typeof body?.content === 'string' ? body.content.trim() : '';
        const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : null;

        if (!toId) {
            return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
        }

        if (!content) {
            return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
        }

        if (content.length > 4000) {
            return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
        }

        const senderSnapshot = await firestore.collection('users')
            .where('email', '==', senderEmail.toLowerCase())
            .limit(1)
            .get();

        if (senderSnapshot.empty) {
            return NextResponse.json({ error: 'Unauthorized sender' }, { status: 403 });
        }

        const sender = senderSnapshot.docs[0].data();
        const recipientDoc = await firestore.collection('users').doc(toId).get();

        if (!recipientDoc.exists) {
            return NextResponse.json({ error: 'Recipient not found' }, { status: 400 });
        }

        const messageData = {
            id: uuidv4(),
            fromId: sender.id,
            toId,
            content,
            timestamp: new Date().toISOString(),
            conversationId,
        };

        await firestore.collection('messages').add(messageData);

        // Fail-open push strategy: message delivery succeeds even if push dispatch fails.
        try {
            await sendIncomingMessagePush({
                toUserId: toId,
                conversationId,
            });
        } catch (pushError) {
            console.error('Push dispatch failed:', pushError);
        }

        return NextResponse.json({ success: true, message: messageData });
    } catch (error) {
        console.error('Send message failed:', error);

        if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
