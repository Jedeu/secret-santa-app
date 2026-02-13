'use client';
import { firestore } from '@/lib/firebase-client';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

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
 *   - lastReadAt: Firestore server timestamp (normalized to ISO string in client reads)
 */

// Debounce map to batch rapid updates
const pendingWrites = new Map();  // key -> { timeout, data }
const DEBOUNCE_MS = 2000;  // Wait 2 seconds before writing

// In-memory cache for lastRead timestamps
const lastReadCache = new Map();
const EPOCH_ISO = new Date(0).toISOString();

function normalizeLastReadValue(rawValue, fallback = EPOCH_ISO) {
    if (rawValue && typeof rawValue.toDate === 'function') {
        return rawValue.toDate().toISOString();
    }

    if (typeof rawValue === 'string' && rawValue) {
        return rawValue;
    }

    return fallback;
}

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
        return EPOCH_ISO;
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
            const defaultTime = EPOCH_ISO;
            lastReadCache.set(key, defaultTime);
            return defaultTime;
        }

        const fallback = lastReadCache.get(key) || EPOCH_ISO;
        const timestamp = normalizeLastReadValue(snapshot.data()?.lastReadAt, fallback);
        lastReadCache.set(key, timestamp);
        return timestamp;
    } catch (error) {
        console.error('Error fetching lastRead timestamp:', error);
        return lastReadCache.get(key) || EPOCH_ISO;
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
                lastReadAt: serverTimestamp()
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
            const fallback = lastReadCache.get(key) || EPOCH_ISO;
            const normalized = normalizeLastReadValue(snapshot.data()?.lastReadAt, fallback);
            lastReadCache.set(key, normalized);
            callback(normalized);
        } else {
            const defaultValue = lastReadCache.get(key) || EPOCH_ISO;
            lastReadCache.set(key, defaultValue);
            callback(defaultValue);
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

    for (const [key, { timeout }] of pendingWrites) {
        clearTimeout(timeout);
        const [userId, ...rest] = key.split('_');
        const conversationId = rest.join('_'); // Handle underscore in conversationId

        const docRef = doc(firestore, 'lastRead', key);
        promises.push(
            setDoc(docRef, {
                userId,
                conversationId,
                lastReadAt: serverTimestamp()
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
