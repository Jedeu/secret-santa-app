'use client';
import { useState, useEffect } from 'react';
import { firestore, useClientFirestore } from '@/lib/firebase-client';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';

/**
 * Custom hook to subscribe to real-time message updates for a specific conversation
 * Falls back to polling if Firestore is not available (local dev mode)
 * 
 * @param {string} userId - Current user's ID
 * @param {string} otherUserId - Other user's ID in the conversation
 * @returns {Array} - Array of messages in the conversation
 */
export function useRealtimeMessages(userId, otherUserId) {
    const [messages, setMessages] = useState([]);
    const hasFirestore = useClientFirestore();

    useEffect(() => {
        if (!userId || !otherUserId) return;

        // If Firestore is available, use real-time listeners
        if (hasFirestore && firestore) {
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
        } else {
            // Fallback to polling for local dev (no Firestore)
            const fetchMessages = async () => {
                try {
                    const res = await fetch(`/api/messages?userId=${userId}`);
                    if (!res.ok) throw new Error('Failed to fetch messages');
                    const data = await res.json();

                    // Filter for this specific conversation
                    const relevant = data.filter(msg =>
                        (msg.fromId === userId && msg.toId === otherUserId) ||
                        (msg.fromId === otherUserId && msg.toId === userId)
                    );
                    setMessages(relevant);
                } catch (error) {
                    console.error('Error fetching messages:', error);
                }
            };

            fetchMessages();
            const interval = setInterval(fetchMessages, 2000); // Poll every 2s
            return () => clearInterval(interval);
        }
    }, [userId, otherUserId, hasFirestore]);

    return messages;
}

/**
 * Custom hook to subscribe to all messages (for public feed)
 * Falls back to polling if Firestore is not available (local dev mode)
 * 
 * @returns {Array} - Array of all messages
 */
export function useRealtimeAllMessages() {
    const [messages, setMessages] = useState([]);
    const hasFirestore = useClientFirestore();

    useEffect(() => {
        // If Firestore is available, use real-time listeners
        if (hasFirestore && firestore) {
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
        } else {
            // Fallback to polling for local dev
            const fetchMessages = async () => {
                try {
                    const res = await fetch('/api/messages');
                    if (!res.ok) throw new Error('Failed to fetch messages');
                    const data = await res.json();
                    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    setMessages(data);
                } catch (error) {
                    console.error('Error fetching all messages:', error);
                }
            };

            fetchMessages();
            const interval = setInterval(fetchMessages, 3000);
            return () => clearInterval(interval);
        }
    }, [hasFirestore]);

    return messages;
}

/**
 * Custom hook to get unread message counts
 * Falls back to polling if Firestore is not available (local dev mode)
 * 
 * @param {string} userId - Current user's ID
 * @returns {Object} - Object with recipientUnread and santaUnread counts
 */
export function useRealtimeUnreadCounts(userId) {
    const [unreadCounts, setUnreadCounts] = useState({
        recipientUnread: 0,
        santaUnread: 0
    });
    const hasFirestore = useClientFirestore();

    useEffect(() => {
        if (!userId) return;

        const fetchUnreadCounts = async () => {
            try {
                const res = await fetch(`/api/unread?userId=${userId}`);
                if (!res.ok) throw new Error('Failed to fetch unread counts');
                const data = await res.json();
                setUnreadCounts({
                    recipientUnread: data.recipientUnread || 0,
                    santaUnread: data.santaUnread || 0
                });
            } catch (error) {
                console.error('Error fetching unread counts:', error);
            }
        };

        // Note: Unread counts require server-side logic to compute based on lastRead
        // So we still poll for this, but less frequently with Firestore
        // In the future, this could be moved to a Cloud Function trigger
        fetchUnreadCounts();
        const interval = setInterval(fetchUnreadCounts, hasFirestore ? 5000 : 3000);
        return () => clearInterval(interval);
    }, [userId, hasFirestore]);

    return unreadCounts;
}
