import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { firestore, messaging } from '@/lib/firebase';
import { parseConversationId } from '@/lib/message-utils';
import { resolveParticipant, runFencedTransaction } from '@/lib/participant-admission';

const PUSH_TOKENS_COLLECTION = 'pushTokens';
const NOTIFICATION_ICON = '/icons/icon-192x192.png';

const INVALID_TOKEN_ERROR_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);
const GENERIC_MESSAGE_BODY = 'You have a new message';
const SANTA_MESSAGE_BODY = 'You have a new message from Santa';
const RECIPIENT_MESSAGE_BODY = 'You have a new message from your recipient';

function hashPushToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function normalizeToken(token) {
    return typeof token === 'string' ? token.trim() : '';
}

function requireFirestore() {
    if (!firestore) {
        throw new Error('Push token storage unavailable');
    }
    return firestore;
}

function tokenRef(db, token) {
    return db.collection(PUSH_TOKENS_COLLECTION).doc(hashPushToken(token));
}

function lifecycleRef(db) {
    return db.collection('system').doc('lifecycle');
}

function staleRegistrationError() {
    const error = new Error('Push registration changed; refresh and try again');
    error.code = 'STALE_REGISTRATION';
    error.status = 409;
    return error;
}

function zeroResult(extra = {}) {
    return {
        totalTokens: 0,
        successCount: 0,
        failureCount: 0,
        cleanedTokenCount: 0,
        ...extra,
    };
}

function resolveSenderRole({ conversationId, fromUserId }) {
    if (!fromUserId) {
        return '';
    }

    const parsedConversation = parseConversationId(conversationId);
    if (!parsedConversation) {
        return '';
    }

    if (fromUserId === parsedConversation.santaId) {
        return 'santa';
    }

    if (fromUserId === parsedConversation.recipientId) {
        return 'recipient';
    }

    return '';
}

function getNotificationBody(senderRole) {
    if (senderRole === 'santa') {
        return SANTA_MESSAGE_BODY;
    }

    if (senderRole === 'recipient') {
        return RECIPIENT_MESSAGE_BODY;
    }

    return GENERIC_MESSAGE_BODY;
}

/**
 * Dispatch gate:
 * - PUSH_DISPATCH_ENABLED === 'false' -> always off (hard override)
 * - PUSH_DISPATCH_ENABLED === 'true'  -> always on
 * - otherwise production only, and never when an emulator host is configured.
 */
export function isPushDispatchEnabled() {
    const flag = process.env.PUSH_DISPATCH_ENABLED;
    if (flag === 'false') return false;
    if (flag === 'true') return true;
    return process.env.NODE_ENV === 'production'
        && !process.env.FIRESTORE_EMULATOR_HOST
        && !process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

function assertPreconditions(ctx, current, { expectedEpoch, expectedRevision }) {
    if (expectedEpoch !== ctx.epoch || expectedRevision !== current) {
        throw staleRegistrationError();
    }
}

export async function getPushRegistrationStatus({ decodedToken, token }) {
    const db = requireFirestore();
    const { user, epoch } = await resolveParticipant(decodedToken);
    const snapshot = await tokenRef(db, normalizeToken(token)).get();
    const doc = snapshot.exists ? snapshot.data() : null;

    return {
        epoch,
        revision: doc?.revision ?? null,
        mine: !!doc && doc.userId === user.id,
        enabled: doc?.enabled === true,
    };
}

export async function registerPushToken({
    decodedToken,
    token,
    expectedEpoch,
    expectedRevision,
    enabled = true,
    userAgent = null,
}) {
    const db = requireFirestore();
    const normalizedToken = normalizeToken(token);
    const ref = tokenRef(db, normalizedToken);
    const desired = enabled === true;

    return runFencedTransaction(decodedToken, async (tx, ctx) => {
        const snapshot = await tx.get(ref);
        const doc = snapshot.exists ? snapshot.data() : null;
        const current = doc?.revision ?? null;
        assertPreconditions(ctx, current, { expectedEpoch, expectedRevision });

        const now = new Date().toISOString();
        const revision = uuidv4();

        // Always writes (even when owner and enabled are unchanged) so the revision
        // rotates and any earlier request against the previous revision gets 409.
        tx.set(ref, {
            userId: ctx.user.id,
            authUid: ctx.uid,
            token: normalizedToken,
            enabled: desired,
            platform: 'web',
            userAgent: userAgent || null,
            createdAt: doc?.createdAt ?? now,
            updatedAt: now,
            revision,
            epoch: ctx.epoch,
        });

        return { epoch: ctx.epoch, revision, enabled: desired };
    }, { allowClosed: true });
}

export async function unregisterPushToken({ decodedToken, token, expectedEpoch, expectedRevision }) {
    const db = requireFirestore();
    const normalizedToken = normalizeToken(token);
    const ref = tokenRef(db, normalizedToken);

    return runFencedTransaction(decodedToken, async (tx, ctx) => {
        const snapshot = await tx.get(ref);
        const doc = snapshot.exists ? snapshot.data() : null;
        const current = doc?.revision ?? null;
        assertPreconditions(ctx, current, { expectedEpoch, expectedRevision });

        if (!doc || doc.userId !== ctx.user.id) {
            return { epoch: ctx.epoch, revision: current, changed: false };
        }

        const revision = uuidv4();
        tx.update(ref, {
            enabled: false,
            revision,
            updatedAt: new Date().toISOString(),
        });

        return { epoch: ctx.epoch, revision, changed: true };
    }, { allowClosed: true });
}

/**
 * Disable rows whose FCM response reported an invalid registration, but only when the
 * lifecycle is still active at the dispatch's captured epoch and the row still carries
 * the revision captured at dispatch time. Never creates rows.
 *
 * @param {{ epoch: number, sent: Array<{token: string, revision: string|null}>, fcmResponse: object }} args
 * @returns {Promise<number>} rows updated
 */
export async function cleanupInvalidTokens({ epoch, sent, fcmResponse } = {}) {
    if (!firestore || !Array.isArray(sent) || !Array.isArray(fcmResponse?.responses)) {
        return 0;
    }

    const candidates = [];
    const seen = new Set();
    fcmResponse.responses.forEach((response, index) => {
        if (response?.success) {
            return;
        }

        const code = response?.error?.code;
        if (!INVALID_TOKEN_ERROR_CODES.has(code)) {
            return;
        }

        const entry = sent[index];
        const token = normalizeToken(entry?.token);
        if (!token || seen.has(token)) {
            return;
        }
        seen.add(token);

        candidates.push({
            ref: tokenRef(firestore, token),
            revision: entry?.revision ?? null,
        });
    });

    if (!candidates.length) {
        return 0;
    }

    return firestore.runTransaction(async (tx) => {
        const [lifecycleSnap, ...rowSnaps] = await tx.getAll(
            lifecycleRef(firestore),
            ...candidates.map((candidate) => candidate.ref)
        );

        const lifecycle = lifecycleSnap?.exists ? lifecycleSnap.data() : null;
        if (!lifecycle || lifecycle.state !== 'active' || lifecycle.epoch !== epoch) {
            return 0;
        }

        const now = new Date().toISOString();
        let updated = 0;
        rowSnaps.forEach((rowSnap, index) => {
            if (!rowSnap?.exists) return;
            const rowRevision = rowSnap.data()?.revision ?? null;
            if (rowRevision !== candidates[index].revision) return;

            tx.update(candidates[index].ref, {
                enabled: false,
                invalid: true,
                revision: uuidv4(),
                updatedAt: now,
            });
            updated += 1;
        });

        return updated;
    });
}

export async function sendIncomingMessagePush({ toUserId, conversationId = null, fromUserId = null }) {
    if (!isPushDispatchEnabled()) {
        return zeroResult({ skipped: 'disabled' });
    }

    if (!firestore || !messaging) {
        throw new Error('Push messaging unavailable');
    }

    const lifecycleSnap = await lifecycleRef(firestore).get();
    const lifecycle = lifecycleSnap?.exists ? lifecycleSnap.data() : null;
    if (!lifecycle || lifecycle.state !== 'active') {
        return zeroResult({ skipped: 'inactive' });
    }
    const epoch = lifecycle.epoch;

    const tokenSnapshot = await firestore
        .collection(PUSH_TOKENS_COLLECTION)
        .where('userId', '==', toUserId)
        .where('enabled', '==', true)
        .get();

    if (tokenSnapshot.empty) {
        return zeroResult();
    }

    const sent = [];
    const seen = new Set();
    tokenSnapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        const token = normalizeToken(data.token);
        if (!token || seen.has(token)) return;
        seen.add(token);
        sent.push({ token, revision: data.revision ?? null });
    });

    if (!sent.length) {
        return zeroResult();
    }

    const tokens = sent.map((entry) => entry.token);
    const senderRole = resolveSenderRole({ conversationId, fromUserId });
    const notificationBody = getNotificationBody(senderRole);

    const fcmResponse = await messaging.sendEachForMulticast({
        tokens,
        notification: {
            title: 'Secret Santa',
            body: notificationBody,
        },
        data: {
            type: 'incoming_message',
            conversationId: conversationId || '',
            senderRole,
            notificationBody,
        },
        webpush: {
            fcmOptions: {
                link: '/',
            },
            notification: {
                tag: conversationId ? `conversation-${conversationId}` : 'conversation',
                icon: NOTIFICATION_ICON,
                badge: NOTIFICATION_ICON,
            },
        },
    });

    const cleanedTokenCount = await cleanupInvalidTokens({ epoch, sent, fcmResponse });

    return {
        totalTokens: tokens.length,
        successCount: fcmResponse.successCount,
        failureCount: fcmResponse.failureCount,
        cleanedTokenCount,
    };
}
