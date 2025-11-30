
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

    return messages.filter(msg => {
        // Basic check: must involve both users
        const involvesUsers = (msg.fromId === currentUserId && msg.toId === otherUserId) ||
            (msg.fromId === otherUserId && msg.toId === currentUserId);

        if (!involvesUsers) return false;

        // If message has conversationId, it MUST match
        if (msg.conversationId) {
            return msg.conversationId === targetConversationId;
        }

        // Legacy messages (no conversationId): include them
        // This means legacy messages will appear in BOTH tabs if there is ambiguity,
        // but this is the best we can do without migrating data.
        return true;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
