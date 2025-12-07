'use client';
import { firestore } from '@/lib/firebase-client';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

/**
 * Client-side Firestore operations for lastRead tracking.
 * Uses debouncing to minimize writes and reduce Firestore quota usage.
 *
 * Data schema:
 * Collection: 'lastRead'
 * Document ID: `${userId}_${conversationId}`
 * Fields:
 *   - userId: string
 *   - conversationId: string (legacy format or new format, or "publicFeed_threadId")
 *   - lastReadAt: string (ISO 8601 timestamp)
 */

// Debounce map to batch rapid updates
const pendingWrites = new Map();  // key -> { timeout, data }
const DEBOUNCE_MS = 2000;  // Wait 2 seconds before writing

// In-memory cache for lastRead timestamps
const lastReadCache = new Map();

/**
 * Get the last read timestamp for a conversation.
 * Returns from cache first if available, otherwise fetches from Firestore.
 *
 * @param {string} userId - Current user's ID
 * @param {string} conversationId - The conversation ID (legacy or new format)
 * @returns {Promise<string>} - ISO timestamp string, or epoch if not found
 */
export async function getLastReadTimestamp(userId, conversationId) {
    if (!firestore || !userId || !conversationId) {
        return new Date(0).toISOString();
    }

    const key = `${userId}_${conversationId}`;

    // Return cached value if available
    if (lastReadCache.has(key)) {
        return lastReadCache.get(key);
    }

    try {
        const docRef = doc(firestore, 'lastRead', key);
        const snapshot = await getDoc(docRef);

        if (!snapshot.exists()) {
            const defaultTime = new Date(0).toISOString();
            lastReadCache.set(key, defaultTime);
            return defaultTime;
        }

        const timestamp = snapshot.data().lastReadAt;
        lastReadCache.set(key, timestamp);
        return timestamp;
    } catch (error) {
        console.error('Error fetching lastRead timestamp:', error);
        return new Date(0).toISOString();
    }
}

/**
 * Update the last read timestamp for a conversation.
 * Debounced to reduce Firestore writes (max 1 write per 2 seconds per conversation).
 *
 * @param {string} userId - Current user's ID
 * @param {string} conversationId - The conversation ID
 * @returns {void}
 */
export function updateLastReadTimestamp(userId, conversationId) {
    if (!firestore || !userId || !conversationId) return;

    const key = `${userId}_${conversationId}`;
    const now = new Date().toISOString();

    // Update local cache immediately for responsive UI
    lastReadCache.set(key, now);

    // Clear existing timeout if any
    if (pendingWrites.has(key)) {
        clearTimeout(pendingWrites.get(key).timeout);
    }

    // Set new debounced write
    const timeout = setTimeout(async () => {
        try {
            const docRef = doc(firestore, 'lastRead', key);
            await setDoc(docRef, {
                userId,
                conversationId,
                lastReadAt: now
            });
            pendingWrites.delete(key);
        } catch (error) {
            console.error('Error updating lastRead timestamp:', error);
            pendingWrites.delete(key);
        }
    }, DEBOUNCE_MS);

    pendingWrites.set(key, { timeout, data: now });
}

/**
 * Subscribe to real-time updates for a lastRead document.
 * Used to sync across tabs/devices.
 *
 * @param {string} userId - Current user's ID
 * @param {string} conversationId - The conversation ID
 * @param {Function} callback - Called with ISO timestamp when updated
 * @returns {Function} - Unsubscribe function
 */
export function subscribeToLastRead(userId, conversationId, callback) {
    if (!firestore || !userId || !conversationId) {
        return () => {};
    }

    const key = `${userId}_${conversationId}`;
    const docRef = doc(firestore, 'lastRead', key);

    return onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
            const timestamp = snapshot.data().lastReadAt;
            lastReadCache.set(key, timestamp);
            callback(timestamp);
        } else {
            callback(new Date(0).toISOString());
        }
    }, (error) => {
        console.error('Error in lastRead listener:', error);
    });
}

/**
 * Flush all pending writes immediately.
 * Useful before page unload to ensure data is saved.
 *
 * @returns {Promise<void>}
 */
export async function flushPendingWrites() {
    const promises = [];

    for (const [key, { timeout, data }] of pendingWrites) {
        clearTimeout(timeout);
        const [userId, ...rest] = key.split('_');
        const conversationId = rest.join('_'); // Handle underscore in conversationId

        const docRef = doc(firestore, 'lastRead', key);
        promises.push(
            setDoc(docRef, {
                userId,
                conversationId,
                lastReadAt: data
            }).catch(error => {
                console.error('Error flushing lastRead:', error);
            })
        );
    }

    pendingWrites.clear();
    await Promise.all(promises);
}

/**
 * Clear the in-memory cache.
 * Useful for testing or when user signs out.
 */
export function clearCache() {
    lastReadCache.clear();
}

/**
 * Get the cached value for a key without fetching from Firestore.
 * Returns undefined if not in cache.
 *
 * @param {string} userId - Current user's ID
 * @param {string} conversationId - The conversation ID
 * @returns {string|undefined} - Cached timestamp or undefined
 */
export function getCachedTimestamp(userId, conversationId) {
    const key = `${userId}_${conversationId}`;
    return lastReadCache.get(key);
}
