
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
function parseConversationId(conversationId) {
    if (!conversationId || typeof conversationId !== 'string') return null;
    const parts = conversationId.split('_recipient_');
    if (parts.length !== 2 || !parts[0].startsWith('santa_')) return null;

    return {
        santaId: parts[0].replace('santa_', ''),
        recipientId: parts[1]
    };
}

/**
 * Filters messages for a specific conversation, handling both new (with conversationId)
 * and legacy (without conversationId) messages.
 * 
 * @param {Array} messages - Array of message objects
 * @param {string} currentUserId - The current user's ID
 * @param {string} otherUserId - The other user's ID
 * @param {string} targetConversationId - The expected conversation ID
 * @returns {Array} - Filtered and sorted messages
 */
export function filterMessages(messages, currentUserId, otherUserId, targetConversationId) {
    if (!messages || !currentUserId || !otherUserId) return [];
    const parsedTargetConversation = parseConversationId(targetConversationId);

    return messages.filter(msg => {
        // Basic check: must involve both users
        const involvesUsers = (msg.fromId === currentUserId && msg.toId === otherUserId) ||
            (msg.fromId === otherUserId && msg.toId === currentUserId);

        if (!involvesUsers) return false;

        // If message has conversationId, it MUST match
        if (msg.conversationId) {
            return msg.conversationId === targetConversationId;
        }

        // Legacy messages (no conversationId):
        // 1) If legacy role metadata exists, route by santa role.
        if (parsedTargetConversation && typeof msg.isSantaMsg === 'boolean') {
            return msg.isSantaMsg
                ? msg.fromId === parsedTargetConversation.santaId
                : msg.toId === parsedTargetConversation.santaId;
        }

        // 2) Otherwise, assign to one deterministic canonical conversation to avoid
        //    duplicate rendering in mutual cycles (A<->B santa assignments).
        //    Canonical conversation: santa=min(userId), recipient=max(userId).
        const [firstId, secondId] = [currentUserId, otherUserId].sort();
        const canonicalConversationId = getConversationId(firstId, secondId);
        return targetConversationId === canonicalConversationId;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
