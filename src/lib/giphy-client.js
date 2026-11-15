'use client';
import { isGiphyId } from '@/lib/giphy-reference';

/**
 * Browser-only GIPHY Trending/Search client and service-worker policy probe.
 *
 * Requests go straight from the browser to GIPHY with the public key, no headers, no
 * credentials, no referrer and `cache: 'no-store'`. Results are returned in GIPHY's
 * order and count; rendition URLs are returned byte-identical or dropped, never
 * rewritten. Nothing here stores responses, logs, or retries automatically.
 *
 * Before every API request the controlling service worker (if any) must acknowledge
 * that it removed GIPHY entries from app-controlled storage; without that
 * acknowledgement no request is made (UPDATE_REQUIRED). There is no memo of the probe.
 */

export const GIPHY_PAGE_SIZE = 24;
export const GIPHY_QUERY_MAX_LENGTH = 50;
export const GIPHY_TRENDING_MAX_OFFSET = 499;
export const GIPHY_SEARCH_MAX_OFFSET = 4999;
export const GIPHY_RATING = 'pg-13';
export const GIPHY_REQUEST_TIMEOUT_MS = 10000;
export const GIPHY_RATE_LIMIT_COOLDOWN_MS = 60000;
export const GIPHY_WORKER_POLICY_MESSAGE = 'SECRET_SANTA_GIPHY_POLICY';
export const GIPHY_WORKER_POLICY_VERSION = 1;
export const GIPHY_WORKER_PROBE_TIMEOUT_MS = 3000;

const GIPHY_TRENDING_URL = 'https://api.giphy.com/v1/gifs/trending';
const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const GIPHY_TITLE_MAX_LENGTH = 120;

const GENERIC_ERROR_TEXT = "Couldn't load GIFs. Try again.";
const UNAVAILABLE_TEXT = 'GIF search is unavailable right now.';

const GIPHY_ERROR_TEXT = {
    OFFLINE: "You're offline. Connect to the internet to search GIFs.",
    RATE_LIMITED: 'GIF search is busy right now. Try again in a minute.',
    UPDATE_REQUIRED: 'GIF search is still updating. Try again in a moment, or reload the app.',
    MISSING_KEY: UNAVAILABLE_TEXT,
    KEY_REJECTED: UNAVAILABLE_TEXT,
};

export class GiphyClientError extends Error {
    constructor(code = 'UNAVAILABLE') {
        super(code);
        this.name = 'GiphyClientError';
        this.code = code;
        this.isGiphyClientError = true;
    }
}

/**
 * The public GIPHY key, trimmed, or null.
 */
export function getGiphyApiKey() {
    const value = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

export function isGiphyConfigured() {
    return getGiphyApiKey() !== null;
}

/**
 * Fixed user-facing text for an error's `code`.
 */
export function describeGiphyError(error) {
    const code = error?.code;
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(GIPHY_ERROR_TEXT, code)) {
        return GIPHY_ERROR_TEXT[code];
    }
    return GENERIC_ERROR_TEXT;
}

// --- Service-worker policy probe ---

/**
 * Whether the controlling service worker (if any) acknowledged the GIPHY policy for
 * this request. Posts a fresh probe on every call; never memoizes.
 *
 * @returns {Promise<boolean>}
 */
export async function isGiphyWorkerReady({
    container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    createChannel = () => new MessageChannel(),
    timeoutMs = GIPHY_WORKER_PROBE_TIMEOUT_MS,
} = {}) {
    let controller;
    try {
        if (!container) return true;
        controller = container.controller;
        if (!controller) return true;
    } catch {
        return false;
    }

    let port1;
    let port2;
    try {
        const channel = createChannel();
        port1 = channel?.port1;
        port2 = channel?.port2;
    } catch {
        return false;
    }
    if (!port1 || !port2) {
        try {
            port1?.close?.();
        } catch {
            // Ignored.
        }
        try {
            port2?.close?.();
        } catch {
            // Ignored.
        }
        return false;
    }

    return new Promise((resolve) => {
        let settled = false;
        let timer = null;

        // The only completion path: reply, timeout and postMessage failure all end here.
        const settle = (result) => {
            if (settled) return;
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            try {
                port1.onmessage = null;
            } catch {
                // Ignored.
            }
            try {
                port1.close();
            } catch {
                // Ignored.
            }
            try {
                port2.close();
            } catch {
                // Ignored.
            }
            resolve(result);
        };

        try {
            port1.onmessage = (event) => {
                let ok = false;
                try {
                    const data = event?.data;
                    ok = !!data
                        && typeof data === 'object'
                        && data.type === GIPHY_WORKER_POLICY_MESSAGE
                        && data.ready === true
                        && Number.isInteger(data.version)
                        && data.version >= 1
                        && container.controller === controller;
                } catch {
                    ok = false;
                }
                settle(ok);
            };
            timer = setTimeout(() => settle(false), timeoutMs);
            controller.postMessage({ type: GIPHY_WORKER_POLICY_MESSAGE }, [port2]);
        } catch {
            settle(false);
        }
    });
}

// --- Results ---

function safeGiphyUrl(value) {
    if (typeof value !== 'string') return null;
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'giphy.com' && !host.endsWith('.giphy.com')) return null;
    return value;
}

function uniqueNonNull(values) {
    const out = [];
    values.forEach((value) => {
        if (value !== null && !out.includes(value)) {
            out.push(value);
        }
    });
    return out;
}

function asObject(value) {
    return value && typeof value === 'object' ? value : {};
}

/**
 * PickerItem = { id: string|null, title: string, tileUrls: string[], previewUrls: string[] }
 */
function toPickerItem(raw) {
    const item = asObject(raw);
    const images = asObject(item.images);
    const fixedWidth = asObject(images.fixed_width);
    const original = asObject(images.original);
    const tileUrls = uniqueNonNull([safeGiphyUrl(fixedWidth.webp), safeGiphyUrl(fixedWidth.url)]);
    const previewUrls = uniqueNonNull([safeGiphyUrl(original.webp), ...tileUrls]);
    return {
        id: isGiphyId(item.id) ? item.id : null,
        title: typeof item.title === 'string' ? item.title.slice(0, GIPHY_TITLE_MAX_LENGTH) : '',
        tileUrls,
        previewUrls,
    };
}

// --- Requests ---

let rateLimitedUntil = 0;

function isOffline(isOnline) {
    if (typeof isOnline === 'function') {
        return isOnline() === false;
    }
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function callSafely(operation) {
    try {
        return Promise.resolve(operation());
    } catch (error) {
        return Promise.reject(error);
    }
}

/**
 * One page of GIPHY Trending (empty query) or Search. Fixed order of checks, one
 * request at most, no automatic retry. Every thrown error is a new GiphyClientError
 * whose message is its code.
 *
 * @returns {Promise<{ items: object[], nextOffset: number, hasMore: boolean }>}
 */
export async function fetchGiphyPage({
    query = '',
    offset = 0,
    signal = null,
    fetchImpl = fetch,
    workerReady = isGiphyWorkerReady,
    now = Date.now,
    isOnline,
} = {}) {
    if (signal?.aborted) throw new GiphyClientError('ABORTED');

    const key = getGiphyApiKey();
    if (!key) throw new GiphyClientError('MISSING_KEY');

    if (typeof query !== 'string' || query.length > GIPHY_QUERY_MAX_LENGTH) {
        throw new GiphyClientError('INVALID_QUERY');
    }
    const isSearch = query !== '';
    const maxOffset = isSearch ? GIPHY_SEARCH_MAX_OFFSET : GIPHY_TRENDING_MAX_OFFSET;
    if (!Number.isInteger(offset) || offset < 0 || offset > maxOffset) {
        throw new GiphyClientError('INVALID_QUERY');
    }

    if (now() < rateLimitedUntil) throw new GiphyClientError('RATE_LIMITED');

    if (isOffline(isOnline)) throw new GiphyClientError('OFFLINE');

    let ready = false;
    try {
        ready = (await workerReady()) === true;
    } catch {
        ready = false;
    }

    if (signal?.aborted) throw new GiphyClientError('ABORTED');
    if (!ready) throw new GiphyClientError('UPDATE_REQUIRED');

    const params = new URLSearchParams();
    params.set('api_key', key);
    if (isSearch) {
        params.set('q', query);
    }
    params.set('limit', String(GIPHY_PAGE_SIZE));
    params.set('offset', String(offset));
    params.set('rating', GIPHY_RATING);
    const url = `${isSearch ? GIPHY_SEARCH_URL : GIPHY_TRENDING_URL}?${params.toString()}`;

    const controller = new AbortController();
    let stoppedCode = null;
    let rejectStopped = null;
    const stopped = new Promise((_, reject) => {
        rejectStopped = reject;
    });
    stopped.catch(() => {});

    // The first of the caller's abort (ABORTED) and the timer (TIMEOUT) wins.
    const stop = (code) => {
        if (stoppedCode) return;
        stoppedCode = code;
        try {
            controller.abort();
        } catch {
            // Ignored.
        }
        rejectStopped(new GiphyClientError(code));
    };
    const onAbort = () => stop('ABORTED');
    const canListen = !!signal && typeof signal.addEventListener === 'function';
    const timer = setTimeout(() => stop('TIMEOUT'), GIPHY_REQUEST_TIMEOUT_MS);

    const guard = (pending) => {
        pending.catch(() => {});
        return Promise.race([pending, stopped]);
    };

    try {
        if (canListen) {
            signal.addEventListener('abort', onAbort);
        }
        if (signal?.aborted) {
            stop('ABORTED');
        }

        let response;
        try {
            response = await guard(callSafely(() => fetchImpl(url, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            })));
        } catch {
            throw new GiphyClientError(stoppedCode || (signal?.aborted ? 'ABORTED' : 'NETWORK'));
        }
        if (stoppedCode) throw new GiphyClientError(stoppedCode);

        const status = response?.status;
        if (status === 429) {
            rateLimitedUntil = now() + GIPHY_RATE_LIMIT_COOLDOWN_MS;
            throw new GiphyClientError('RATE_LIMITED');
        }
        if (status === 401 || status === 403) throw new GiphyClientError('KEY_REJECTED');
        if (typeof status !== 'number' || status < 200 || status > 299) {
            throw new GiphyClientError('UNAVAILABLE');
        }

        let body;
        try {
            body = await guard(callSafely(() => response.json()));
        } catch {
            throw new GiphyClientError(stoppedCode || (signal?.aborted ? 'ABORTED' : 'INVALID_RESPONSE'));
        }
        if (stoppedCode) throw new GiphyClientError(stoppedCode);
        if (signal?.aborted) throw new GiphyClientError('ABORTED');

        if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
            throw new GiphyClientError('INVALID_RESPONSE');
        }

        const data = body.data;
        const items = data.map(toPickerItem);
        const nextOffset = offset + data.length;
        const totalCount = body.pagination?.total_count;
        const hasMore = data.length > 0
            && nextOffset <= maxOffset
            && (Number.isSafeInteger(totalCount) ? nextOffset < totalCount : data.length === GIPHY_PAGE_SIZE);

        return { items, nextOffset, hasMore };
    } catch (error) {
        if (error?.isGiphyClientError) throw error;
        throw new GiphyClientError('UNAVAILABLE');
    } finally {
        clearTimeout(timer);
        if (canListen) {
            signal.removeEventListener('abort', onAbort);
        }
    }
}

/**
 * Tests only: clears the rate-limit cooldown.
 */
export function resetGiphyClientState() {
    rateLimitedUntil = 0;
}
