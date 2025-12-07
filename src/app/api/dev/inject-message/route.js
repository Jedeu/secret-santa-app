import { NextResponse } from 'next/server';
import { firestore } from '@/lib/firebase';
import { v4 as uuidv4 } from 'uuid';

/**
 * DEV-ONLY: Inject a message into Firestore for E2E testing
 * This bypasses Firestore security rules by using the Admin SDK
 * 
 * Usage: POST /api/dev/inject-message
 * Body: { fromId, toId, content, displayName? }
 */
export async function POST(request) {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { fromId, toId, content, displayName = 'Secret Santa 🎅' } = body;

        if (!fromId || !toId || !content) {
            return NextResponse.json({
                error: 'Missing required fields: fromId, toId, content'
            }, { status: 400 });
        }

        // Generate message ID and conversation ID
        // IMPORTANT: Must match the format in src/lib/message-utils.js getConversationId()
        // Format: santa_{santaId}_recipient_{recipientId}
        // In this case: fromId is Santa, toId is recipient
        const messageId = uuidv4();
        const conversationId = `santa_${fromId}_recipient_${toId}`;

        // Create the message document
        const messageData = {
            id: messageId,
            fromId,
            toId,
            conversationId,
            content,
            displayName,
            timestamp: new Date().toISOString()
        };

        // Write to Firestore using Admin SDK (bypasses security rules)
        await firestore.collection('messages').doc(messageId).set(messageData);

        return NextResponse.json({
            success: true,
            messageId,
            conversationId
        });
    } catch (error) {
        console.error('Failed to inject message:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
