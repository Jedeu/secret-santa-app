'use client';
import { clientAuth } from '@/lib/firebase-client';
import { getWritableScope } from '@/lib/year-client';
import {
    MEDIA_HEADER_SCAN_BYTES,
    MEDIA_MAX_DIMENSION,
    MEDIA_MAX_INPUT_BYTES,
    MEDIA_MAX_INPUT_PIXELS,
    MEDIA_MAX_UPLOAD_BYTES,
    MEDIA_MIME_TYPES,
    MEDIA_STILL_FALLBACK_EDGE,
    MEDIA_STILL_MAX_EDGE,
    MEDIA_STILL_TARGET_BYTES,
    fitWithin,
    isRenderableAttachment,
    sniffImage,
    toPublicAttachment,
} from '@/lib/message-media';

/**
 * Client image attachments: capability probe, image preparation and the session-fenced
 * upload to POST /api/messages/media.
 *
 * A media session is the writable scope object from year-client plus the Firebase uid,
 * captured when Send is pressed. Work continues only while `getWritableScope()` is that
 * same object and the uid is unchanged, so Close, Start, sign-out, account switch and a
 * same-account sign-out/in (a new scope object with the same key) all stop it.
 * Every upload has one total deadline; nothing it awaits can hang the composer.
 */

export const MEDIA_CLIENT_UPLOAD_TIMEOUT_MS = 45000;

const MEDIA_ROUTE = '/api/messages/media';
// Per-side bound checked from the file header before any browser decode.
const MEDIA_MAX_INPUT_EDGE = 16384;

const GENERIC_UPLOAD_ERROR = "Couldn't upload the image. Check your connection and try again.";
const YEAR_CLOSED_FALLBACK = "This year's exchange is closed and read-only.";

const MEDIA_ERROR_TEXT = {
    MEDIA_DISABLED: 'Image attachments are turned off right now. You can still send text.',
    MEDIA_TOO_LARGE: 'That image is too large to send.',
    MEDIA_DIMENSIONS: "That image's dimensions are too large to send.",
    MEDIA_ENCODE_FAILED: "Couldn't prepare that image. Try a different one.",
    MEDIA_QUOTA_EXCEEDED: "You've reached today's image limit. Try again tomorrow.",
    UPLOAD_IN_PROGRESS: 'This image is still uploading. Wait a moment, then press Send again.',
    OFFLINE: "You're offline. Connect to the internet to send an image.",
    UNSUPPORTED_MEDIA_TYPE: "That image type isn't supported. Use JPEG, PNG or GIF.",
    MEDIA_REJECTED: 'The image host rejected this file. It may be damaged or, for a GIF, too long.',
    UPLOAD_TIMEOUT: 'The upload took too long. Check your connection and press Send to try again.',
};

export class MediaClientError extends Error {
    constructor(code = 'UPLOAD_FAILED', status = null, message = null) {
        super(message || code);
        this.name = 'MediaClientError';
        this.code = code;
        this.status = status;
        this.isMediaClientError = true;
    }
}

/**
 * Fixed user-facing text for an error's `code`.
 */
export function describeMediaError(error) {
    const code = error?.code;
    if (code === 'YEAR_CLOSED') {
        return typeof error?.message === 'string' && error.message && error.message !== code
            ? error.message
            : YEAR_CLOSED_FALLBACK;
    }
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(MEDIA_ERROR_TEXT, code)) {
        return MEDIA_ERROR_TEXT[code];
    }
    return GENERIC_UPLOAD_ERROR;
}

// --- Session ---

/**
 * @returns {{ scope: object, ownerUid: string } | null}
 */
export function captureMediaSession({ ownerUid, fromUserId } = {}) {
    if (!ownerUid || !fromUserId) return null;
    const scope = getWritableScope();
    if (!scope || typeof scope.key !== 'string' || !scope.key.startsWith(`${ownerUid}|${fromUserId}|`)) {
        return null;
    }
    if (clientAuth?.currentUser?.uid !== ownerUid) return null;
    return { scope, ownerUid };
}

export function isMediaSessionCurrent(session) {
    return !!session
        && !!session.scope
        && getWritableScope() === session.scope
        && clientAuth?.currentUser?.uid === session.ownerUid;
}

// --- Capability probe ---

const enabledByUid = new Map();

/**
 * Whether image attachments are enabled for the signed-in account. Never throws.
 * Only `true` results are cached (per uid).
 */
export async function getMediaStatus({ ownerUid, fetchImpl = fetch } = {}) {
    try {
        const user = clientAuth?.currentUser;
        if (!ownerUid || !user || user.uid !== ownerUid || typeof user.getIdToken !== 'function') {
            return false;
        }
        if (enabledByUid.get(ownerUid) === true) {
            return true;
        }

        const token = await user.getIdToken(false);
        if (clientAuth?.currentUser?.uid !== ownerUid || !token) return false;

        const response = await fetchImpl(MEDIA_ROUTE, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        if (clientAuth?.currentUser?.uid !== ownerUid) return false;
        if (!response?.ok) return false;

        const body = await response.json();
        if (clientAuth?.currentUser?.uid !== ownerUid) return false;
        if (body?.enabled !== true) return false;

        enabledByUid.set(ownerUid, true);
        return true;
    } catch {
        return false;
    }
}

export function resetMediaStatusCache() {
    enabledByUid.clear();
}

// --- Preparation ---

async function readBlobBytes(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
        return new Uint8Array(await blob.arrayBuffer());
    }
    if (typeof FileReader === 'function') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(reader.error || new Error('read failed'));
            reader.readAsArrayBuffer(blob);
        });
    }
    throw new MediaClientError('MEDIA_ENCODE_FAILED');
}

async function defaultLoadImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Image decode failed'));
        });
        image.decoding = 'async';
        image.src = url;
        await loaded;
        if (typeof image.decode === 'function') {
            await image.decode();
        }
        return image;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function defaultCreateCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
        try {
            canvas.toBlob((blob) => resolve(blob || null), type, quality);
        } catch {
            resolve(null);
        }
    });
}

function releaseCanvas(canvas) {
    try {
        canvas.width = 0;
        canvas.height = 0;
    } catch {
        // Best effort only.
    }
}

async function encodeStill(file, sourceType, { loadImage, createCanvas }) {
    let image;
    try {
        image = await loadImage(file);
    } catch {
        throw new MediaClientError('MEDIA_ENCODE_FAILED');
    }

    const sourceWidth = Number(image?.naturalWidth);
    const sourceHeight = Number(image?.naturalHeight);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
        throw new MediaClientError('MEDIA_ENCODE_FAILED');
    }
    if (sourceWidth * sourceHeight > MEDIA_MAX_INPUT_PIXELS) {
        throw new MediaClientError('MEDIA_DIMENSIONS');
    }

    const steps = [];
    if (sourceType === 'image/png') {
        steps.push({ edge: MEDIA_STILL_MAX_EDGE, type: 'image/png', quality: undefined, fill: false });
    }
    steps.push({ edge: MEDIA_STILL_MAX_EDGE, type: 'image/jpeg', quality: 0.82, fill: true });
    steps.push({ edge: MEDIA_STILL_FALLBACK_EDGE, type: 'image/jpeg', quality: 0.7, fill: true });

    let producedTypedBlob = false;
    for (const step of steps) {
        const size = fitWithin(sourceWidth, sourceHeight, step.edge);
        const canvas = createCanvas(size.width, size.height);
        const context = canvas?.getContext ? canvas.getContext('2d') : null;
        if (!context) {
            continue;
        }
        if (step.fill) {
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, size.width, size.height);
        }
        context.drawImage(image, 0, 0, size.width, size.height);
        const blob = await canvasToBlob(canvas, step.type, step.quality);
        releaseCanvas(canvas);

        if (!blob || blob.type !== step.type) {
            continue;
        }
        producedTypedBlob = true;
        if (blob.size <= MEDIA_STILL_TARGET_BYTES) {
            return {
                blob,
                mimeType: step.type,
                width: size.width,
                height: size.height,
                bytes: blob.size,
            };
        }
    }

    throw new MediaClientError(producedTypedBlob ? 'MEDIA_TOO_LARGE' : 'MEDIA_ENCODE_FAILED');
}

/**
 * Prepare a pasted or picked file for upload. The header is checked before any object
 * URL or Image is created. GIFs are returned byte-for-byte; stills are re-encoded
 * (which strips metadata) to at most 1600 px and 1 MiB.
 *
 * @returns {Promise<{ blob: Blob, mimeType: string, width: number, height: number, bytes: number }>}
 */
export async function prepareImageForUpload(file, deps = {}) {
    const loadImage = typeof deps.loadImage === 'function' ? deps.loadImage : defaultLoadImage;
    const createCanvas = typeof deps.createCanvas === 'function' ? deps.createCanvas : defaultCreateCanvas;

    try {
        // Preflight: nothing below decodes the image.
        const declaredType = typeof file?.type === 'string' ? file.type : '';
        if (!file || !MEDIA_MIME_TYPES.includes(declaredType)) {
            throw new MediaClientError('UNSUPPORTED_MEDIA_TYPE');
        }
        const size = Number(file.size);
        if (!Number.isFinite(size) || size < 0) {
            throw new MediaClientError('UNSUPPORTED_MEDIA_TYPE');
        }
        if (size > MEDIA_MAX_INPUT_BYTES) {
            throw new MediaClientError('MEDIA_TOO_LARGE');
        }

        let header;
        try {
            header = await readBlobBytes(file.slice(0, Math.min(size, MEDIA_HEADER_SCAN_BYTES)));
        } catch {
            throw new MediaClientError('UNSUPPORTED_MEDIA_TYPE');
        }
        const sniffed = sniffImage(header);
        if (!sniffed || sniffed.mimeType !== declaredType) {
            throw new MediaClientError('UNSUPPORTED_MEDIA_TYPE');
        }
        if (sniffed.width > MEDIA_MAX_INPUT_EDGE
            || sniffed.height > MEDIA_MAX_INPUT_EDGE
            || sniffed.width * sniffed.height > MEDIA_MAX_INPUT_PIXELS) {
            throw new MediaClientError('MEDIA_DIMENSIONS');
        }

        if (declaredType === 'image/gif') {
            if (size > MEDIA_MAX_UPLOAD_BYTES) {
                throw new MediaClientError('MEDIA_TOO_LARGE');
            }
            if (sniffed.width > MEDIA_MAX_DIMENSION || sniffed.height > MEDIA_MAX_DIMENSION) {
                throw new MediaClientError('MEDIA_DIMENSIONS');
            }
            return {
                blob: file.slice(0, size, 'image/gif'),
                mimeType: 'image/gif',
                width: sniffed.width,
                height: sniffed.height,
                bytes: size,
            };
        }

        return await encodeStill(file, declaredType, { loadImage, createCanvas });
    } catch (error) {
        if (error?.isMediaClientError) throw error;
        throw new MediaClientError('MEDIA_ENCODE_FAILED');
    }
}

// --- Upload ---

async function readJsonOrNull(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Upload prepared bytes for one message. One internal AbortController, one total
 * deadline and one `stopped` promise cover every await (token, fetch, body, the 401
 * refresh, the retry and its body). The first of timeout (UPLOAD_TIMEOUT) and the
 * caller's `signal` (UPLOAD_CANCELLED) wins; once stopped, no further step starts.
 * The session is re-checked on entry and after every step (SESSION_CHANGED).
 *
 * @returns {Promise<object>} the server-built attachment
 */
export async function uploadMessageMedia({
    session,
    fromUserId,
    toId,
    conversationId,
    clientMessageId,
    blob,
    mimeType,
    signal = null,
    fetchImpl = fetch,
    timeoutMs = MEDIA_CLIENT_UPLOAD_TIMEOUT_MS,
} = {}) {
    const controller = new AbortController();
    let stopError = null;
    let rejectStopped = null;
    const stopped = new Promise((_, reject) => {
        rejectStopped = reject;
    });
    stopped.catch(() => {});

    const stop = (error) => {
        if (stopError) return;
        stopError = error;
        rejectStopped(error);
        try {
            controller.abort();
        } catch {
            // Ignored.
        }
    };

    const timer = setTimeout(() => stop(new MediaClientError('UPLOAD_TIMEOUT')), timeoutMs);
    const onAbort = () => stop(new MediaClientError('UPLOAD_CANCELLED'));
    if (signal) {
        signal.addEventListener('abort', onAbort);
        if (signal.aborted) {
            onAbort();
        }
    }

    const step = (operation) => {
        if (stopError) {
            return Promise.reject(stopError);
        }
        let pending;
        try {
            pending = Promise.resolve(operation());
        } catch (error) {
            pending = Promise.reject(error);
        }
        pending.catch(() => {});
        return Promise.race([pending, stopped]);
    };

    const checkpoint = () => {
        if (stopError) throw stopError;
        if (!isMediaSessionCurrent(session)) {
            throw new MediaClientError('SESSION_CHANGED');
        }
    };

    try {
        checkpoint();
        const authUser = clientAuth?.currentUser;
        if (!authUser || typeof authUser.getIdToken !== 'function') {
            throw new MediaClientError('SESSION_CHANGED');
        }

        const post = (token) => fetchImpl(MEDIA_ROUTE, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': mimeType,
                'X-Media-To-Id': toId,
                'X-Media-Sender-User-Id': fromUserId,
                'X-Media-Conversation-Id': conversationId,
                'X-Media-Client-Message-Id': clientMessageId,
            },
            body: blob,
            cache: 'no-store',
            signal: controller.signal,
        });

        let token = await step(() => authUser.getIdToken(false));
        checkpoint();
        if (!token) throw new MediaClientError('UPLOAD_FAILED');

        let response = await step(() => post(token));
        checkpoint();

        let body = null;
        if (response?.status === 401) {
            token = await step(() => authUser.getIdToken(true));
            checkpoint();
            if (!token) throw new MediaClientError('UPLOAD_FAILED', 401);

            response = await step(() => post(token));
            checkpoint();
        }

        body = await step(() => readJsonOrNull(response));
        checkpoint();

        if (!response?.ok) {
            const code = typeof body?.code === 'string' && body.code ? body.code : 'UPLOAD_FAILED';
            const message = typeof body?.error === 'string' && body.error ? body.error : null;
            throw new MediaClientError(code, typeof response?.status === 'number' ? response.status : null, message);
        }

        const attachment = body?.attachment;
        if (!isRenderableAttachment(attachment)) {
            throw new MediaClientError('INVALID_RESPONSE', response.status);
        }
        return toPublicAttachment(attachment);
    } catch (error) {
        if (error?.isMediaClientError) throw error;
        throw new MediaClientError('UPLOAD_FAILED');
    } finally {
        clearTimeout(timer);
        if (signal) {
            signal.removeEventListener('abort', onAbort);
        }
    }
}
