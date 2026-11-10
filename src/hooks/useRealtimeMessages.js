'use client';
import { useState, useMemo, useEffect } from 'react';
import {
    getConversationId,
    buildViewerAssignmentMap,
    resolveMessageConversation
} from '@/lib/message-utils';
import { useRealtimeMessagesContext } from '@/context/RealtimeMessagesContext';
import {
    getLastReadTimestamp as fetchLastRead,
    getCachedTimestamp,
    subscribeToLastRead
} from '@/lib/lastReadClient';


/**
 * Hook to get all messages from the shared Context.
 *
 * @deprecated The isAuthenticated parameter is now ignored.
 *             Auth gating is handled by RealtimeMessagesProvider.
 * @param {boolean} [_isAuthenticated] - IGNORED (kept for backward compatibility)
 * @returns {Array} Array of all messages
 */
export function useRealtimeAllMessages(_isAuthenticated = false) {
    const { allMessages } = useRealtimeMessagesContext();
    return allMessages;
}

/**
 * Hook to read all-messages listener loading state from Context.
 *
 * @returns {boolean}
 */
export function useRealtimeAllMessagesLoading() {
    const { allMessagesLoading } = useRealtimeMessagesContext();
    return allMessagesLoading;
}

/**
 * Hook to get all reaction documents from shared Context.
 *
 * @returns {Array}
 */
export function useRealtimeAllReactions() {
    const { allReactions } = useRealtimeMessagesContext();
    return allReactions;
}

/**
 * Re-export updateLastReadTimestamp for implementation backward compatibility
 */
export { updateLastReadTimestamp } from '@/context/RealtimeMessagesContext';

/**
 * Subscribe to another user's last-read marker for a conversation.
 * Returns ISO timestamp string normalized by lastReadClient, or null if unavailable.
 *
 * @param {string} otherUserId
 * @param {string} conversationId
 * @returns {string | null}
 */
export function useOtherUserLastRead(otherUserId, conversationId) {
    const hasConversation = Boolean(otherUserId && conversationId);
    const lastReadKey = hasConversation ? `${otherUserId}_${conversationId}` : null;
    const [otherLastReadState, setOtherLastReadState] = useState({ key: null, value: null });

    useEffect(() => {
        if (!hasConversation) {
            return undefined;
        }

        let isMounted = true;

        fetchLastRead(otherUserId, conversationId)
            .then((value) => {
                if (isMounted) {
                    setOtherLastReadState({ key: lastReadKey, value });
                }
            })
            .catch((error) => {
                console.error('Failed to fetch other user lastRead:', error);
            });

        const unsubscribe = subscribeToLastRead(otherUserId, conversationId, (value) => {
            if (isMounted) {
                setOtherLastReadState({ key: lastReadKey, value });
            }
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [hasConversation, otherUserId, conversationId, lastReadKey]);

    if (!hasConversation) {
        return null;
    }

    if (otherLastReadState.key === lastReadKey) {
        return otherLastReadState.value;
    }

    const cached = getCachedTimestamp(otherUserId, conversationId);
    return cached !== undefined ? cached : null;
}

/**
 * Custom hook to get unread message counts using real-time Firestore listeners
 * with CLIENT-SIDE filtering against the current lastRead timestamp.
 *
 * KEY OPTIMIZATION: Firestore listeners do NOT include timestamp filters.
 * Instead, we filter client-side using the latest lastRead from cache.
 * This allows badges to clear immediately when updateLastReadTimestamp is called.
 *
 * A message counts for a tab only when it is addressed to the user, comes from that
 * tab's partner, and resolveMessageConversation (with the viewer's own assignments)
 * routes it to that tab's conversation, so a mutual pair's legacy row counts once.
 *
 * Own read markers are kept live through doc subscriptions (cross-device clearing).
 *
 * @param {string} userId - Current user's ID
 * @param {string} recipientId - User's recipient ID
 * @param {string} gifterId - User's gifter (Santa) ID
 * @returns {Object} - Object with recipientUnread and santaUnread counts
 */
export function useRealtimeUnreadCounts(userId, recipientId, gifterId) {
    const { allMessages, subscribeToLastReadChanges } = useRealtimeMessagesContext();

    // Track updates to lastRead timestamps to trigger re-calculation
    const [lastReadTick, setLastReadTick] = useState(0);

    // Compute conversation IDs
    const recipientConvId = recipientId ? getConversationId(userId, recipientId) : null;
    const santaConvId = gifterId ? getConversationId(gifterId, userId) : null;

    const viewerAssignments = useMemo(
        () => buildViewerAssignmentMap({ id: userId, recipientId, gifterId }),
        [userId, recipientId, gifterId]
    );

    // Live own-marker subscriptions (replace one-shot priming reads)
    useEffect(() => {
        if (!userId) return undefined;

        const unsubscribers = [];
        [recipientConvId, santaConvId].forEach((convId) => {
            if (!convId) return;
            unsubscribers.push(subscribeToLastRead(userId, convId, () => {
                setLastReadTick(tick => tick + 1);
            }));
        });

        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [userId, recipientConvId, santaConvId]);

    useEffect(() => {
        if (!userId) return;

        // Subscribe to lastRead changes
        const unsubscribe = subscribeToLastReadChanges((changedUserId, changedConvId) => {
            if (changedUserId !== userId) return;

            // Only trigger update if it matches one of our relevant conversations
            if (changedConvId === recipientConvId || changedConvId === santaConvId) {
                setLastReadTick(tick => tick + 1);
            }
        });

        return unsubscribe;
    }, [userId, recipientConvId, santaConvId, subscribeToLastReadChanges]);

    // Derived Recipient Unread Count
    const recipientUnread = useMemo(() => {
        if (!userId || !recipientId) return 0;
        const convId = recipientConvId || getConversationId(userId, recipientId);

        // Check cache directly. If missing (undefined), use epoch (treat "never read") to show badges.
        // This allows badges to appear even if cache priming is slow.
        const cachedLastRead = getCachedTimestamp(userId, convId);
        const lastRead = cachedLastRead !== undefined ? cachedLastRead : new Date(0).toISOString();

        // Ensure re-calculation when tick changes
        void lastReadTick;

        // Filter messages: FROM recipient TO user, routed to this conversation
        // Using allMessages from Context
        return allMessages.filter(msg => {
            if (msg.fromId !== recipientId || msg.toId !== userId) return false;

            if (resolveMessageConversation(msg, viewerAssignments).conversationId !== convId) return false;

            return new Date(msg.timestamp).getTime() > new Date(lastRead).getTime();
        }).length;
    }, [userId, recipientId, recipientConvId, allMessages, lastReadTick, viewerAssignments]);

    // Derived Santa Unread Count
    const santaUnread = useMemo(() => {
        if (!userId || !gifterId) return 0;
        const expectedConvId = santaConvId || getConversationId(gifterId, userId);

        // Check cache directly. If missing (undefined), use epoch (treat "never read") to show badges.
        // This allows badges to appear even if cache priming is slow.
        const cachedLastRead = getCachedTimestamp(userId, expectedConvId);
        const santaLastRead = cachedLastRead !== undefined ? cachedLastRead : new Date(0).toISOString();

        // Ensure re-calculation when tick changes
        void lastReadTick;

        // Filter messages: FROM santa TO user, routed to this conversation
        // Using allMessages from Context
        return allMessages.filter(msg => {
            if (msg.fromId !== gifterId || msg.toId !== userId) return false;

            if (resolveMessageConversation(msg, viewerAssignments).conversationId !== expectedConvId) return false;

            return new Date(msg.timestamp).getTime() > new Date(santaLastRead).getTime();
        }).length;
    }, [userId, gifterId, santaConvId, allMessages, lastReadTick, viewerAssignments]);

    return { recipientUnread, santaUnread };
}
