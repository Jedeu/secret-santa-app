'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { firestore } from '@/lib/firebase-client';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { getConversationId, getLegacyConversationId } from '@/lib/message-utils';
import {
    logListenerCreated,
    logListenerDestroyed,
    logSnapshotReceived
} from '@/lib/firestore-listener-tracker';
import {
    updateLastReadTimestamp as firestoreUpdateLastRead,
    getCachedTimestamp as getCachedLastRead
} from '@/lib/lastReadClient';

/**
 * =============================================================================
 * SINGLETON LISTENER MANAGER
 * =============================================================================
 *
 * This module uses a singleton pattern for the "all messages" listener to prevent
 * duplicate listeners when components remount (e.g., React.StrictMode double-mount).
 *
 * Key optimization: Only ONE listener for all messages exists at any time,
 * shared across all components that need it.
 */

// Global state for the singleton all-messages listener
let allMessagesListener = null;
let allMessagesData = [];
let allMessagesSubscribers = new Set();
let allMessagesListenerSetup = false;

/**
 * Set up the singleton all-messages listener
 * Only creates a new listener if one doesn't exist
 *
 * IMPORTANT: This should only be called when the user is authenticated.
 * If called before auth completes, Firestore security rules will reject the request.
 */
function setupAllMessagesListener() {
    // Already set up or no firestore
    if (allMessagesListenerSetup || !firestore) return;

    allMessagesListenerSetup = true;

    const messagesRef = collection(firestore, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'));

    logListenerCreated('allMessages', { query: 'orderBy(timestamp, desc)' });

    allMessagesListener = onSnapshot(
        q,
        { includeMetadataChanges: false }, // Reduce unnecessary updates
        (snapshot) => {
            const msgs = [];
            snapshot.forEach((doc) => {
                msgs.push(doc.data());
            });

            // Count actual document changes (this is what Firestore charges for)
            const changedDocs = snapshot.docChanges().length;

            // Log snapshot with cache info and actual read count
            logSnapshotReceived(
                'allMessages',
                snapshot.size,
                snapshot.metadata.fromCache,
                changedDocs // Show how many docs actually changed (= reads charged)
            );

            allMessagesData = msgs;

            // Notify all subscribers
            allMessagesSubscribers.forEach(callback => callback(msgs));
        },
        (error) => {
            console.error('Error in real-time all messages listener:', error);
            // Reset flag on permission error to allow retry when authenticated
            if (error.code === 'permission-denied') {
                console.warn('[Firestore] Auth not ready, will retry when authenticated');
                allMessagesListenerSetup = false;
                allMessagesListener = null;
            }
        }
    );
}

/**
 * Subscribe to all messages updates
 * @param {Function} callback - Called with messages array when data changes
 * @param {boolean} isAuthenticated - Whether the user is authenticated
 * @returns {Function} - Unsubscribe function
 */
function subscribeToAllMessages(callback, isAuthenticated) {
    // Only set up listener when authenticated
    if (isAuthenticated) {
        setupAllMessagesListener();
    }

    // Add subscriber (even if not yet authenticated - will receive data when ready)
    allMessagesSubscribers.add(callback);

    // Immediately call with current data if available
    if (allMessagesData.length > 0) {
        callback(allMessagesData);
    }

    // Return unsubscribe function
    return () => {
        allMessagesSubscribers.delete(callback);

        // If no more subscribers, we could clean up the listener
        // But keeping it alive avoids re-reading all data on next mount
        // This is a trade-off: keeps connection open but saves reads

        // Uncomment below to clean up when all subscribers leave:
        // if (allMessagesSubscribers.size === 0 && allMessagesListener) {
        //     logListenerDestroyed('allMessages');
        //     allMessagesListener();
        //     allMessagesListener = null;
        //     allMessagesListenerSetup = false;
        //     allMessagesData = [];
        // }
    };
}

/**
 * Custom hook to subscribe to real-time message updates for a specific conversation
 *
 * @param {string} userId - Current user's ID
 * @param {string} otherUserId - Other user's ID in the conversation
 * @returns {Array} - Array of messages in the conversation
 */
export function useRealtimeMessages(userId, otherUserId) {
    const [messages, setMessages] = useState([]);

    // Use refs to track if this specific instance has created listeners
    const listenersCreatedRef = useRef(false);

    useEffect(() => {
        if (!userId || !otherUserId || !firestore) return;

        // Prevent duplicate listener creation on StrictMode double-mount
        if (listenersCreatedRef.current) {
            return;
        }
        listenersCreatedRef.current = true;

        const listenerName = `messages_${userId.slice(0, 8)}_${otherUserId.slice(0, 8)}`;

        // Instead of using OR query (which is inefficient), we'll use two separate queries
        const messagesRef = collection(firestore, 'messages');

        const q1 = query(
            messagesRef,
            where('fromId', '==', userId),
            where('toId', '==', otherUserId),
            orderBy('timestamp', 'asc')
        );

        const q2 = query(
            messagesRef,
            where('fromId', '==', otherUserId),
            where('toId', '==', userId),
            orderBy('timestamp', 'asc')
        );

        // Combine messages from both queries
        let msgs1 = [];
        let msgs2 = [];

        logListenerCreated(`${listenerName}_sent`, { fromId: userId, toId: otherUserId });

        const unsubscribe1 = onSnapshot(
            q1,
            { includeMetadataChanges: false },
            (snapshot) => {
                msgs1 = [];
                snapshot.forEach((doc) => {
                    msgs1.push(doc.data());
                });
                logSnapshotReceived(`${listenerName}_sent`, snapshot.size, snapshot.metadata.fromCache, snapshot.docChanges().length);
                // Merge and sort
                const allMsgs = [...msgs1, ...msgs2];
                allMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                setMessages(allMsgs);
            },
            (error) => {
                console.error('Error in real-time message listener (sent):', error);
            }
        );

        logListenerCreated(`${listenerName}_received`, { fromId: otherUserId, toId: userId });

        const unsubscribe2 = onSnapshot(
            q2,
            { includeMetadataChanges: false },
            (snapshot) => {
                msgs2 = [];
                snapshot.forEach((doc) => {
                    msgs2.push(doc.data());
                });
                logSnapshotReceived(`${listenerName}_received`, snapshot.size, snapshot.metadata.fromCache, snapshot.docChanges().length);
                // Merge and sort
                const allMsgs = [...msgs1, ...msgs2];
                allMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                setMessages(allMsgs);
            },
            (error) => {
                console.error('Error in real-time message listener (received):', error);
            }
        );

        // Cleanup both subscriptions on unmount
        return () => {
            logListenerDestroyed(`${listenerName}_sent`);
            logListenerDestroyed(`${listenerName}_received`);
            unsubscribe1();
            unsubscribe2();
            listenersCreatedRef.current = false;
        };
    }, [userId, otherUserId]);

    return messages;
}

/**
 * Custom hook to subscribe to all messages (for public feed)
 * Uses singleton pattern to prevent duplicate listeners on remount
 *
 * IMPORTANT: Pass isAuthenticated=true only when user is authenticated.
 * This prevents Firestore permission errors on fresh login.
 *
 * @param {boolean} isAuthenticated - Whether the user is authenticated (default: false)
 * @returns {Array} - Array of all messages
 */
export function useRealtimeAllMessages(isAuthenticated = false) {
    const [messages, setMessages] = useState(allMessagesData);

    useEffect(() => {
        // Subscribe to the singleton listener
        const unsubscribe = subscribeToAllMessages(setMessages, isAuthenticated);

        return () => {
            unsubscribe();
        };
    }, [isAuthenticated]); // Re-run when auth state changes

    return messages;
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
    const [unreadCounts, setUnreadCounts] = useState({
        recipientUnread: 0,
        santaUnread: 0
    });

    // Store raw messages from listeners (before timestamp filtering)
    const recipientMessagesRef = useRef([]);
    const santaMessagesRef = useRef([]);

    // Use refs to track listener state and prevent duplicates
    const listenersRef = useRef(null);

    /**
     * Recalculate ONLY recipient unread count from stored messages using CURRENT lastRead.
     * Called when:
     *   1. Recipient Firestore listener receives new messages
     *   2. updateLastReadTimestamp is called for the recipient conversation (via subscriber)
     */
    const recalculateRecipientCount = useMemo(() => {
        return () => {
            if (!userId || !recipientId) return;

            // Use NEW conversationId format for both lastRead lookup AND message filtering
            const expectedConvId = getConversationId(userId, recipientId);
            const recipientLastRead = getLastReadTimestamp(userId, expectedConvId);

            console.log('[BADGE-DEBUG] recalculateRecipientCount:', {
                userId: userId.slice(0, 8),
                recipientId: recipientId.slice(0, 8),
                expectedConvId,
                recipientLastRead,
                totalMessages: recipientMessagesRef.current.length
            });

            const recipientUnread = recipientMessagesRef.current.filter(msg => {
                // Must be newer than lastRead
                if (msg.timestamp <= recipientLastRead) return false;

                // Must match expected conversationId
                return msg.conversationId === expectedConvId;
            }).length;

            console.log('[BADGE-DEBUG] Recipient unread count:', recipientUnread);
            setUnreadCounts(prev => ({ ...prev, recipientUnread }));
        };
    }, [userId, recipientId]);

    /**
     * Recalculate ONLY santa unread count from stored messages using CURRENT lastRead.
     * Called when:
     *   1. Santa Firestore listener receives new messages
     *   2. updateLastReadTimestamp is called for the santa conversation (via subscriber)
     */
    const recalculateSantaCount = useMemo(() => {
        return () => {
            if (!userId || !gifterId) return;

            // Use NEW conversationId format for both lastRead lookup AND message filtering
            const expectedConvId = getConversationId(gifterId, userId);
            const santaLastRead = getLastReadTimestamp(userId, expectedConvId);

            console.log('[BADGE-DEBUG] recalculateSantaCount:', {
                userId: userId.slice(0, 8),
                gifterId: gifterId.slice(0, 8),
                expectedConvId,
                santaLastRead,
                totalMessages: santaMessagesRef.current.length
            });

            const santaUnread = santaMessagesRef.current.filter(msg => {
                // Must be newer than lastRead
                if (msg.timestamp <= santaLastRead) return false;

                // Must match expected conversationId
                return msg.conversationId === expectedConvId;
            }).length;

            console.log('[BADGE-DEBUG] Santa unread count:', santaUnread);
            setUnreadCounts(prev => ({ ...prev, santaUnread }));
        };
    }, [userId, gifterId]);

    /**
     * Recalculate both counts. Called when both listeners need to recalculate
     * (e.g., on initial mount).
     */
    const recalculateBothCounts = useMemo(() => {
        return () => {
            recalculateRecipientCount();
            recalculateSantaCount();
        };
    }, [recalculateRecipientCount, recalculateSantaCount]);

    useEffect(() => {
        if (!userId || !firestore) return;

        // If listeners exist, skip recreation (effect deps handle recreation)
        if (listenersRef.current) {
            return;
        }

        const unsubscribers = [];

        // Compute conversation IDs for comparison in subscriber
        // Use NEW format to match how messages are stored
        const recipientConvId = recipientId ? getConversationId(userId, recipientId) : null;
        const santaConvId = gifterId ? getConversationId(gifterId, userId) : null;

        // Subscribe to lastRead changes for recalculation
        // IMPORTANT: Only recalculate the specific badge whose conversation changed
        // This prevents cross-contamination where visiting one tab clears both badges
        const unsubscribeLastRead = subscribeToLastReadChanges((changedUserId, changedConvId, timestamp) => {
            // Only process if this change affects our user
            if (changedUserId !== userId) return;

            // DEBUG: Log conversation ID comparison
            console.log('[BADGE-DEBUG] lastRead changed:', {
                changedConvId,
                recipientConvId,
                santaConvId,
                matchesRecipient: changedConvId === recipientConvId,
                matchesSanta: changedConvId === santaConvId
            });

            // Check which conversation changed and only recalculate that badge
            if (changedConvId === recipientConvId) {
                console.log('[BADGE-DEBUG] Recalculating RECIPIENT badge only');
                recalculateRecipientCount();
            } else if (changedConvId === santaConvId) {
                console.log('[BADGE-DEBUG] Recalculating SANTA badge only');
                recalculateSantaCount();
            } else {
                console.log('[BADGE-DEBUG] No match - skipping recalculation');
            }
            // If neither matches, it's a different conversation - no action needed
        });
        unsubscribers.push(unsubscribeLastRead);

        // Set up listener for recipient messages (messages FROM recipient TO me)
        // NOTE: No timestamp filter! We fetch ALL and filter client-side.
        if (recipientId) {
            const messagesRef = collection(firestore, 'messages');
            const q = query(
                messagesRef,
                where('fromId', '==', recipientId),
                where('toId', '==', userId)
            );

            const listenerName = `unread_recipient_${userId.slice(0, 8)}`;
            logListenerCreated(listenerName, {
                fromId: recipientId,
                toId: userId,
                note: 'No timestamp filter - client-side filtering'
            });

            const unsubscribe = onSnapshot(
                q,
                { includeMetadataChanges: false },
                (snapshot) => {
                    // Store all messages (will filter by timestamp client-side)
                    const messages = [];
                    snapshot.forEach(doc => {
                        messages.push(doc.data());
                    });
                    recipientMessagesRef.current = messages;

                    logSnapshotReceived(listenerName, snapshot.size, snapshot.metadata.fromCache, snapshot.docChanges().length);

                    // Recalculate recipient count with current lastRead
                    recalculateRecipientCount();
                },
                (error) => {
                    console.error('Error in recipient unread listener:', error);
                }
            );

            unsubscribers.push(() => {
                logListenerDestroyed(listenerName);
                unsubscribe();
            });
        }

        // Set up listener for Santa messages (messages FROM santa/gifter TO me)
        // NOTE: No timestamp filter! We fetch ALL and filter client-side.
        if (gifterId) {
            const messagesRef = collection(firestore, 'messages');
            const q = query(
                messagesRef,
                where('fromId', '==', gifterId),
                where('toId', '==', userId)
            );

            const listenerName = `unread_santa_${userId.slice(0, 8)}`;
            logListenerCreated(listenerName, {
                fromId: gifterId,
                toId: userId,
                note: 'No timestamp filter - client-side filtering'
            });

            const unsubscribe = onSnapshot(
                q,
                { includeMetadataChanges: false },
                (snapshot) => {
                    // Store all messages (will filter by timestamp client-side)
                    const messages = [];
                    snapshot.forEach(doc => {
                        messages.push(doc.data());
                    });
                    santaMessagesRef.current = messages;

                    logSnapshotReceived(listenerName, snapshot.size, snapshot.metadata.fromCache, snapshot.docChanges().length);

                    // Recalculate santa count with current lastRead
                    recalculateSantaCount();
                },
                (error) => {
                    console.error('Error in Santa unread listener:', error);
                }
            );

            unsubscribers.push(() => {
                logListenerDestroyed(listenerName);
                unsubscribe();
            });
        }

        // Store unsubscribers in ref
        listenersRef.current = { unsubscribers };

        // Cleanup all subscriptions on unmount
        return () => {
            if (listenersRef.current) {
                listenersRef.current.unsubscribers.forEach(unsub => unsub());
                listenersRef.current = null;
            }
            // Clear message refs
            recipientMessagesRef.current = [];
            santaMessagesRef.current = [];
        };
    }, [userId, recipientId, gifterId, recalculateRecipientCount, recalculateSantaCount]);

    return unreadCounts;
}

// In-memory cache for lastRead timestamps (synced with lastReadClient)
const lastReadCache = new Map();

/**
 * =============================================================================
 * LASTREAD CHANGE NOTIFICATION
 * =============================================================================
 * Subscribers that want to be notified when lastRead timestamps change.
 * This enables client-side recalculation of unread counts without
 * recreating Firestore listeners.
 */

const lastReadSubscribers = new Set();

/**
 * Subscribe to lastRead timestamp changes.
 * Called whenever updateLastReadTimestamp updates the cache.
 *
 * @param {Function} callback - Called with (userId, conversationId, timestamp)
 * @returns {Function} - Unsubscribe function
 */
function subscribeToLastReadChanges(callback) {
    lastReadSubscribers.add(callback);
    return () => {
        lastReadSubscribers.delete(callback);
    };
}

/**
 * Notify all subscribers that a lastRead timestamp has changed.
 * Called by updateLastReadTimestamp after updating the cache.
 *
 * @param {string} userId - The user whose lastRead changed
 * @param {string} conversationId - The conversation ID (legacy format)
 * @param {string} timestamp - The new ISO timestamp
 */
function notifyLastReadChange(userId, conversationId, timestamp) {
    lastReadSubscribers.forEach(callback => {
        try {
            callback(userId, conversationId, timestamp);
        } catch (error) {
            console.error('Error in lastRead subscriber:', error);
        }
    });
}

/**
 * Get lastRead timestamp from cache or Firestore.
 * This is used internally by useRealtimeUnreadCounts.
 *
 * @param {string} userId - Current user's ID
 * @param {string} conversationId - The conversation ID
 * @returns {string} - ISO timestamp string, or epoch if not found
 */
function getLastReadTimestamp(userId, conversationId) {
    const key = `${userId}_${conversationId}`;

    // Check local cache first
    if (lastReadCache.has(key)) {
        return lastReadCache.get(key);
    }

    // Check Firestore client cache
    const cached = getCachedLastRead(userId, conversationId);
    if (cached) {
        lastReadCache.set(key, cached);
        return cached;
    }

    // Fall back to localStorage for backwards compatibility with existing data
    const localStorageKey = `lastRead_${userId}_${conversationId}`;
    const localValue = typeof window !== 'undefined' ? localStorage.getItem(localStorageKey) : null;
    if (localValue) {
        lastReadCache.set(key, localValue);
        return localValue;
    }

    // Default to epoch if not found anywhere
    return new Date(0).toISOString();
}

/**
 * Update lastRead timestamp.
 * Writes to Firestore (debounced) and updates local cache immediately.
 *
 * @param {string} userId - Current user's ID
 * @param {string} otherUserId - The other user's ID in the conversation (DEPRECATED - kept for backwards compat)
 * @param {string} conversationId - The conversation ID (NEW format: santa_X_recipient_Y)
 */
export function updateLastReadTimestamp(userId, otherUserId, conversationId = null) {
    // If conversationId is not provided, fall back to legacy format
    // This maintains backwards compatibility with old call sites
    const convId = conversationId || getLegacyConversationId(userId, otherUserId);
    const now = new Date().toISOString();

    console.log('[BADGE-DEBUG] updateLastReadTimestamp called:', {
        userId: userId.slice(0, 8),
        otherUserId: otherUserId ? otherUserId.slice(0, 8) : 'N/A',
        conversationId: convId,
        timestamp: now,
        isNewFormat: !!conversationId
    });

    // Update local cache immediately for responsive UI
    const key = `${userId}_${convId}`;
    lastReadCache.set(key, now);

    // Also update localStorage for backwards compatibility
    if (typeof window !== 'undefined') {
        const localStorageKey = `lastRead_${userId}_${convId}`;
        localStorage.setItem(localStorageKey, now);
    }

    // Notify subscribers that lastRead has changed
    // This triggers client-side recalculation of unread counts
    notifyLastReadChange(userId, convId, now);

    // Write to Firestore (debounced)
    firestoreUpdateLastRead(userId, convId);
}
