import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { sendIncomingMessagePush } from '@/lib/push-server';

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

const ALREADY_EXISTS_CODES = new Set([
    'already-exists',
    6,
]);

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getBearerToken(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

function normalizeErrorCode(error) {
    const code = error?.code;

    if (typeof code === 'number') {
        return code;
    }

    if (typeof code !== 'string') {
        return null;
    }

    // Handles firestore/already-exists style codes as well as plain already-exists.
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
    return isCodeMatch(error, TRANSIENT_FIRESTORE_CODES);
}

function isAlreadyExistsError(error) {
    return isCodeMatch(error, ALREADY_EXISTS_CODES);
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

function toComparableValue(value) {
    return value === undefined ? null : value;
}

function isImmutableMessageMatch(existingMessage, incomingMessage) {
    return (
        existingMessage?.id === incomingMessage.id &&
        existingMessage?.fromId === incomingMessage.fromId &&
        existingMessage?.toId === incomingMessage.toId &&
        existingMessage?.content === incomingMessage.content &&
        toComparableValue(existingMessage?.conversationId) === toComparableValue(incomingMessage.conversationId) &&
        toComparableValue(existingMessage?.clientMessageId) === toComparableValue(incomingMessage.clientMessageId) &&
        toComparableValue(existingMessage?.clientCreatedAt) === toComparableValue(incomingMessage.clientCreatedAt)
    );
}

async function writeMessageWithIdempotency(messageRef, messageData) {
    let attempt = 0;

    while (attempt < MAX_WRITE_ATTEMPTS) {
        attempt += 1;

        try {
            await messageRef.create(messageData);
            return {
                created: true,
                message: messageData,
            };
        } catch (error) {
            if (isAlreadyExistsError(error)) {
                const existingSnapshot = await messageRef.get();
                if (!existingSnapshot.exists) {
                    throw error;
                }

                const existingMessage = existingSnapshot.data();

                if (isImmutableMessageMatch(existingMessage, messageData)) {
                    return {
                        created: false,
                        message: existingMessage,
                        replayed: true,
                    };
                }

                return {
                    created: false,
                    conflict: true,
                    message: existingMessage,
                };
            }

            if (!isTransientFirestoreError(error) || attempt >= MAX_WRITE_ATTEMPTS) {
                throw error;
            }

            await wait(WRITE_RETRY_DELAY_MS * attempt);
        }
    }

    throw new Error('Message write attempts exhausted');
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
        const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
        const clientCreatedAt = typeof body?.clientCreatedAt === 'string' ? body.clientCreatedAt.trim() : '';

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

        const messageId = clientMessageId || uuidv4();
        const messageData = {
            id: messageId,
            fromId: sender.id,
            toId,
            content,
            timestamp: new Date().toISOString(),
            conversationId: conversationId || null,
            ...(clientMessageId ? { clientMessageId } : {}),
            ...(clientCreatedAt ? { clientCreatedAt } : {}),
        };

        const messageRef = firestore.collection('messages').doc(messageId);
        const writeResult = await writeMessageWithIdempotency(messageRef, messageData);

        if (writeResult.conflict) {
            return NextResponse.json({ error: 'Message id conflict' }, { status: 409 });
        }

        // Fail-open push strategy: message delivery succeeds even if push dispatch fails.
        // Replayed idempotent requests intentionally skip push to avoid duplicate notifications.
        if (writeResult.created) {
            try {
                await sendIncomingMessagePush({
                    toUserId: toId,
                    conversationId,
                });
            } catch (pushError) {
                console.error('Push dispatch failed:', pushError);
            }
        }

        return NextResponse.json({
            success: true,
            message: writeResult.message,
            ...(writeResult.replayed ? { replayed: true } : {}),
        });
    } catch (error) {
        console.error('Send message failed:', error);

        if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
