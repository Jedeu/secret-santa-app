'use client';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { firestore } from '@/lib/firebase-client';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { useUser } from '@/hooks/useUser';
import { logListenerCreated, logListenerDestroyed, logSnapshotReceived } from '@/lib/firestore-listener-tracker';
import { updateLastReadTimestamp as lastReadClientUpdate, getCachedTimestamp } from '@/lib/lastReadClient';
import { getConversationId, getLegacyConversationId } from '@/lib/message-utils';

const RealtimeMessagesContext = createContext(null);

export function useRealtimeMessagesContext() {
    const context = useContext(RealtimeMessagesContext);
    if (context === null) {
        throw new Error('useRealtimeMessagesContext must be used within a RealtimeMessagesProvider');
    }
    return context;
}

// Module-level subscribers (Singleton pattern for event bus behavior)
const lastReadSubscribers = new Set();

/**
 * Subscribe to lastRead timestamp changes.
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
const subscribeToLastReadChanges = (callback) => {
    lastReadSubscribers.add(callback);
    return () => lastReadSubscribers.delete(callback);
};

/**
 * Notify subscribers of lastRead change.
 */
const notifyLastReadChange = (userId, conversationId, timestamp) => {
    lastReadSubscribers.forEach(callback => {
        try {
            callback(userId, conversationId, timestamp);
        } catch (error) {
            console.error('Error in lastRead subscriber:', error);
        }
    });
};

/**
 * Update lastRead timestamp.
 * Exported for backward compatibility with non-React consumers or static imports.
 *
 * @param {string} userId
 * @param {string} otherUserId
 * @param {string} [conversationId]
 */
export const updateLastReadTimestamp = (userId, otherUserId, conversationId = null) => {
    // Falls back to legacy format if conversationId not provided
    const convId = conversationId || getLegacyConversationId(userId, otherUserId);
    const now = new Date().toISOString();

    // Delegate to client utility for persistence
    lastReadClientUpdate(userId, convId);

    // Notify subscribers (trigger UI updates)
    notifyLastReadChange(userId, convId, now);
};

/**
 * Get lastRead timestamp from cache or fallback.
 *
 * @param {string} userId
 * @param {string} conversationId
 * @returns {string} ISO timestamp
 */
const getLastReadTimestamp = (userId, conversationId) => {
    // Delegate to client utility which handles local cache and localStorage
    const timestamp = getCachedTimestamp(userId, conversationId);
    return timestamp || new Date(0).toISOString();
};

/**
 * RealtimeMessagesProvider
 *
 * Provides real-time message data to the entire app via Context.
 * MUST be a child of a component tree where useUser() can be called.
 *
 * Key behaviors:
 * 1. Waits for authentication before creating Firestore listener
 * 2. Creates exactly ONE listener for all messages (singleton pattern preserved)
 * 3. Handles React StrictMode without duplicate listeners
 * 4. Cleans up listener when auth is lost
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function RealtimeMessagesProvider({ children }) {
    const { user, loading: authLoading } = useUser();

    // Internal State
    const [allMessages, setAllMessages] = useState([]);
    const [allMessagesLoading, setAllMessagesLoading] = useState(true);
    const [allMessagesError, setAllMessagesError] = useState(null);

    // Refs for StrictMode protection and listener management
    const listenerRef = useRef(null);           // Firestore unsubscribe function
    const listenerCreatedRef = useRef(false);   // Boolean flag to prevent double-creation
    const [authRetry, setAuthRetry] = useState(0); // Force effect re-run on error

    useEffect(() => {
        // CRITICAL: Do not create listener until auth is confirmed
        if (authLoading) {
            return; // Still loading auth state
        }

        if (!user) {
            // User logged out - clean up any existing listener
            if (listenerRef.current) {
                logListenerDestroyed('allMessages');
                listenerRef.current();
                listenerRef.current = null;
            }
            listenerCreatedRef.current = false;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAllMessages([]);
            setAllMessagesLoading(false);
            return;
        }

        // User is authenticated - set up listener if not already done
        if (listenerCreatedRef.current) {
            return; // Already created (StrictMode protection)
        }

        listenerCreatedRef.current = true;
        setAllMessagesLoading(true);

        const messagesRef = collection(firestore, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'desc'));

        logListenerCreated('allMessages', { query: 'orderBy(timestamp, desc)' });

        listenerRef.current = onSnapshot(
            q,
            { includeMetadataChanges: false },
            (snapshot) => {
                const msgs = [];
                snapshot.forEach((doc) => msgs.push(doc.data()));

                logSnapshotReceived(
                    'allMessages',
                    snapshot.size,
                    snapshot.metadata.fromCache,
                    snapshot.docChanges().length
                );

                setAllMessages(msgs);
                setAllMessagesLoading(false);
                setAllMessagesError(null);
            },
            (error) => {
                console.error('Error in all-messages listener:', error);
                setAllMessagesError(error);
                setAllMessagesLoading(false);

                // Reset flags to allow retry on next auth state change
                if (error.code === 'permission-denied') {
                    console.warn('[Firestore] Permission denied - retrying in 2 seconds...');
                    listenerCreatedRef.current = false;
                    listenerRef.current = null;

                    // Retry after delay to allow auth propagation
                    setTimeout(() => {
                        // Trigger a re-eval by toggling a dummy state or just invalidating
                        // Since we can't easily force the effect to re-run without state change,
                        // we'll rely on the user interactions or eventual consistency.
                        // BUT, to be proactive:
                        setAllMessagesLoading(true); // This might not trigger effect if deps don't change

                        // Better approach: Force effect re-run by updating a ref version? No.
                        // We reset listenerCreatedRef to false.
                        // If we are still mounted and authenticated, we want to try again.
                        // But the effect dependencies [user, authLoading] haven't changed.
                        // So the effect won't run again.

                        // We need a forceUpdate mechanism.
                        // Let's add a retry count to state.
                        setAuthRetry(prev => prev + 1);
                    }, 2000);
                }
            }
        );

        // Cleanup on unmount or auth change
        return () => {
            if (listenerRef.current) {
                logListenerDestroyed('allMessages');
                listenerRef.current();
                listenerRef.current = null;
            }
            listenerCreatedRef.current = false;
        };
    }, [user, authLoading, authRetry]);

    const value = {
        allMessages,
        allMessagesLoading,
        allMessagesError,
        currentUser: user,
        updateLastReadTimestamp,
        subscribeToLastReadChanges,
        getLastReadTimestamp
    };

    return (
        <RealtimeMessagesContext.Provider value={value}>
            {children}
        </RealtimeMessagesContext.Provider>
    );
}
