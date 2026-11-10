'use client';
import { clientAuth } from '@/lib/firebase-client';

/**
 * Durable client outbox for chat messages.
 *
 * Storage layout (every operation is a single-key setItem/removeItem, so tabs never
 * overwrite each other's queued messages):
 * - item:{id}  = { clientMessageId, ownerUid|null, fromUserId, toId, conversationId, content, createdAt }
 *                written once, never rewritten
 * - done:{id}  = ISO deliveredAt tombstone, written on any 2xx
 * - state:{id} = { attemptCount, nextAttemptAt, status: 'pending'|'failed', lastError }
 *                last writer wins; absent = pending with zero attempts
 *
 * The v1 key (one shared JSON array) is read-only legacy input, imported on every
 * read/enqueue/drain and never written or removed.
 */

export const MESSAGE_OUTBOX_STORAGE_KEY = 'secret-santa-message-outbox-v1';
export const OUTBOX_ITEM_PREFIX = 'secret-santa-message-outbox-v2:item:';
export const OUTBOX_STATE_PREFIX = 'secret-santa-message-outbox-v2:state:';
export const OUTBOX_DONE_PREFIX = 'secret-santa-message-outbox-v2:done:';

const MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;

const subscribers = new Set();
const activeDrains = new Map();
let drainGeneration = 0;
let storageListener = null;

const PERMANENT_HTTP_STATUS = new Set([400, 403, 404, 409]);

function hasWindow() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function nowMs() {
    return Date.now();
}

function asIso(ms = nowMs()) {
    return new Date(ms).toISOString();
}

function parseJson(raw, fallback = null) {
    if (typeof raw !== 'string') return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function notifySubscribers() {
    subscribers.forEach((callback) => {
        try {
            callback();
        } catch (error) {
            console.error('Outbox subscriber failed:', error);
        }
    });
}

function itemKey(id) { return OUTBOX_ITEM_PREFIX + id; }
function stateKey(id) { return OUTBOX_STATE_PREFIX + id; }
function doneKey(id) { return OUTBOX_DONE_PREFIX + id; }

function listIdsWithPrefix(prefix) {
    if (!hasWindow()) return [];
    const storage = window.localStorage;
    const ids = [];
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (typeof key === 'string' && key.startsWith(prefix)) {
            ids.push(key.slice(prefix.length));
        }
    }
    return ids;
}

function isValidIso(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isExpired(createdAt, now = nowMs()) {
    const createdAtMs = Date.parse(createdAt || '');
    if (Number.isNaN(createdAtMs)) {
        return true;
    }

    return now - createdAtMs > MAX_MESSAGE_AGE_MS;
}

function normalizeContent(content) {
    return typeof content === 'string' ? content.trim() : '';
}

function isValidPayload(payload) {
    return !!payload
        && typeof payload.clientMessageId === 'string' && !!payload.clientMessageId
        && typeof payload.fromUserId === 'string' && !!payload.fromUserId
        && typeof payload.toId === 'string' && !!payload.toId
        && typeof payload.content === 'string' && !!payload.content
        && isValidIso(payload.createdAt);
}

function readPayload(id) {
    if (!hasWindow()) return null;
    const payload = parseJson(window.localStorage.getItem(itemKey(id)));
    return isValidPayload(payload) ? payload : null;
}

function hasTombstone(id) {
    return hasWindow() && window.localStorage.getItem(doneKey(id)) !== null;
}

function readState(id) {
    const stored = hasWindow() ? parseJson(window.localStorage.getItem(stateKey(id))) : null;
    const hasState = !!stored && typeof stored === 'object';
    return {
        hasState,
        attemptCount: Number(stored?.attemptCount || 0),
        nextAttemptAt: hasState ? (stored.nextAttemptAt ?? null) : null,
        status: stored?.status === 'failed' ? 'failed' : 'pending',
        lastError: stored?.lastError ?? null,
    };
}

function toView(payload, state) {
    return {
        ...payload,
        attemptCount: state.attemptCount,
        nextAttemptAt: state.hasState ? state.nextAttemptAt : payload.createdAt,
        status: state.status,
        lastError: state.lastError,
    };
}

function isLive(id, payload, now = nowMs()) {
    return !!payload && !hasTombstone(id) && !isExpired(payload.createdAt, now);
}

function readLiveItem(id, now = nowMs()) {
    const payload = readPayload(id);
    if (!isLive(id, payload, now)) return null;
    return toView(payload, readState(id));
}

function readLiveItems(now = nowMs()) {
    return listIdsWithPrefix(OUTBOX_ITEM_PREFIX)
        .map((id) => readLiveItem(id, now))
        .filter(Boolean);
}

/**
 * Writes the state key only while a live payload exists. A late failure for an item
 * delivered elsewhere is therefore dropped (and any orphan state is collected by GC).
 */
function writeState(id, state) {
    if (!hasWindow()) return false;
    if (!isLive(id, readPayload(id))) return false;
    window.localStorage.setItem(stateKey(id), JSON.stringify(state));
    notifySubscribers();
    return true;
}

function markDelivered(id) {
    if (!hasWindow()) return;
    const storage = window.localStorage;
    storage.setItem(doneKey(id), asIso());
    storage.removeItem(itemKey(id));
    storage.removeItem(stateKey(id));
    notifySubscribers();
}

function importLegacyQueue() {
    if (!hasWindow()) return;
    const storage = window.localStorage;
    const raw = storage.getItem(MESSAGE_OUTBOX_STORAGE_KEY);
    if (!raw) return;

    const entries = parseJson(raw, []);
    if (!Array.isArray(entries) || !entries.length) return;

    const now = nowMs();
    let skipped = 0;

    entries.forEach((entry) => {
        const content = normalizeContent(entry?.content);
        const id = typeof entry?.clientMessageId === 'string' ? entry.clientMessageId : '';
        if (!id
            || typeof entry?.fromUserId !== 'string' || !entry.fromUserId
            || typeof entry?.toId !== 'string' || !entry.toId
            || !content
            || !isValidIso(entry?.createdAt)) {
            skipped += 1;
            return;
        }
        if (isExpired(entry.createdAt, now) || entry.status === 'delivered') {
            skipped += 1;
            return;
        }
        if (storage.getItem(doneKey(id)) !== null) {
            skipped += 1;
            return;
        }
        if (storage.getItem(itemKey(id)) !== null) {
            // Never overwritten (also covers duplicate ids inside v1).
            skipped += 1;
            return;
        }

        try {
            storage.setItem(itemKey(id), JSON.stringify({
                clientMessageId: id,
                ownerUid: null,
                fromUserId: entry.fromUserId,
                toId: entry.toId,
                conversationId: entry.conversationId || null,
                content,
                createdAt: entry.createdAt,
            }));
            if (storage.getItem(stateKey(id)) === null) {
                storage.setItem(stateKey(id), JSON.stringify({
                    attemptCount: Number(entry.attemptCount || 0),
                    nextAttemptAt: entry.nextAttemptAt ?? null,
                    status: entry.status === 'failed' ? 'failed' : 'pending',
                    lastError: entry.lastError ?? null,
                }));
            }
        } catch (error) {
            console.error('Outbox legacy import failed:', error?.message || error);
        }
    });

    if (skipped > 0 && process.env.NODE_ENV === 'development') {
        console.debug(`[Outbox] Skipped ${skipped} legacy entries during import`);
    }
}

function randomJitterMs() {
    return Math.floor(Math.random() * 1000);
}

function nextRetryDelayMs(attemptCount) {
    const exponent = Math.max(0, attemptCount - 1);
    const baseDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** exponent));
    return Math.min(MAX_RETRY_DELAY_MS, baseDelay + randomJitterMs());
}

function toRetryState(item, reason) {
    const nextAttemptCount = Number(item.attemptCount || 0) + 1;
    return {
        attemptCount: nextAttemptCount,
        nextAttemptAt: asIso(nowMs() + nextRetryDelayMs(nextAttemptCount)),
        status: 'pending',
        lastError: reason || 'Retry scheduled',
    };
}

function toFailedState(item, reason) {
    return {
        attemptCount: Number(item.attemptCount || 0),
        nextAttemptAt: null,
        status: 'failed',
        lastError: reason || 'Permanent delivery failure',
    };
}

function generateClientMessageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    const randomHex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return `${randomHex()}${randomHex()}-${randomHex()}-4${randomHex().slice(1)}-a${randomHex().slice(1)}-${randomHex()}${randomHex()}${randomHex()}`;
}

async function parseResponseError(response) {
    try {
        const parsed = await response.json();
        if (parsed?.error) {
            return parsed.error;
        }
    } catch {
        // Ignore parse errors and use status fallback.
    }
    return `Request failed with status ${response.status}`;
}

function isRetryableStatus(status) {
    if (PERMANENT_HTTP_STATUS.has(status)) {
        return false;
    }

    return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function sendOutboxItem({ item, token, fetchImpl }) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
        return await fetchImpl('/api/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                toId: item.toId,
                content: item.content,
                conversationId: item.conversationId,
                clientMessageId: item.clientMessageId,
                clientCreatedAt: item.createdAt,
                senderUserId: item.fromUserId,
            }),
            ...(controller ? { signal: controller.signal } : {}),
        });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function compareByCreatedAt(a, b) {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function isEligible(item, { ownerUid, fromUserId }) {
    return item.fromUserId === fromUserId
        && (item.ownerUid === ownerUid || item.ownerUid === null || item.ownerUid === undefined);
}

function isOutboxStorageKey(key) {
    return key === null
        || key === MESSAGE_OUTBOX_STORAGE_KEY
        || (typeof key === 'string' && (
            key.startsWith(OUTBOX_ITEM_PREFIX)
            || key.startsWith(OUTBOX_STATE_PREFIX)
            || key.startsWith(OUTBOX_DONE_PREFIX)
        ));
}

function ensureStorageListener() {
    if (storageListener || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    storageListener = (event) => {
        if (isOutboxStorageKey(event?.key ?? null)) {
            notifySubscribers();
        }
    };
    window.addEventListener('storage', storageListener);
}

function releaseStorageListener() {
    if (!storageListener || subscribers.size > 0) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', storageListener);
    }
    storageListener = null;
}

export function subscribeOutbox(callback) {
    subscribers.add(callback);
    ensureStorageListener();
    return () => {
        subscribers.delete(callback);
        releaseStorageListener();
    };
}

export function enqueueMessage({ ownerUid, fromUserId, toId, conversationId = null, content }) {
    const normalizedContent = normalizeContent(content);

    if (!hasWindow() || !ownerUid || !fromUserId || !toId || !normalizedContent) {
        throw new Error('Invalid outbox enqueue payload');
    }

    importLegacyQueue();

    const payload = {
        clientMessageId: generateClientMessageId(),
        ownerUid,
        fromUserId,
        toId,
        conversationId: conversationId || null,
        content: normalizedContent,
        createdAt: asIso(),
    };

    // Single-key write; throws on quota errors.
    window.localStorage.setItem(itemKey(payload.clientMessageId), JSON.stringify(payload));
    notifySubscribers();

    return toView(payload, readState(payload.clientMessageId));
}

export function retryOutboxMessage({ fromUserId, clientMessageId }) {
    if (!hasWindow() || !clientMessageId) {
        return false;
    }

    importLegacyQueue();
    const existing = readLiveItem(clientMessageId);
    if (!existing || existing.fromUserId !== fromUserId) {
        return false;
    }

    return writeState(clientMessageId, {
        attemptCount: existing.attemptCount,
        nextAttemptAt: asIso(),
        status: 'pending',
        lastError: null,
    });
}

export function getConversationOutboxMessages({ fromUserId, conversationId }) {
    if (!hasWindow()) return [];
    importLegacyQueue();

    return readLiveItems()
        .filter((item) => item.fromUserId === fromUserId)
        .filter((item) => item.conversationId === (conversationId || null))
        .filter((item) => item.status === 'pending' || item.status === 'failed')
        .sort(compareByCreatedAt);
}

export function clearDeliveredOrExpired({ fromUserId = null } = {}) {
    if (!hasWindow()) {
        return 0;
    }

    importLegacyQueue();

    const storage = window.localStorage;
    const now = nowMs();
    let removed = 0;
    let changed = false;

    listIdsWithPrefix(OUTBOX_ITEM_PREFIX).forEach((id) => {
        const payload = readPayload(id);
        if (payload && fromUserId && payload.fromUserId !== fromUserId) {
            return;
        }
        if (!payload || hasTombstone(id) || isExpired(payload.createdAt, now)) {
            storage.removeItem(itemKey(id));
            storage.removeItem(stateKey(id));
            removed += 1;
            changed = true;
        }
    });

    // Orphan state keys (no payload).
    listIdsWithPrefix(OUTBOX_STATE_PREFIX).forEach((id) => {
        if (storage.getItem(itemKey(id)) === null) {
            storage.removeItem(stateKey(id));
            changed = true;
        }
    });

    // Old tombstones with no payload.
    listIdsWithPrefix(OUTBOX_DONE_PREFIX).forEach((id) => {
        if (storage.getItem(itemKey(id)) !== null) return;
        const deliveredAtMs = Date.parse(storage.getItem(doneKey(id)) || '');
        if (Number.isNaN(deliveredAtMs) || now - deliveredAtMs > TOMBSTONE_TTL_MS) {
            storage.removeItem(doneKey(id));
            changed = true;
        }
    });

    if (changed) {
        notifySubscribers();
    }

    return removed;
}

async function runDrainPass({ ownerUid, fromUserId, fetchImpl, authUser, generation }) {
    const totals = { delivered: 0, retried: 0, failed: 0, skipped: 0, stopped: false };
    const isCurrent = () => drainGeneration === generation && clientAuth?.currentUser?.uid === ownerUid;
    const stop = () => {
        totals.stopped = true;
        return totals;
    };

    clearDeliveredOrExpired({ fromUserId });

    const now = nowMs();
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    const candidates = readLiveItems(now)
        .filter((item) => isEligible(item, { ownerUid, fromUserId }))
        .sort(compareByCreatedAt);

    for (const candidate of candidates) {
        if (!isCurrent()) return stop();

        const id = candidate.clientMessageId;
        const item = readLiveItem(id);
        if (!item || !isEligible(item, { ownerUid, fromUserId })) {
            continue;
        }

        if (item.status === 'failed') {
            totals.skipped += 1;
            continue;
        }

        const nextAttemptMs = Date.parse(item.nextAttemptAt || '');
        if (!Number.isNaN(nextAttemptMs) && nextAttemptMs > now) {
            totals.skipped += 1;
            continue;
        }

        if (isOffline) {
            writeState(id, toRetryState(item, 'Offline - retry scheduled'));
            totals.retried += 1;
            continue;
        }

        let token;
        try {
            token = await authUser.getIdToken(false);
        } catch (error) {
            if (!isCurrent()) return stop();
            writeState(id, toRetryState(item, `Auth token error: ${error?.message || 'Unknown error'}`));
            totals.retried += 1;
            continue;
        }
        if (!isCurrent()) return stop();

        if (!token) {
            writeState(id, toRetryState(item, 'Auth token unavailable'));
            totals.retried += 1;
            continue;
        }

        let response;
        try {
            response = await sendOutboxItem({ item, token, fetchImpl });
        } catch (networkError) {
            if (!isCurrent()) return stop();
            const reason = networkError?.name === 'AbortError'
                ? 'Request timed out'
                : (networkError?.message || 'Network error');
            writeState(id, toRetryState(item, reason));
            totals.retried += 1;
            continue;
        }

        if (response.ok) {
            // The server committed the message: delivered regardless of current identity.
            markDelivered(id);
            totals.delivered += 1;
            continue;
        }
        if (!isCurrent()) return stop();

        // Handle stale token by forcing refresh once (on the captured user).
        if (response.status === 401) {
            try {
                const refreshedToken = await authUser.getIdToken(true);
                if (!isCurrent()) return stop();
                if (refreshedToken) {
                    const retriedResponse = await sendOutboxItem({
                        item,
                        token: refreshedToken,
                        fetchImpl
                    });

                    if (retriedResponse.ok) {
                        markDelivered(id);
                        totals.delivered += 1;
                        continue;
                    }
                    if (!isCurrent()) return stop();

                    response = retriedResponse;
                }
            } catch {
                if (!isCurrent()) return stop();
                // Fall through to retry classification below.
            }
        }

        const reason = await parseResponseError(response);
        if (!isCurrent()) return stop();

        if (isRetryableStatus(response.status)) {
            writeState(id, toRetryState(item, reason));
            totals.retried += 1;
        } else {
            writeState(id, toFailedState(item, reason));
            totals.failed += 1;
        }
    }

    return totals;
}

export async function drainOutboxForUser({ ownerUid, fromUserId, fetchImpl = fetch } = {}) {
    const zero = {
        delivered: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
    };

    if (!hasWindow() || !ownerUid || !fromUserId || typeof fetchImpl !== 'function') {
        return zero;
    }

    const authUser = clientAuth?.currentUser;
    if (!authUser || authUser.uid !== ownerUid || typeof authUser.getIdToken !== 'function') {
        return zero;
    }

    const drainKey = `${ownerUid}|${fromUserId}`;
    const active = activeDrains.get(drainKey);
    if (active) {
        active.followUp = true;
        return active.promise;
    }

    importLegacyQueue();

    const generation = drainGeneration;
    const entry = { followUp: false, promise: null };

    entry.promise = (async () => {
        const totals = { ...zero };
        try {
            do {
                entry.followUp = false;
                const pass = await runDrainPass({ ownerUid, fromUserId, fetchImpl, authUser, generation });
                totals.delivered += pass.delivered;
                totals.retried += pass.retried;
                totals.failed += pass.failed;
                totals.skipped += pass.skipped;
                if (pass.stopped) break;
            } while (entry.followUp && drainGeneration === generation);
        } finally {
            if (activeDrains.get(drainKey) === entry) {
                activeDrains.delete(drainKey);
            }
        }
        return totals;
    })();

    activeDrains.set(drainKey, entry);
    return entry.promise;
}

/**
 * Invalidate every in-flight drain in this realm (auth change, sign-out, unmount).
 * In-flight requests may still complete; a 2xx still marks the item delivered,
 * every other outcome is discarded.
 */
export function cancelOutboxDrains() {
    drainGeneration += 1;
    activeDrains.clear();
}
