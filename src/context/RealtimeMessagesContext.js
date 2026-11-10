'use client';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { firestore } from '@/lib/firebase-client';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { useUser } from '@/hooks/useUser';
import { logListenerCreated, logListenerDestroyed, logSnapshotReceived } from '@/lib/firestore-listener-tracker';
import {
    updateLastReadTimestamp as lastReadClientUpdate,
    getCachedTimestamp,
    flushPendingWrites,
    resetLastReadState,
} from '@/lib/lastReadClient';
import { getLegacyConversationId } from '@/lib/message-utils';

const RealtimeMessagesContext = createContext(null);

const PERMISSION_RETRY_MS = 2000;

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
 * Record that the user has observed messages up to `observedAt`.
 * Exported for backward compatibility with non-React consumers or static imports.
 *
 * @param {string} userId
 * @param {string} otherUserId
 * @param {string|null} [conversationId]
 * @param {string|null} [observedAt] - ISO timestamp of the latest observed message
 * @returns {boolean} true when the marker advanced (subscribers are notified only then)
 */
export const updateLastReadTimestamp = (userId, otherUserId, conversationId = null, observedAt = null) => {
    // Falls back to legacy format if conversationId not provided
    const convId = conversationId || getLegacyConversationId(userId, otherUserId);

    // Delegate to client utility for persistence
    const accepted = lastReadClientUpdate(userId, convId, observedAt) === true;

    // Notify subscribers (trigger UI updates) only for accepted updates
    if (accepted) {
        notifyLastReadChange(userId, convId, observedAt);
    }

    return accepted;
};

/**
 * Get lastRead timestamp from cache or fallback.
 *
 * @param {string} userId
 * @param {string} conversationId
 * @returns {string} ISO timestamp
 */
const getLastReadTimestamp = (userId, conversationId) => {
    const timestamp = getCachedTimestamp(userId, conversationId);
    return timestamp || new Date(0).toISOString();
};

/**
 * RealtimeMessagesProvider
 *
 * Provides real-time message data to the entire app via Context.
 * MUST be rendered inside UserProvider (useUser()).
 *
 * Key behaviors:
 * 1. Waits for authentication before creating Firestore listener
 * 2. Creates exactly ONE listener for all messages (singleton pattern preserved)
 * 3. Listeners are keyed on the user id, not the user object, so assignment
 *    updates do not recreate them
 * 4. Cleans up listener (and any pending retry) when auth is lost or on unmount
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function RealtimeMessagesProvider({ children }) {
    const { user, loading: authLoading } = useUser();
    const userId = user?.id ?? null;

    // Internal State
    const [allMessages, setAllMessages] = useState([]);
    const [allMessagesLoading, setAllMessagesLoading] = useState(true);
    const [allMessagesError, setAllMessagesError] = useState(null);
    const [allReactions, setAllReactions] = useState([]);

    // Refs for listener management
    const listenerRef = useRef(null);           // Firestore unsubscribe function
    const reactionsListenerRef = useRef(null);
    const [messagesRetry, setMessagesRetry] = useState(0);
    const [reactionsRetry, setReactionsRetry] = useState(0);

    useEffect(() => {
        // CRITICAL: Do not create listener until auth is confirmed
        if (authLoading) {
            return undefined; // Still loading auth state
        }

        if (!userId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAllMessages([]);
            setAllMessagesLoading(false);
            return undefined;
        }

        let cancelled = false;
        let retryTimer = null;

        setAllMessagesLoading(true);

        const messagesRef = collection(firestore, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'desc'));

        logListenerCreated('allMessages', { query: 'orderBy(timestamp, desc)' });

        listenerRef.current = onSnapshot(
            q,
            { includeMetadataChanges: false },
            (snapshot) => {
                if (cancelled) return;
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
                if (cancelled) return;
                console.error('Error in all-messages listener:', error);
                setAllMessagesError(error);
                setAllMessagesLoading(false);

                if (error.code === 'permission-denied') {
                    console.warn('[Firestore] Permission denied - retrying in 2 seconds...');
                    listenerRef.current = null;
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        if (cancelled) return;
                        setMessagesRetry(prev => prev + 1);
                    }, PERMISSION_RETRY_MS);
                }
            }
        );

        // Cleanup on unmount or auth change
        return () => {
            cancelled = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (listenerRef.current) {
                logListenerDestroyed('allMessages');
                listenerRef.current();
                listenerRef.current = null;
            }
        };
    }, [userId, authLoading, messagesRetry]);

    useEffect(() => {
        if (authLoading) {
            return undefined;
        }

        if (!userId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAllReactions([]);
            return undefined;
        }

        let cancelled = false;
        let retryTimer = null;

        const reactionsRef = collection(firestore, 'reactions');
        const q = query(reactionsRef, orderBy('createdAt', 'asc'));
        logListenerCreated('allReactions', { query: 'orderBy(createdAt, asc)' });

        reactionsListenerRef.current = onSnapshot(
            q,
            { includeMetadataChanges: false },
            (snapshot) => {
                if (cancelled) return;
                const reactions = [];
                snapshot.forEach((reactionDoc) => reactions.push(reactionDoc.data()));
                logSnapshotReceived(
                    'allReactions',
                    snapshot.size,
                    snapshot.metadata.fromCache,
                    snapshot.docChanges().length
                );
                setAllReactions(reactions);
            },
            (error) => {
                if (cancelled) return;
                console.error('Error in all-reactions listener:', error);
                if (error.code === 'permission-denied') {
                    console.warn('[Firestore] Reactions permission denied - retrying in 2 seconds...');
                    reactionsListenerRef.current = null;
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        if (cancelled) return;
                        setReactionsRetry(prev => prev + 1);
                    }, PERMISSION_RETRY_MS);
                }
            }
        );

        return () => {
            cancelled = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (reactionsListenerRef.current) {
                logListenerDestroyed('allReactions');
                reactionsListenerRef.current();
                reactionsListenerRef.current = null;
            }
        };
    }, [userId, authLoading, reactionsRetry]);

    // Best-effort read-marker flush when the page is hidden or unloaded;
    // drop all read-marker state when the user changes or the provider unmounts.
    useEffect(() => {
        if (!userId || typeof window === 'undefined') {
            return undefined;
        }

        const flush = () => {
            flushPendingWrites().catch((error) => {
                console.error('Error flushing lastRead markers:', error);
            });
        };
        const handleVisibilityChange = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                flush();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', flush);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pagehide', flush);
            resetLastReadState();
        };
    }, [userId]);

    const value = {
        allMessages,
        allMessagesLoading,
        allMessagesError,
        allReactions,
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
