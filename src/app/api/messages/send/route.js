import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { sendIncomingMessagePush } from '@/lib/push-server';
import {
    verifyRequestToken,
    runFencedTransaction,
    admissionErrorResponse,
} from '@/lib/participant-admission';
import {
    resolveAuthorizedConversationId,
    matchesStoredMessage,
} from '@/lib/message-utils';
import { yearCollectionPath } from '@/lib/year-paths';

const MAX_WRITE_ATTEMPTS = 3;
const WRITE_RETRY_DELAY_MS = 120;

const TRANSIENT_FIRESTORE_CODES = new Set([
    'aborted',
    'deadline-exceeded',
    'internal',
    'resource-exhausted',
    'unavailable',
    10,
    4,
    13,
    8,
    14,
]);

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Typed route error raised inside the transaction; never retried.
 */
class SendRouteError extends Error {
    constructor(status, body) {
        super(body?.error || 'Send failed');
        this.name = 'SendRouteError';
        this.status = status;
        this.body = body;
    }
}

function normalizeErrorCode(error) {
    const code = error?.code;

    if (typeof code === 'number') {
        return code;
    }

    if (typeof code !== 'string') {
        return null;
    }

    // Handles firestore/unavailable style codes as well as plain unavailable.
    if (code.includes('/')) {
        return code.split('/').pop();
    }

    return code;
}

function isCodeMatch(error, expectedCodes) {
    const normalizedCode = normalizeErrorCode(error);
    if (normalizedCode === null) {
        return false;
    }

    if (expectedCodes.has(normalizedCode)) {
        return true;
    }

    // Coerce numeric strings into numbers for grpc code compatibility.
    const asNumber = Number(normalizedCode);
    if (!Number.isNaN(asNumber) && expectedCodes.has(asNumber)) {
        return true;
    }

    return false;
}

function isTransientFirestoreError(error) {
    if (error instanceof SendRouteError || error?.isAdmissionError) {
        return false;
    }
    return isCodeMatch(error, TRANSIENT_FIRESTORE_CODES);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isISODateString(value) {
    if (typeof value !== 'string') {
        return false;
    }
    return !Number.isNaN(Date.parse(value));
}

function isUUIDLike(value) {
    return UUID_V4_REGEX.test(value);
}

export async function POST(request) {
    try {
        if (!adminAuth || !firestore) {
            return NextResponse.json({ error: 'Messaging service unavailable' }, { status: 503 });
        }

        const decodedToken = await verifyRequestToken(request);

        const body = await request.json();
        const toId = typeof body?.toId === 'string' ? body.toId.trim() : '';
        const content = typeof body?.content === 'string' ? body.content.trim() : '';
        const requestedConversationId = typeof body?.conversationId === 'string' && body.conversationId.trim()
            ? body.conversationId.trim()
            : null;
        const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
        const clientCreatedAt = typeof body?.clientCreatedAt === 'string' ? body.clientCreatedAt.trim() : '';
        const senderUserId = typeof body?.senderUserId === 'string' && body.senderUserId.trim()
            ? body.senderUserId.trim()
            : null;

        if (!toId) {
            return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
        }

        if (!content) {
            return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
        }

        if (content.length > 4000) {
            return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
        }

        if (clientMessageId && !isUUIDLike(clientMessageId)) {
            return NextResponse.json({ error: 'clientMessageId must be a valid UUID' }, { status: 400 });
        }

        if (clientCreatedAt && !isISODateString(clientCreatedAt)) {
            return NextResponse.json({ error: 'clientCreatedAt must be an ISO timestamp' }, { status: 400 });
        }

        // Generated outside the transaction so retries keep the same id.
        const messageId = clientMessageId || uuidv4();

        // Fenced on the open year (YEAR_CLOSED otherwise); refs use that year's paths.
        const work = async (tx, { user: sender, year }) => {
            const recipientRef = firestore.collection(yearCollectionPath(year, 'users').join('/')).doc(toId);
            const messageRef = firestore.collection(yearCollectionPath(year, 'messages').join('/')).doc(messageId);
            const [recipientSnap, messageSnap] = await tx.getAll(recipientRef, messageRef);

            if (senderUserId && senderUserId !== sender.id) {
                throw new SendRouteError(403, {
                    error: 'Sender does not match the signed-in account',
                    code: 'SENDER_MISMATCH',
                });
            }

            if (messageSnap.exists) {
                const existing = messageSnap.data();
                const matches = matchesStoredMessage(existing, {
                    id: messageId,
                    fromId: sender.id,
                    toId,
                    content,
                    clientMessageId: clientMessageId || null,
                    clientCreatedAt: clientCreatedAt || null,
                    requestedConversationId,
                });
                if (matches) {
                    return { kind: 'replayed', message: existing };
                }
                throw new SendRouteError(409, { error: 'Message id conflict' });
            }

            if (!recipientSnap.exists) {
                throw new SendRouteError(400, { error: 'Recipient not found' });
            }

            const recipientData = recipientSnap.data() || {};
            const recipient = { ...recipientData, id: recipientData.id ?? recipientSnap.id };
            const resolved = resolveAuthorizedConversationId(sender, recipient, requestedConversationId);
            if (resolved.error) {
                throw new SendRouteError(400, {
                    error: 'Invalid conversation for this recipient',
                    code: resolved.error,
                });
            }

            const message = {
                id: messageId,
                fromId: sender.id,
                toId,
                content,
                timestamp: new Date().toISOString(),
                conversationId: resolved.conversationId,
                ...(clientMessageId ? { clientMessageId } : {}),
                ...(clientCreatedAt ? { clientCreatedAt } : {}),
            };
            tx.create(messageRef, message);
            return { kind: 'created', message };
        };

        let result = null;
        let attempt = 0;
        while (!result) {
            attempt += 1;
            try {
                result = await runFencedTransaction(decodedToken, work);
            } catch (error) {
                if (!isTransientFirestoreError(error) || attempt >= MAX_WRITE_ATTEMPTS) {
                    throw error;
                }
                await wait(WRITE_RETRY_DELAY_MS * attempt);
            }
        }

        // Fail-open push strategy: message delivery succeeds even if push dispatch fails.
        // Replayed idempotent requests intentionally skip push to avoid duplicate notifications.
        if (result.kind === 'created') {
            try {
                await sendIncomingMessagePush({
                    toUserId: result.message.toId,
                    conversationId: result.message.conversationId,
                    fromUserId: result.message.fromId,
                });
            } catch (pushError) {
                console.error('Push dispatch failed:', pushError);
            }
        }

        return NextResponse.json({
            success: true,
            message: result.message,
            ...(result.kind === 'replayed' ? { replayed: true } : {}),
        });
    } catch (error) {
        if (error instanceof SendRouteError) {
            return NextResponse.json(error.body, { status: error.status });
        }

        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Send message failed:', error);

        if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
