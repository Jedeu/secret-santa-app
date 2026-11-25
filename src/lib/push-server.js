import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { firestore, messaging } from '@/lib/firebase';
import { getConversationId } from '@/lib/message-utils';
import { resolveParticipant, runFencedTransaction } from '@/lib/participant-admission';
import { buildPushNotification, describeMessage, getReceiverChat } from '@/lib/push-copy';
import { yearCollectionPath } from '@/lib/year-paths';

const PUSH_TOKENS_COLLECTION = 'pushTokens';
const NOTIFICATION_ICON = '/icons/icon-192x192.png';
// Monochrome silhouette: Android draws the badge as a white mask in the status bar.
const NOTIFICATION_BADGE = '/icons/badge-96x96.png';

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

function toIsoTimestamp(value) {
    if (typeof value === 'string') {
        return Number.isNaN(Date.parse(value)) ? null : value;
    }
    if (value && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }
    return null;
}

/**
 * Unread messages to `userId` in each conversation: those after the user's lastRead
 * marker, or all of them without one. Needs the messages (conversationId, toId,
 * timestamp) index in firestore.indexes.json.
 *
 * @returns {Promise<number[]>} one count per conversation id, in order
 */
async function countUnread(db, year, userId, conversationIds) {
    const lastReadCollection = db.collection(yearCollectionPath(year, 'lastRead').join('/'));
    const messagesCollection = db.collection(yearCollectionPath(year, 'messages').join('/'));
    const markers = await db.getAll(
        ...conversationIds.map((id) => lastReadCollection.doc(`${userId}_${id}`))
    );

    return Promise.all(conversationIds.map(async (id, index) => {
        const marker = markers[index];
        const since = toIsoTimestamp(marker?.exists ? marker.data()?.lastReadAt : null);
        let query = messagesCollection
            .where('conversationId', '==', id)
            .where('toId', '==', userId);
        if (since) {
            query = query.where('timestamp', '>', since);
        }
        const snapshot = await query.count().get();
        return snapshot.data().count;
    }));
}

/** The receiver's other conversation: as Santa when this message reached them as recipient, and the reverse. */
function getOtherConversationId(chat, toUserId, receiver) {
    if (chat === 'santa') return getConversationId(toUserId, receiver?.recipientId);
    if (chat === 'recipient') return getConversationId(receiver?.gifterId, toUserId);
    return null;
}

/**
 * Unread count of this chat and across both of the receiver's chats, or nulls when the
 * count cannot be read (for instance before the index is deployed). Never throws: the
 * notification goes out either way.
 */
async function getUnreadCounts({ year, message, receiver, chat }) {
    if (!chat) return { unread: null, unreadTotal: null };
    const otherId = getOtherConversationId(chat, message.toId, receiver);
    const ids = otherId && otherId !== message.conversationId
        ? [message.conversationId, otherId]
        : [message.conversationId];
    try {
        const counts = await countUnread(firestore, year, message.toId, ids);
        return {
            // The message that triggered this push is unread by definition.
            unread: Math.max(counts[0], 1),
            unreadTotal: Math.max(counts.reduce((sum, count) => sum + count, 0), 1),
        };
    } catch (error) {
        console.warn('Push unread count unavailable:', error?.code ?? 'unknown');
        return { unread: null, unreadTotal: null };
    }
}

/**
 * The FCM payload for one message, minus tokens. No user id, conversation id, name,
 * photo or attachment URL is included anywhere: only the receiver-side chat and kind.
 */
export function buildIncomingMessagePayload({ message, unread = null, unreadTotal = null }) {
    const chat = getReceiverChat(message);
    const { kind, text } = describeMessage(message);
    const { title, body } = buildPushNotification({ chat, kind, text, unread });

    return {
        notification: { title, body },
        data: {
            type: 'incoming_message',
            chat: chat || '',
            kind,
            title,
            body,
            unreadTotal: Number.isInteger(unreadTotal) ? String(unreadTotal) : '',
        },
        webpush: {
            fcmOptions: {
                link: chat ? `/?chat=${chat}` : '/',
            },
            notification: {
                tag: chat ? `chat-${chat}` : 'chat',
                renotify: true,
                icon: NOTIFICATION_ICON,
                badge: NOTIFICATION_BADGE,
            },
        },
    };
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

/**
 * @param {{ year: number, message: object, receiver?: { recipientId?: string, gifterId?: string } }} args
 *   message: the stored message; receiver: the assignments of the user it was sent to.
 */
export async function sendIncomingMessagePush({ year, message, receiver = null }) {
    const toUserId = message?.toId;
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
    const chat = getReceiverChat(message);
    const { unread, unreadTotal } = await getUnreadCounts({ year, message, receiver, chat });

    const fcmResponse = await messaging.sendEachForMulticast({
        tokens,
        ...buildIncomingMessagePayload({ message, unread, unreadTotal }),
    });

    const cleanedTokenCount = await cleanupInvalidTokens({ epoch, sent, fcmResponse });

    return {
        totalTokens: tokens.length,
        successCount: fcmResponse.successCount,
        failureCount: fcmResponse.failureCount,
        cleanedTokenCount,
    };
}
