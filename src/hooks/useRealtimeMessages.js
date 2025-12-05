'use client';
import { useState, useEffect } from 'react';
import { firestore } from '@/lib/firebase-client';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';

import { getConversationId, getLegacyConversationId } from '@/lib/message-utils';

/**
 * Custom hook to subscribe to real-time message updates for a specific conversation
 * 
 * @param {string} userId - Current user's ID
 * @param {string} otherUserId - Other user's ID in the conversation
 * @returns {Array} - Array of messages in the conversation
 */
export function useRealtimeMessages(userId, otherUserId) {
    const [messages, setMessages] = useState([]);

    useEffect(() => {
        if (!userId || !otherUserId || !firestore) return;

        // Instead of using OR query (which is inefficient), we'll use two separate queries
        // Query 1: Messages from userId to otherUserId
        const messagesRef = collection(firestore, 'messages');

        const q1 = query(
            messagesRef,
            where('fromId', '==', userId),
            where('toId', '==', otherUserId),
            orderBy('timestamp', 'asc')
        );

        // Query 2: Messages from otherUserId to userId
        const q2 = query(
            messagesRef,
            where('fromId', '==', otherUserId),
            where('toId', '==', userId),
            orderBy('timestamp', 'asc')
        );

        // Combine messages from both queries
        let msgs1 = [];
        let msgs2 = [];

        const unsubscribe1 = onSnapshot(q1, (snapshot) => {
            msgs1 = [];
            snapshot.forEach((doc) => {
                msgs1.push(doc.data());
            });
            // Merge and sort
            const allMsgs = [...msgs1, ...msgs2];
            allMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            setMessages(allMsgs);
        }, (error) => {
            console.error('Error in real-time message listener (sent):', error);
        });

        const unsubscribe2 = onSnapshot(q2, (snapshot) => {
            msgs2 = [];
            snapshot.forEach((doc) => {
                msgs2.push(doc.data());
            });
            // Merge and sort
            const allMsgs = [...msgs1, ...msgs2];
            allMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            setMessages(allMsgs);
        }, (error) => {
            console.error('Error in real-time message listener (received):', error);
        });

        // Cleanup both subscriptions on unmount
        return () => {
            unsubscribe1();
            unsubscribe2();
        };
    }, [userId, otherUserId]);

    return messages;
}

/**
 * Custom hook to subscribe to all messages (for public feed)
 * 
 * @returns {Array} - Array of all messages
 */
export function useRealtimeAllMessages(user) {
    const [messages, setMessages] = useState([]);

    useEffect(() => {
        if (!firestore || !user) return;

        const messagesRef = collection(firestore, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'desc'));

        // Subscribe to real-time updates
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = [];
            snapshot.forEach((doc) => {
                msgs.push(doc.data());
            });
            setMessages(msgs);
        }, (error) => {
            console.error('Error in real-time all messages listener:', error);
        });

        return () => unsubscribe();
    }, [user]);

    return messages;
}

/**
 * Custom hook to get unread message counts using real-time Firestore listeners
 * Calculates unread counts client-side based on lastRead timestamps
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
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        const handleRefresh = () => setRefreshTrigger(prev => prev + 1);
        window.addEventListener('unread-refresh', handleRefresh);

        if (!userId || !firestore) return;

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

            const unsubscribe = onSnapshot(q, (snapshot) => {
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
                setUnreadCounts(prev => ({ ...prev, recipientUnread: count }));
            }, (error) => {
                console.error('Error in recipient unread listener:', error);
            });

            unsubscribers.push(unsubscribe);
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

            const unsubscribe = onSnapshot(q, (snapshot) => {
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
                setUnreadCounts(prev => ({ ...prev, santaUnread: count }));
            }, (error) => {
                console.error('Error in Santa unread listener:', error);
            });

            unsubscribers.push(unsubscribe);
        }

        // Cleanup all subscriptions on unmount
        return () => {
            window.removeEventListener('unread-refresh', handleRefresh);
            unsubscribers.forEach(unsub => unsub());
        };
    }, [userId, recipientId, gifterId, refreshTrigger]);

    return unreadCounts;
}

// Helper to update lastRead timestamp in localStorage
export function updateLastReadTimestamp(userId, otherUserId) {
    const conversationId = getLegacyConversationId(userId, otherUserId);
    const key = `lastRead_${userId}_${conversationId}`;
    localStorage.setItem(key, new Date().toISOString());

    // Dispatch event so the rest of the app knows a read happened
    window.dispatchEvent(new Event('unread-refresh'));
}
