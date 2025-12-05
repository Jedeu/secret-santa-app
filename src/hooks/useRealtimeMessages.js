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
 */
function setupAllMessagesListener() {
    // Already set up
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
        }
    );
}

/**
 * Subscribe to all messages updates
 * @param {Function} callback - Called with messages array when data changes
 * @returns {Function} - Unsubscribe function
 */
function subscribeToAllMessages(callback) {
    // Set up listener if not already done
    setupAllMessagesListener();

    // Add subscriber
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
 * @returns {Array} - Array of all messages
 */
export function useRealtimeAllMessages() {
    const [messages, setMessages] = useState(allMessagesData);

    useEffect(() => {
        // Subscribe to the singleton listener
        const unsubscribe = subscribeToAllMessages(setMessages);

        return () => {
            unsubscribe();
        };
    }, []); // Run once on mount, no dependencies

    return messages;
}

/**
 * Custom hook to get unread message counts using real-time Firestore listeners
 * Calculates unread counts client-side based on lastRead timestamps
 *
 * Uses refs to prevent listener recreation on StrictMode double-mount
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

    // Use refs to track listener state and prevent duplicates
    const listenersRef = useRef(null);
    const paramsRef = useRef({ userId, recipientId, gifterId });

    // Memoize the listener setup params to detect real changes
    const paramsChanged = useMemo(() => {
        const prev = paramsRef.current;
        const changed = prev.userId !== userId ||
            prev.recipientId !== recipientId ||
            prev.gifterId !== gifterId;
        paramsRef.current = { userId, recipientId, gifterId };
        return changed;
    }, [userId, recipientId, gifterId]);

    useEffect(() => {
        if (!userId || !firestore) return;

        // If listeners exist and params haven't changed, skip recreation
        if (listenersRef.current && !paramsChanged) {
            return;
        }

        // Clean up existing listeners if params changed
        if (listenersRef.current) {
            listenersRef.current.forEach(unsub => unsub());
        }

        // Get lastRead timestamps from localStorage
        const getLastReadTimestamp = (conversationId) => {
            const key = `lastRead_${userId}_${conversationId}`;
            return localStorage.getItem(key) || new Date(0).toISOString();
        };

        const unsubscribers = [];

        // Set up listener for recipient messages
        if (recipientId) {
            const recipientConvId = getLegacyConversationId(userId, recipientId);
            const recipientLastRead = getLastReadTimestamp(recipientConvId);

            // Expected conversation ID: I am Santa, they are Recipient
            const expectedConvId = getConversationId(userId, recipientId);

            const messagesRef = collection(firestore, 'messages');
            const q = query(
                messagesRef,
                where('fromId', '==', recipientId),
                where('toId', '==', userId),
                where('timestamp', '>', recipientLastRead)
            );

            const listenerName = `unread_recipient_${userId.slice(0, 8)}`;
            logListenerCreated(listenerName, {
                fromId: recipientId,
                toId: userId,
                lastRead: recipientLastRead
            });

            const unsubscribe = onSnapshot(
                q,
                { includeMetadataChanges: false },
                (snapshot) => {
                    let count = 0;
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        // If message has conversationId, it MUST match
                        if (data.conversationId) {
                            if (data.conversationId === expectedConvId) {
                                count++;
                            }
                        } else {
                            // Legacy message - count it
                            count++;
                        }
                    });
                    logSnapshotReceived(listenerName, snapshot.size, snapshot.metadata.fromCache, snapshot.docChanges().length);
                    setUnreadCounts(prev => ({ ...prev, recipientUnread: count }));
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

        // Set up listener for Santa messages
        if (gifterId) {
            const santaConvId = getLegacyConversationId(userId, gifterId);
            const santaLastRead = getLastReadTimestamp(santaConvId);

            // Expected conversation ID: They are Santa, I am Recipient
            const expectedConvId = getConversationId(gifterId, userId);

            const messagesRef = collection(firestore, 'messages');
            const q = query(
                messagesRef,
                where('fromId', '==', gifterId),
                where('toId', '==', userId),
                where('timestamp', '>', santaLastRead)
            );

            const listenerName = `unread_santa_${userId.slice(0, 8)}`;
            logListenerCreated(listenerName, {
                fromId: gifterId,
                toId: userId,
                lastRead: santaLastRead
            });

            const unsubscribe = onSnapshot(
                q,
                { includeMetadataChanges: false },
                (snapshot) => {
                    let count = 0;
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        // If message has conversationId, it MUST match
                        if (data.conversationId) {
                            if (data.conversationId === expectedConvId) {
                                count++;
                            }
                        } else {
                            // Legacy message - count it
                            count++;
                        }
                    });
                    logSnapshotReceived(listenerName, snapshot.size, snapshot.metadata.fromCache, snapshot.docChanges().length);
                    setUnreadCounts(prev => ({ ...prev, santaUnread: count }));
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
        listenersRef.current = unsubscribers;

        // Cleanup all subscriptions on unmount
        return () => {
            if (listenersRef.current) {
                listenersRef.current.forEach(unsub => unsub());
                listenersRef.current = null;
            }
        };
    }, [userId, recipientId, gifterId, paramsChanged]);

    return unreadCounts;
}

// Helper to update lastRead timestamp in localStorage
export function updateLastReadTimestamp(userId, otherUserId) {
    const conversationId = getLegacyConversationId(userId, otherUserId);
    const key = `lastRead_${userId}_${conversationId}`;
    localStorage.setItem(key, new Date().toISOString());

    // Note: No need to dispatch 'unread-refresh' event anymore
    // Real-time listeners automatically receive new messages
    // The unread count will naturally decrease as the lastRead timestamp advances
}
