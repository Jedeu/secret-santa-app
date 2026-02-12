import { createHash } from 'node:crypto';
import { firestore, messaging } from '@/lib/firebase';

const PUSH_TOKENS_COLLECTION = 'pushTokens';

const INVALID_TOKEN_ERROR_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);

function hashPushToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function normalizeToken(token) {
    return typeof token === 'string' ? token.trim() : '';
}

export async function registerPushToken({ userId, token, userAgent = null }) {
    if (!firestore) {
        throw new Error('Push token storage unavailable');
    }

    const normalizedToken = normalizeToken(token);
    const now = new Date().toISOString();
    const tokenDocId = hashPushToken(normalizedToken);
    const tokenRef = firestore.collection(PUSH_TOKENS_COLLECTION).doc(tokenDocId);
    const existingDoc = await tokenRef.get();

    const createdAt = existingDoc.exists
        ? (existingDoc.data()?.createdAt || now)
        : now;

    await tokenRef.set({
        userId,
        token: normalizedToken,
        enabled: true,
        platform: 'web',
        userAgent: userAgent || null,
        createdAt,
        updatedAt: now,
    }, { merge: true });
}

export async function unregisterPushToken({ userId, token }) {
    if (!firestore) {
        throw new Error('Push token storage unavailable');
    }

    const normalizedToken = normalizeToken(token);
    const tokenDocId = hashPushToken(normalizedToken);
    const tokenRef = firestore.collection(PUSH_TOKENS_COLLECTION).doc(tokenDocId);
    const existingDoc = await tokenRef.get();

    if (!existingDoc.exists) {
        return false;
    }

    if (existingDoc.data()?.userId !== userId) {
        return false;
    }

    await tokenRef.set({
        enabled: false,
        updatedAt: new Date().toISOString(),
    }, { merge: true });

    return true;
}

export async function cleanupInvalidTokens(tokens, fcmResponse) {
    if (!firestore || !Array.isArray(tokens) || !fcmResponse?.responses) {
        return 0;
    }

    const docsToDelete = [];

    fcmResponse.responses.forEach((response, index) => {
        if (response?.success) {
            return;
        }

        const code = response?.error?.code;
        if (!INVALID_TOKEN_ERROR_CODES.has(code)) {
            return;
        }

        const token = normalizeToken(tokens[index]);
        if (!token) {
            return;
        }

        docsToDelete.push(
            firestore.collection(PUSH_TOKENS_COLLECTION).doc(hashPushToken(token))
        );
    });

    if (!docsToDelete.length) {
        return 0;
    }

    const batch = firestore.batch();
    docsToDelete.forEach((docRef) => batch.delete(docRef));
    await batch.commit();

    return docsToDelete.length;
}

export async function sendIncomingMessagePush({ toUserId, conversationId = null }) {
    if (!firestore || !messaging) {
        throw new Error('Push messaging unavailable');
    }

    const tokenSnapshot = await firestore
        .collection(PUSH_TOKENS_COLLECTION)
        .where('userId', '==', toUserId)
        .where('enabled', '==', true)
        .get();

    if (tokenSnapshot.empty) {
        return {
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            cleanedTokenCount: 0,
        };
    }

    const tokens = Array.from(new Set(
        tokenSnapshot.docs
            .map((doc) => normalizeToken(doc.data()?.token))
            .filter(Boolean)
    ));

    if (!tokens.length) {
        return {
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            cleanedTokenCount: 0,
        };
    }

    const fcmResponse = await messaging.sendEachForMulticast({
        tokens,
        notification: {
            title: 'Secret Santa',
            body: 'You have a new message',
        },
        data: {
            type: 'incoming_message',
            conversationId: conversationId || '',
        },
        webpush: {
            fcmOptions: {
                link: '/',
            },
            notification: {
                tag: conversationId ? `conversation-${conversationId}` : 'conversation',
            },
        },
    });

    const cleanedTokenCount = await cleanupInvalidTokens(tokens, fcmResponse);

    return {
        totalTokens: tokens.length,
        successCount: fcmResponse.successCount,
        failureCount: fcmResponse.failureCount,
        cleanedTokenCount,
    };
}
