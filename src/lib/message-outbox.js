'use client';
import { clientAuth } from '@/lib/firebase-client';

export const MESSAGE_OUTBOX_STORAGE_KEY = 'secret-santa-message-outbox-v1';
const MAX_MESSAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

const subscribers = new Set();
const activeDrains = new Map();

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

function parseJson(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function readItems() {
    if (!hasWindow()) {
        return [];
    }

    return parseJson(window.localStorage.getItem(MESSAGE_OUTBOX_STORAGE_KEY) || '[]');
}

function writeItems(items) {
    if (!hasWindow()) {
        return;
    }

    window.localStorage.setItem(MESSAGE_OUTBOX_STORAGE_KEY, JSON.stringify(items));
    subscribers.forEach((callback) => {
        try {
            callback();
        } catch (error) {
            console.error('Outbox subscriber failed:', error);
        }
    });
}

function randomJitterMs() {
    return Math.floor(Math.random() * 1000);
}

function nextRetryDelayMs(attemptCount) {
    const exponent = Math.max(0, attemptCount - 1);
    const baseDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** exponent));
    return Math.min(MAX_RETRY_DELAY_MS, baseDelay + randomJitterMs());
}

function isExpired(item, now = nowMs()) {
    const createdAtMs = Date.parse(item?.createdAt || '');
    if (Number.isNaN(createdAtMs)) {
        return true;
    }

    return now - createdAtMs > MAX_MESSAGE_AGE_MS;
}

function toRetryState(item, reason) {
    const nextAttemptCount = Number(item.attemptCount || 0) + 1;
    return {
        ...item,
        status: 'pending',
        attemptCount: nextAttemptCount,
        nextAttemptAt: asIso(nowMs() + nextRetryDelayMs(nextAttemptCount)),
        lastError: reason || 'Retry scheduled',
    };
}

function toFailedState(item, reason) {
    return {
        ...item,
        status: 'failed',
        nextAttemptAt: null,
        lastError: reason || 'Permanent delivery failure',
    };
}

function normalizeContent(content) {
    return typeof content === 'string' ? content.trim() : '';
}

function generateClientMessageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
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

async function getAuthToken(forceRefresh = false) {
    const currentUser = clientAuth?.currentUser;
    if (!currentUser?.getIdToken) {
        return null;
    }
    return currentUser.getIdToken(forceRefresh);
}

async function sendOutboxItem({ item, token, fetchImpl }) {
    return fetchImpl('/api/messages/send', {
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
        }),
    });
}

function compareByCreatedAt(a, b) {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function replaceItem(items, updatedItem) {
    return items.map((item) => (
        item.clientMessageId === updatedItem.clientMessageId ? updatedItem : item
    ));
}

export function subscribeOutbox(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

export function enqueueMessage({ fromUserId, toId, conversationId = null, content }) {
    const normalizedContent = normalizeContent(content);

    if (!hasWindow() || !fromUserId || !toId || !normalizedContent) {
        throw new Error('Invalid outbox enqueue payload');
    }

    const item = {
        clientMessageId: generateClientMessageId(),
        fromUserId,
        toId,
        conversationId: conversationId || null,
        content: normalizedContent,
        createdAt: asIso(),
        attemptCount: 0,
        nextAttemptAt: asIso(),
        status: 'pending',
        lastError: null,
    };

    const items = readItems();
    items.push(item);
    items.sort(compareByCreatedAt);
    writeItems(items);
    return item;
}

export function retryOutboxMessage({ fromUserId, clientMessageId }) {
    if (!hasWindow()) {
        return false;
    }

    const items = readItems();
    const existing = items.find((item) => (
        item.fromUserId === fromUserId && item.clientMessageId === clientMessageId
    ));

    if (!existing) {
        return false;
    }

    const updated = {
        ...existing,
        status: 'pending',
        nextAttemptAt: asIso(),
        lastError: null,
    };
    writeItems(replaceItem(items, updated));
    return true;
}

export function getConversationOutboxMessages({ fromUserId, conversationId }) {
    const now = nowMs();
    const items = readItems()
        .filter((item) => item.fromUserId === fromUserId)
        .filter((item) => item.conversationId === (conversationId || null))
        .filter((item) => !isExpired(item, now))
        .filter((item) => item.status === 'pending' || item.status === 'failed')
        .sort(compareByCreatedAt);

    return items;
}

export function clearDeliveredOrExpired({ fromUserId = null } = {}) {
    if (!hasWindow()) {
        return 0;
    }

    const now = nowMs();
    const items = readItems();
    const filtered = items.filter((item) => {
        if (fromUserId && item.fromUserId !== fromUserId) {
            return true;
        }

        if (item.status === 'delivered') {
            return false;
        }

        return !isExpired(item, now);
    });

    if (filtered.length !== items.length) {
        writeItems(filtered);
        return items.length - filtered.length;
    }

    return 0;
}

export async function drainOutboxForUser({ fromUserId, fetchImpl = fetch } = {}) {
    if (!hasWindow() || !fromUserId || typeof fetchImpl !== 'function') {
        return {
            delivered: 0,
            retried: 0,
            failed: 0,
            skipped: 0,
        };
    }

    if (activeDrains.has(fromUserId)) {
        return activeDrains.get(fromUserId);
    }

    const run = (async () => {
        clearDeliveredOrExpired({ fromUserId });

        let delivered = 0;
        let retried = 0;
        let failed = 0;
        let skipped = 0;

        const now = nowMs();
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

        const initialItems = readItems()
            .filter((item) => item.fromUserId === fromUserId)
            .sort(compareByCreatedAt);

        if (!initialItems.length) {
            return { delivered, retried, failed, skipped };
        }

        for (const candidate of initialItems) {
            let items = readItems();
            const item = items.find((entry) => entry.clientMessageId === candidate.clientMessageId);
            if (!item) {
                continue;
            }

            if (isExpired(item, now)) {
                items = items.filter((entry) => entry.clientMessageId !== item.clientMessageId);
                writeItems(items);
                continue;
            }

            if (item.status === 'failed') {
                skipped += 1;
                continue;
            }

            const nextAttemptMs = Date.parse(item.nextAttemptAt || '');
            if (!Number.isNaN(nextAttemptMs) && nextAttemptMs > now) {
                skipped += 1;
                continue;
            }

            if (isOffline) {
                const updated = toRetryState(item, 'Offline - retry scheduled');
                writeItems(replaceItem(items, updated));
                retried += 1;
                continue;
            }

            let token;
            try {
                token = await getAuthToken(false);
            } catch (error) {
                const updated = toRetryState(item, `Auth token error: ${error?.message || 'Unknown error'}`);
                writeItems(replaceItem(items, updated));
                retried += 1;
                continue;
            }

            if (!token) {
                const updated = toRetryState(item, 'Auth token unavailable');
                writeItems(replaceItem(items, updated));
                retried += 1;
                continue;
            }

            let response;
            try {
                response = await sendOutboxItem({ item, token, fetchImpl });
            } catch (networkError) {
                const updated = toRetryState(item, networkError?.message || 'Network error');
                writeItems(replaceItem(items, updated));
                retried += 1;
                continue;
            }

            if (response.ok) {
                items = items.filter((entry) => entry.clientMessageId !== item.clientMessageId);
                writeItems(items);
                delivered += 1;
                continue;
            }

            // Handle stale token by forcing refresh once before classifying as final status.
            if (response.status === 401) {
                try {
                    const refreshedToken = await getAuthToken(true);
                    if (refreshedToken) {
                        const retriedResponse = await sendOutboxItem({
                            item,
                            token: refreshedToken,
                            fetchImpl
                        });

                        if (retriedResponse.ok) {
                            items = items.filter((entry) => entry.clientMessageId !== item.clientMessageId);
                            writeItems(items);
                            delivered += 1;
                            continue;
                        }

                        response = retriedResponse;
                    }
                } catch {
                    // Fall through to retry classification below.
                }
            }

            const reason = await parseResponseError(response);
            if (isRetryableStatus(response.status)) {
                const updated = toRetryState(item, reason);
                writeItems(replaceItem(items, updated));
                retried += 1;
            } else {
                const updated = toFailedState(item, reason);
                writeItems(replaceItem(items, updated));
                failed += 1;
            }
        }

        return { delivered, retried, failed, skipped };
    })();

    activeDrains.set(fromUserId, run);

    try {
        return await run;
    } finally {
        activeDrains.delete(fromUserId);
    }
}
