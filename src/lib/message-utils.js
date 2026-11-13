
/**
 * Generates a unique conversation ID for a Secret Santa pair.
 * The ID is deterministic based on the Santa and Recipient IDs.
 *
 * @param {string} santaId - The ID of the Santa
 * @param {string} recipientId - The ID of the Recipient
 * @returns {string} - The conversation ID
 */
export function getConversationId(santaId, recipientId) {
    if (!santaId || !recipientId) return null;
    return `santa_${santaId}_recipient_${recipientId}`;
}

/**
 * Generates a legacy conversation ID by sorting and joining user IDs.
 * Used for backward compatibility with messages that don't have conversationId.
 * This format loses directionality (who is Santa vs Recipient).
 *
 * @param {string} userId1 - First user's ID
 * @param {string} userId2 - Second user's ID
 * @returns {string} - The legacy conversation ID
 */
export function getLegacyConversationId(userId1, userId2) {
    if (!userId1 || !userId2) return null;
    return [userId1, userId2].sort().join('_');
}

/**
 * Parses a conversationId in format santa_{santaId}_recipient_{recipientId}.
 *
 * @param {string} conversationId
 * @returns {{santaId: string, recipientId: string} | null}
 */
export function parseConversationId(conversationId) {
    if (!conversationId || typeof conversationId !== 'string') return null;
    const parts = conversationId.split('_recipient_');
    if (parts.length !== 2 || !parts[0].startsWith('santa_')) return null;

    return {
        santaId: parts[0].replace('santa_', ''),
        recipientId: parts[1]
    };
}

/**
 * Builds a santaId -> recipientId map from a list of user documents.
 *
 * @param {Array<{id: string, recipientId?: string|null}>} users
 * @returns {Map<string, string>}
 */
export function buildAssignmentMap(users) {
    const map = new Map();
    if (!Array.isArray(users)) return map;
    users.forEach((user) => {
        if (user?.id && user?.recipientId) {
            map.set(user.id, user.recipientId);
        }
    });
    return map;
}

/**
 * Builds the assignment map visible to a single viewer:
 * { viewer.id -> viewer.recipientId, viewer.gifterId -> viewer.id }.
 *
 * @param {{id: string, recipientId?: string|null, gifterId?: string|null}|null} user
 * @returns {Map<string, string>}
 */
export function buildViewerAssignmentMap(user) {
    const map = new Map();
    if (!user?.id) return map;
    if (user.recipientId) {
        map.set(user.id, user.recipientId);
    }
    if (user.gifterId) {
        map.set(user.gifterId, user.id);
    }
    return map;
}

function routed(conversationSantaId, conversationRecipientId, fromId, extra) {
    return {
        conversationId: getConversationId(conversationSantaId, conversationRecipientId),
        santaId: conversationSantaId,
        recipientId: conversationRecipientId,
        isSantaMsg: fromId === conversationSantaId,
        isAmbiguous: false,
        ...extra,
    };
}

/**
 * Decides which directional conversation a message belongs to.
 *
 * Precedence:
 *  1. Missing/equal endpoints -> 'unroutable'.
 *  2. Parseable conversationId whose parties equal the endpoints -> 'explicit';
 *     parseable but mismatched -> 'unroutable'.
 *  3. Boolean isSantaMsg -> 'legacy-flag'.
 *  4. Exactly one direction matches the known assignments -> 'assignment'.
 *  5. Otherwise -> 'canonical' (smaller id is Santa; ambiguous).
 *
 * @param {object} message
 * @param {Map<string,string>|null} assignments santaId -> recipientId
 */
export function resolveMessageConversation(message, assignments) {
    const fromId = message?.fromId;
    const toId = message?.toId;

    if (!fromId || !toId || fromId === toId) {
        return {
            conversationId: 'legacy_' + (message?.id ?? 'unknown'),
            santaId: null,
            recipientId: null,
            isSantaMsg: false,
            isAmbiguous: true,
            source: 'unroutable',
        };
    }

    const parsed = parseConversationId(message.conversationId);
    if (parsed) {
        const sameParties = (parsed.santaId === fromId && parsed.recipientId === toId)
            || (parsed.santaId === toId && parsed.recipientId === fromId);
        if (sameParties) {
            return {
                conversationId: message.conversationId,
                santaId: parsed.santaId,
                recipientId: parsed.recipientId,
                isSantaMsg: parsed.santaId === fromId,
                isAmbiguous: false,
                source: 'explicit',
            };
        }
        return {
            conversationId: 'legacy_' + (message?.id ?? 'unknown'),
            santaId: null,
            recipientId: null,
            isSantaMsg: false,
            isAmbiguous: true,
            source: 'unroutable',
        };
    }

    if (typeof message.isSantaMsg === 'boolean') {
        return message.isSantaMsg
            ? routed(fromId, toId, fromId, { source: 'legacy-flag' })
            : routed(toId, fromId, fromId, { source: 'legacy-flag' });
    }

    const lookup = assignments && typeof assignments.get === 'function' ? assignments : null;
    const fromIsSanta = lookup ? lookup.get(fromId) === toId : false;
    const toIsSanta = lookup ? lookup.get(toId) === fromId : false;

    if (fromIsSanta !== toIsSanta) {
        return fromIsSanta
            ? routed(fromId, toId, fromId, { source: 'assignment' })
            : routed(toId, fromId, fromId, { source: 'assignment' });
    }

    const [santaId, recipientId] = [fromId, toId].sort();
    return {
        conversationId: getConversationId(santaId, recipientId),
        santaId,
        recipientId,
        isSantaMsg: false,
        isAmbiguous: true,
        source: 'canonical',
    };
}

/**
 * Server-side: which conversation may `sender` write to `recipient`?
 *
 * @returns {{conversationId: string} | {error: 'NOT_ASSIGNED'|'INVALID_CONVERSATION'|'AMBIGUOUS_CONVERSATION'}}
 */
export function resolveAuthorizedConversationId(sender, recipient, requestedConversationId) {
    const candidates = [];
    if (sender?.id && recipient?.id && sender.id !== recipient.id) {
        if (sender.recipientId === recipient.id && recipient.gifterId === sender.id) {
            candidates.push(getConversationId(sender.id, recipient.id));
        }
        if (sender.gifterId === recipient.id && recipient.recipientId === sender.id) {
            candidates.push(getConversationId(recipient.id, sender.id));
        }
    }

    if (!candidates.length) {
        return { error: 'NOT_ASSIGNED' };
    }

    if (requestedConversationId) {
        return candidates.includes(requestedConversationId)
            ? { conversationId: requestedConversationId }
            : { error: 'INVALID_CONVERSATION' };
    }

    if (candidates.length === 1) {
        return { conversationId: candidates[0] };
    }

    return { error: 'AMBIGUOUS_CONVERSATION' };
}

function nullable(value) {
    return value === undefined ? null : value;
}

/**
 * Single idempotency matcher for stored messages.
 * request = { id, fromId, toId, content, clientMessageId, clientCreatedAt, requestedConversationId,
 *             attachmentId }
 * `attachmentId` is compared with the stored `attachment.id` (both null-normalized), so a
 * text replay (no attachment on either side) is unaffected.
 */
export function matchesStoredMessage(existing, request) {
    if (!existing || !request) return false;
    if (existing.id !== request.id) return false;
    if (existing.fromId !== request.fromId) return false;
    if (existing.toId !== request.toId) return false;
    if (existing.content !== request.content) return false;
    if (nullable(existing.clientMessageId) !== nullable(request.clientMessageId)) return false;
    if (nullable(existing.clientCreatedAt) !== nullable(request.clientCreatedAt)) return false;
    if (nullable(existing.attachment?.id) !== nullable(request.attachmentId)) return false;
    const requested = nullable(request.requestedConversationId);
    return requested === null || requested === existing.conversationId;
}

/**
 * Latest valid message timestamp (the original ISO string), or null.
 */
export function getLatestMessageTimestamp(messages) {
    if (!Array.isArray(messages)) return null;
    let latest = null;
    let latestMs = -Infinity;
    messages.forEach((message) => {
        const value = message?.timestamp;
        if (typeof value !== 'string') return;
        const ms = Date.parse(value);
        if (Number.isNaN(ms)) return;
        if (ms > latestMs) {
            latestMs = ms;
            latest = value;
        }
    });
    return latest;
}

/**
 * Filters messages for a specific conversation, handling both new (with conversationId)
 * and legacy (without conversationId) messages via resolveMessageConversation.
 *
 * @param {Array} messages - Array of message objects
 * @param {string} currentUserId - The current user's ID
 * @param {string} otherUserId - The other user's ID
 * @param {string} targetConversationId - The expected conversation ID
 * @param {Map<string,string>|null} assignments - santaId -> recipientId (viewer map), or null
 * @returns {Array} - Filtered and sorted messages
 */
export function filterMessages(messages, currentUserId, otherUserId, targetConversationId, assignments = null) {
    if (!messages || !currentUserId || !otherUserId) return [];

    return messages.filter(msg => {
        // Basic check: must involve both users
        const involvesUsers = (msg.fromId === currentUserId && msg.toId === otherUserId) ||
            (msg.fromId === otherUserId && msg.toId === currentUserId);

        if (!involvesUsers) return false;

        return resolveMessageConversation(msg, assignments).conversationId === targetConversationId;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
