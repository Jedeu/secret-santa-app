'use client';
import { firestore, clientAuth } from '@/lib/firebase-client';
import { doc, getDoc, setDoc, onSnapshot, Timestamp } from 'firebase/firestore';

/**
 * Client-side Firestore operations for lastRead tracking.
 *
 * Data schema:
 * Collection: 'lastRead'
 * Document ID: `${userId}_${conversationId}`
 * Fields:
 *   - userId: string
 *   - conversationId: string (legacy format or new format, or "publicFeed_threadId")
 *   - lastReadAt: Timestamp = the latest message timestamp the user has observed (monotonic)
 *
 * Writes are debounced and single-flight per key: at most one setDoc per key is in
 * flight; later observations only raise the pending entry's observedAt.
 */

const DEBOUNCE_MS = 2000;
// Delays before the first and second retries; the third consecutive failure drops the entry.
const RETRY_DELAYS_MS = [5000, 15000, 60000];
const MAX_FAILURES = 3;
const EPOCH_ISO = new Date(0).toISOString();

// Module state
let cache = new Map();        // key -> ISO (local view, never moves backwards)
let remoteSeen = new Map();   // key -> ISO (max remote value observed)
let pending = new Map();      // key -> Entry
let stateGeneration = 0;
let nextEntryId = 1;

function toMs(iso) {
    return Date.parse(iso);
}

function isValidIso(value) {
    return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function normalizeLastReadValue(rawValue) {
    if (rawValue && typeof rawValue.toDate === 'function') {
        return rawValue.toDate().toISOString();
    }

    if (isValidIso(rawValue)) {
        return rawValue;
    }

    return null;
}

function maxIso(a, b) {
    if (a === undefined || a === null) return b;
    if (b === undefined || b === null) return a;
    return toMs(b) > toMs(a) ? b : a;
}

function makeKey(userId, conversationId) {
    return `${userId}_${conversationId}`;
}

function clearTimers(entry) {
    if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
    }
    if (entry.retryTimer) {
        clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
    }
}

function deleteEntry(entry) {
    clearTimers(entry);
    if (pending.get(entry.key) === entry) {
        pending.delete(entry.key);
    }
}

function armDebounce(entry) {
    if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        if (pending.get(entry.key) !== entry || entry.inFlight) return;
        startWrite(entry);
    }, DEBOUNCE_MS);
}

function armRetry(entry, delayMs) {
    if (entry.retryTimer) {
        clearTimeout(entry.retryTimer);
    }
    entry.retryTimer = setTimeout(() => {
        entry.retryTimer = null;
        if (pending.get(entry.key) !== entry || entry.inFlight) return;
        startWrite(entry);
    }, delayMs);
}

/**
 * Max-merge a remote value into remoteSeen and the cache; drop a pending entry that
 * is not in flight and is already covered by the remote value.
 */
function mergeRemote(key, remote) {
    if (remote) {
        remoteSeen.set(key, maxIso(remoteSeen.get(key), remote));
        cache.set(key, maxIso(cache.get(key), remote));
        const entry = pending.get(key);
        if (entry && !entry.inFlight && toMs(entry.observedAt) <= toMs(remote)) {
            deleteEntry(entry);
        }
    } else if (!cache.has(key)) {
        cache.set(key, EPOCH_ISO);
    }
    return cache.get(key) ?? EPOCH_ISO;
}

/**
 * The only place a write result is applied.
 */
function settle(token, outcome) {
    if (token.generation !== stateGeneration) return;
    const entry = pending.get(token.key);
    if (!entry || entry.entryId !== token.entryId) return;

    entry.inFlight = false;

    if (outcome === 'ok' || outcome === 'superseded') {
        entry.retries = 0;
        if (outcome === 'ok') {
            remoteSeen.set(token.key, maxIso(remoteSeen.get(token.key), token.written));
        }
        if (toMs(entry.observedAt) > toMs(token.written)) {
            if (entry.flushRequested) {
                return startWrite(entry);
            }
            armDebounce(entry);
        } else {
            deleteEntry(entry);
        }
        return undefined;
    }

    // failed
    if (toMs(entry.observedAt) > toMs(token.written)) {
        entry.retries = 0;
        armDebounce(entry);
        return undefined;
    }

    entry.retries += 1;
    if (entry.retries >= MAX_FAILURES) {
        console.error('Dropping lastRead update after repeated failures:', token.key);
        deleteEntry(entry);
        return undefined;
    }
    armRetry(entry, RETRY_DELAYS_MS[Math.min(entry.retries - 1, RETRY_DELAYS_MS.length - 1)]);
    return undefined;
}

/**
 * True only while the write described by `token` is still the live in-flight write:
 * same state generation and the same pending entry (not a replacement for the key).
 */
function isTokenLive(token) {
    if (token.generation !== stateGeneration) return false;
    const entry = pending.get(token.key);
    return !!entry && entry.entryId === token.entryId && entry.inFlight === true;
}

async function handleRejection(token, error) {
    // Invalidated (reset, or the entry was replaced): no logging, no confirmation read,
    // no retry and no state change.
    if (!isTokenLive(token)) return undefined;

    if (error?.code !== 'permission-denied') {
        console.error('Error updating lastRead timestamp:', error);
        return settle(token, 'failed');
    }

    // A denied write may simply be older than the stored marker (monotonic rule).
    const seen = remoteSeen.get(token.key);
    if (seen !== undefined && toMs(seen) >= toMs(token.written)) {
        return settle(token, 'superseded');
    }

    try {
        const snapshot = await getDoc(doc(firestore, 'lastRead', token.key));
        // Invalidated while confirming: apply nothing.
        if (!isTokenLive(token)) return undefined;
        const remote = snapshot.exists() ? normalizeLastReadValue(snapshot.data()?.lastReadAt) : null;
        if (remote) {
            remoteSeen.set(token.key, maxIso(remoteSeen.get(token.key), remote));
            cache.set(token.key, maxIso(cache.get(token.key), remote));
        }
        if (remote && toMs(remote) >= toMs(token.written)) {
            return settle(token, 'superseded');
        }
    } catch (confirmError) {
        if (!isTokenLive(token)) return undefined;
        console.error('Error confirming lastRead marker:', confirmError);
    }
    return settle(token, 'failed');
}

/**
 * Start a write for an entry (never while in flight). Returns a promise that resolves
 * once this write (and any immediate flush-requested follow-up) has settled, or null
 * when nothing was started.
 */
function startWrite(entry) {
    if (entry.inFlight) return null;
    clearTimers(entry);

    const currentUid = clientAuth?.currentUser?.uid ?? null;
    if (currentUid !== entry.ownerUid) {
        deleteEntry(entry);
        return null;
    }

    const token = {
        key: entry.key,
        entryId: entry.entryId,
        generation: stateGeneration,
        written: entry.observedAt,
    };
    entry.inFlight = true;
    entry.flushRequested = false;

    let writePromise;
    try {
        writePromise = setDoc(doc(firestore, 'lastRead', entry.key), {
            userId: entry.userId,
            conversationId: entry.conversationId,
            lastReadAt: Timestamp.fromDate(new Date(token.written)),
        });
    } catch (error) {
        writePromise = Promise.reject(error);
    }

    return Promise.resolve(writePromise).then(
        () => settle(token, 'ok'),
        (error) => handleRejection(token, error)
    ).catch((error) => {
        console.error('Error settling lastRead write:', error);
    });
}

/**
 * Get the last read timestamp for a conversation.
 * Returns from cache first if available, otherwise fetches from Firestore.
 *
 * @returns {Promise<string>} - ISO timestamp string, or epoch if not found
 */
export async function getLastReadTimestamp(userId, conversationId) {
    if (!firestore || !userId || !conversationId) {
        return EPOCH_ISO;
    }

    const key = makeKey(userId, conversationId);

    if (cache.has(key)) {
        return cache.get(key);
    }

    const generation = stateGeneration;
    try {
        const snapshot = await getDoc(doc(firestore, 'lastRead', key));
        if (generation !== stateGeneration) {
            return cache.get(key) ?? EPOCH_ISO;
        }
        const remote = snapshot.exists() ? normalizeLastReadValue(snapshot.data()?.lastReadAt) : null;
        return mergeRemote(key, remote);
    } catch (error) {
        console.error('Error fetching lastRead timestamp:', error);
        return cache.get(key) ?? EPOCH_ISO;
    }
}

/**
 * Record that the user has observed messages up to `observedAt` (a message timestamp).
 * Returns true only when the value advanced the local marker.
 *
 * @param {string} userId
 * @param {string} conversationId
 * @param {string} observedAt - ISO timestamp of the latest observed message
 * @returns {boolean}
 */
export function updateLastReadTimestamp(userId, conversationId, observedAt) {
    if (!firestore || !userId || !conversationId || !isValidIso(observedAt)) return false;

    const key = makeKey(userId, conversationId);
    const cached = cache.get(key);
    if (cached !== undefined && toMs(observedAt) <= toMs(cached)) {
        return false;
    }

    cache.set(key, observedAt);

    let entry = pending.get(key);
    if (!entry) {
        entry = {
            entryId: nextEntryId++,
            key,
            userId,
            conversationId,
            observedAt,
            ownerUid: clientAuth?.currentUser?.uid ?? null,
            debounceTimer: null,
            retryTimer: null,
            inFlight: false,
            flushRequested: false,
            retries: 0,
        };
        pending.set(key, entry);
    } else if (toMs(observedAt) > toMs(entry.observedAt)) {
        entry.observedAt = observedAt;
    }

    if (!entry.inFlight && !entry.retryTimer) {
        armDebounce(entry);
    }

    return true;
}

/**
 * Subscribe to real-time updates for one lastRead document (own markers, cross-device).
 *
 * @returns {Function} - Unsubscribe function
 */
export function subscribeToLastRead(userId, conversationId, callback) {
    if (!firestore || !userId || !conversationId) {
        return () => {};
    }

    const key = makeKey(userId, conversationId);
    const generation = stateGeneration;
    let active = true;

    const unsubscribe = onSnapshot(doc(firestore, 'lastRead', key), (snapshot) => {
        if (!active || generation !== stateGeneration) return;
        const remote = snapshot.exists() ? normalizeLastReadValue(snapshot.data()?.lastReadAt) : null;
        const merged = mergeRemote(key, remote);
        try {
            callback(merged);
        } catch (error) {
            console.error('Error in lastRead subscriber callback:', error);
        }
    }, (error) => {
        console.error('Error in lastRead listener:', error);
    });

    return () => {
        active = false;
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    };
}

/**
 * Start pending writes now. In-flight entries are flagged to write again immediately
 * when they settle. Resolves when the writes started here settle (best effort; no
 * shutdown guarantee).
 *
 * @returns {Promise<void>}
 */
export async function flushPendingWrites() {
    const started = [];
    Array.from(pending.values()).forEach((entry) => {
        if (entry.inFlight) {
            entry.flushRequested = true;
            return;
        }
        const promise = startWrite(entry);
        if (promise) started.push(promise);
    });
    await Promise.all(started);
}

/**
 * Drop all state (auth change / sign-out). Results of in-flight writes are ignored.
 */
export function resetLastReadState() {
    stateGeneration += 1;
    pending.forEach((entry) => clearTimers(entry));
    pending = new Map();
    cache = new Map();
    remoteSeen = new Map();
}

/**
 * Clear the in-memory cache.
 * Useful for testing.
 */
export function clearCache() {
    cache.clear();
}

/**
 * Get the cached value for a key without fetching from Firestore.
 * Returns undefined if not in cache.
 */
export function getCachedTimestamp(userId, conversationId) {
    return cache.get(makeKey(userId, conversationId));
}
