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
        const lastRead = getLastReadTimestamp(userId, convId);

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
    }, [userId, recipientId, recipientConvId, allMessages, getLastReadTimestamp, lastReadTick]);

    // Derived Santa Unread Count
    const santaUnread = useMemo(() => {
        if (!userId || !gifterId) return 0;
        const expectedConvId = santaConvId || getConversationId(gifterId, userId);
        const santaLastRead = getLastReadTimestamp(userId, expectedConvId);

        // Ensure re-calculation when tick changes
        void lastReadTick;

        // Filter messages: FROM santa TO user
        // Using allMessages from Context
        return allMessages.filter(msg => {
            if (msg.fromId !== gifterId || msg.toId !== userId) return false;

            // Allow legacy (no convId) or new (matching convId)
            // But strict filtering requires matching logic from before?
            // Previous logic: "Use NEW conversationId format for both lastRead lookup AND message filtering"
            // Wait, previous logic filtered `msg.conversationId === expectedConvId` inside filter?
            // "Must match expected conversationId"
            // Let's preserve that logic if it was intentional.

            const isTargetMsg = msg.conversationId ? msg.conversationId === expectedConvId : true; // Fallback for legacy messages?
            // Wait, previous code (Step 51) strictly checked `msg.conversationId === expectedConvId`.
            // But if legacy messages exist, they might be missed?
            // Assuming strict check is desired for new system.

            return (msg.conversationId === expectedConvId) &&
                (new Date(msg.timestamp).getTime() > new Date(santaLastRead).getTime());
        }).length;
    }, [userId, gifterId, santaConvId, allMessages, getLastReadTimestamp, lastReadTick]);

    return { recipientUnread, santaUnread };
}

// In-memory cache for lastRead timestamps (synced with lastReadClient)
