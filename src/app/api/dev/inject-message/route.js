import { NextResponse } from 'next/server';
import { firestore } from '@/lib/firebase';
import { v4 as uuidv4 } from 'uuid';
import { assertYearOpen, admissionErrorResponse } from '@/lib/participant-admission';
import { getConversationId, resolveAuthorizedConversationId } from '@/lib/message-utils';
import { yearCollectionPath } from '@/lib/year-paths';

class InjectError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * DEV-ONLY: Inject a message into Firestore for E2E testing
 * Uses the Admin SDK (clients cannot create messages under the security rules).
 * fromId must be toId's Santa with a reciprocal assignment. Writes to the open year only
 * (YEAR_CLOSED in a closed year).
 *
 * Usage: POST /api/dev/inject-message
 * Body: { fromId, toId, content, displayName? }  (displayName is accepted but not stored)
 */
export async function POST(request) {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const { fromId, toId, content } = body;

        if (!fromId || !toId || !content) {
            return NextResponse.json({
                error: 'Missing required fields: fromId, toId, content'
            }, { status: 400 });
        }

        // IMPORTANT: Must match the format in src/lib/message-utils.js getConversationId()
        // Format: santa_{santaId}_recipient_{recipientId}; fromId is Santa, toId is recipient.
        const requestedConversationId = getConversationId(fromId, toId);
        const messageId = uuidv4();

        const message = await firestore.runTransaction(async (tx) => {
            const { year } = await assertYearOpen(tx);
            const usersCollection = firestore.collection(yearCollectionPath(year, 'users').join('/'));
            const messagesCollection = firestore.collection(yearCollectionPath(year, 'messages').join('/'));
            const [fromSnap, toSnap] = await tx.getAll(
                usersCollection.doc(fromId),
                usersCollection.doc(toId)
            );
            if (!fromSnap.exists || !toSnap.exists) {
                throw new InjectError(400, 'Both users must exist');
            }
            const fromData = fromSnap.data() || {};
            const toData = toSnap.data() || {};
            const resolved = resolveAuthorizedConversationId(
                { ...fromData, id: fromData.id ?? fromSnap.id },
                { ...toData, id: toData.id ?? toSnap.id },
                requestedConversationId
            );
            if (resolved.error) {
                throw new InjectError(400, `Invalid conversation for this pair (${resolved.error})`);
            }

            const messageData = {
                id: messageId,
                fromId,
                toId,
                content,
                timestamp: new Date().toISOString(),
                conversationId: resolved.conversationId,
            };
            tx.create(messagesCollection.doc(messageId), messageData);
            return messageData;
        });

        return NextResponse.json({
            success: true,
            messageId: message.id,
            conversationId: message.conversationId
        });
    } catch (error) {
        if (error instanceof InjectError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Failed to inject message:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
