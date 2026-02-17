'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { firestore } from '@/lib/firebase-client';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { getConversationId } from '@/lib/message-utils';
import {
    logListenerCreated,
    logListenerDestroyed,
    logSnapshotReceived
} from '@/lib/firestore-listener-tracker';
import { useRealtimeMessagesContext, updateLastReadTimestamp } from '@/context/RealtimeMessagesContext';
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
    const [otherLastReadAt, setOtherLastReadAt] = useState(null);

    useEffect(() => {
        if (!otherUserId || !conversationId) {
            setOtherLastReadAt(null);
            return undefined;
        }

        let isMounted = true;
        const cached = getCachedTimestamp(otherUserId, conversationId);
        if (cached !== undefined) {
            setOtherLastReadAt(cached);
        }

        fetchLastRead(otherUserId, conversationId)
            .then((value) => {
                if (isMounted) {
                    setOtherLastReadAt(value);
                }
            })
            .catch((error) => {
                console.error('Failed to fetch other user lastRead:', error);
            });

        const unsubscribe = subscribeToLastRead(otherUserId, conversationId, (value) => {
            if (isMounted) {
                setOtherLastReadAt(value);
            }
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, [otherUserId, conversationId]);

    return otherLastReadAt;
}

/**
 * Custom hook to get unread message counts using real-time Firestore listeners
 * with CLIENT-SIDE filtering against the current lastRead timestamp.
 *
 * KEY OPTIMIZATION: Firestore listeners do NOT include timestamp filters.
 * Instead, we filter client-side using the latest lastRead from cache.
 * This allows badges to clear immediately when updateLastReadTimestamp is called.
 *
 * Uses refs to prevent listener recreation on StrictMode double-mount.
 *
 * @param {string} userId - Current user's ID
 * @param {string} recipientId - User's recipient ID
 * @param {string} gifterId - User's gifter (Santa) ID
 * @returns {Object} - Object with recipientUnread and santaUnread counts
 */
export function useRealtimeUnreadCounts(userId, recipientId, gifterId) {
    const { allMessages, subscribeToLastReadChanges, getLastReadTimestamp } = useRealtimeMessagesContext();

    // Track updates to lastRead timestamps to trigger re-calculation
    const [lastReadTick, setLastReadTick] = useState(0);

    // Compute conversation IDs
    const recipientConvId = recipientId ? getConversationId(userId, recipientId) : null;
    const santaConvId = gifterId ? getConversationId(gifterId, userId) : null;

    // [NEW] Effect to prime the cache from Firestore on mount
    useEffect(() => {
        if (!userId) return;

        const primeCache = async () => {
            // Fetch both concurrently
            const promises = [];
            if (recipientConvId) promises.push(fetchLastRead(userId, recipientConvId));
            if (santaConvId) promises.push(fetchLastRead(userId, santaConvId));

            await Promise.all(promises);
            // Force re-calculation after cache update
            setLastReadTick(tick => tick + 1);
        };

        primeCache();
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

        // Filter messages: FROM recipient TO user
        // Using allMessages from Context
        return allMessages.filter(msg => {
            if (msg.fromId !== recipientId || msg.toId !== userId) return false;

            // Strict conversation check if message has one (prevents double counting in mutual circles)
            // If msg.conversationId is missing (legacy), we rely on fromId/toId
            if (msg.conversationId && msg.conversationId !== convId) return false;

            return new Date(msg.timestamp).getTime() > new Date(lastRead).getTime();
        }).length;
    }, [userId, recipientId, recipientConvId, allMessages, lastReadTick]);

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

        // Filter messages: FROM santa TO user
        // Using allMessages from Context
        return allMessages.filter(msg => {
            if (msg.fromId !== gifterId || msg.toId !== userId) return false;

            // Match recipient logic: enforce conversationId only when present.
            // Legacy messages without conversationId should still count.
            if (msg.conversationId && msg.conversationId !== expectedConvId) return false;

            return new Date(msg.timestamp).getTime() > new Date(santaLastRead).getTime();
        }).length;
    }, [userId, gifterId, santaConvId, allMessages, lastReadTick]);

    return { recipientUnread, santaUnread };
}

// In-memory cache for lastRead timestamps (synced with lastReadClient)
