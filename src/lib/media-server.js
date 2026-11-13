import { createHash } from 'node:crypto';
import {
    MEDIA_MAX_DIMENSION,
    MEDIA_MAX_UPLOAD_BYTES,
    toPublicAttachment,
} from '@/lib/message-media';

/**
 * Server-only image upload helpers: configuration, bounded body reader, provider upload
 * and `mediaUploads` record helpers.
 *
 * No Firebase SDK import. Imported only by API routes (and tests), never by components,
 * hooks or client libraries. Secrets are read here only and are never logged or returned.
 */

export const MEDIA_UPLOADS_COLLECTION = 'mediaUploads';

export const MEDIA_RESERVATION_TTL_MS = 60000;
export const MEDIA_PROVIDER_TIMEOUT_MS = 8000;
export const MEDIA_BODY_READ_TIMEOUT_MS = 25000;
export const MEDIA_MAX_ATTEMPTS = 3;

const DEFAULT_API_BASE = 'https://api.cloudinary.com';
// Same rule as the attachment's `cloudName`.
const CLOUD_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const LOOPBACK_API_BASE_REGEX = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

const FORMAT_BY_MIME_TYPE = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
};

const BINDING_KEYS = ['mediaId', 'authUid', 'fromId', 'toId', 'conversationId', 'year', 'epoch'];

export class MediaError extends Error {
    constructor(status, code, message) {
        super(message || code);
        this.name = 'MediaError';
        this.status = status;
        this.code = code;
        this.isMediaError = true;
    }
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * Provider configuration, or null when any of the three variables is missing/blank or
 * the cloud name is malformed. The API base can be redirected only outside production
 * and only to a loopback http URL (test sandbox).
 *
 * @returns {{ cloudName: string, apiKey: string, apiSecret: string, apiBase: string, sandbox: boolean } | null}
 */
export function getMediaConfig(env = process.env) {
    const source = env || {};
    const cloudName = nonEmpty(source.CLOUDINARY_CLOUD_NAME);
    const apiKey = nonEmpty(source.CLOUDINARY_API_KEY);
    const apiSecret = nonEmpty(source.CLOUDINARY_API_SECRET);
    if (!cloudName || !apiKey || !apiSecret || !CLOUD_NAME_REGEX.test(cloudName)) {
        return null;
    }

    const override = source.MEDIA_UPLOAD_API_BASE;
    const sandbox = source.NODE_ENV !== 'production'
        && typeof override === 'string'
        && LOOPBACK_API_BASE_REGEX.test(override);

    return {
        cloudName,
        apiKey,
        apiSecret,
        apiBase: sandbox ? override : DEFAULT_API_BASE,
        sandbox,
    };
}

export function sha256Hex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

const READ_DEADLINE = Symbol('READ_DEADLINE');

/**
 * Read the raw request body under a byte cap and one total deadline.
 *
 * @returns {Promise<Uint8Array>}
 */
export async function readBodyWithLimit(request, { maxBytes, timeoutMs }) {
    const declared = request?.headers?.get?.('content-length');
    if (typeof declared === 'string' && declared.trim() !== '') {
        const declaredLength = Number(declared);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            throw new MediaError(413, 'MEDIA_TOO_LARGE', 'The image is too large.');
        }
    }

    const body = request?.body;
    if (!body || typeof body.getReader !== 'function') {
        throw new MediaError(400, 'EMPTY_BODY', 'No image was received.');
    }

    const reader = body.getReader();
    let cancelled = false;
    const cancelOnce = () => {
        if (cancelled) return;
        cancelled = true;
        try {
            const pending = reader.cancel();
            if (pending && typeof pending.catch === 'function') {
                pending.catch(() => {});
            }
        } catch {
            // Ignored: the read is being abandoned.
        }
    };

    let timer = null;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(READ_DEADLINE), timeoutMs);
    });
    deadline.catch(() => {});

    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            let step;
            try {
                const read = Promise.resolve(reader.read());
                read.catch(() => {});
                step = await Promise.race([read, deadline]);
            } catch (error) {
                if (error === READ_DEADLINE) {
                    cancelOnce();
                    throw new MediaError(408, 'UPLOAD_TIMEOUT', 'The upload took too long.');
                }
                throw error;
            }

            if (!step || step.done) break;
            const chunk = step.value;
            if (!chunk) continue;
            const length = typeof chunk.byteLength === 'number' ? chunk.byteLength : chunk.length;
            total += length;
            if (total > maxBytes) {
                cancelOnce();
                throw new MediaError(413, 'MEDIA_TOO_LARGE', 'The image is too large.');
            }
            chunks.push(chunk);
        }
    } finally {
        clearTimeout(timer);
    }

    if (total === 0) {
        throw new MediaError(400, 'EMPTY_BODY', 'No image was received.');
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += typeof chunk.byteLength === 'number' ? chunk.byteLength : chunk.length;
    });
    return bytes;
}

export function buildPublicId(year, mediaId) {
    return `ss-${year}-${mediaId}`;
}

export function quotaKeyFor(authUid, date = new Date()) {
    return `${authUid}|${date.toISOString().slice(0, 10)}`;
}

function logProviderFailure(code, status) {
    console.error('Media provider upload failed', { code, status });
}

function isIntegerInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function isValidProviderPayload(payload, { publicId, format }) {
    return !!payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && payload.public_id === publicId
        && payload.resource_type === 'image'
        && payload.type === 'upload'
        && payload.format === format
        && Number.isSafeInteger(payload.version) && payload.version > 0
        && isIntegerInRange(payload.width, 1, MEDIA_MAX_DIMENSION)
        && isIntegerInRange(payload.height, 1, MEDIA_MAX_DIMENSION)
        && isIntegerInRange(payload.bytes, 1, MEDIA_MAX_UPLOAD_BYTES);
}

function uploadFailed() {
    return new MediaError(502, 'MEDIA_UPLOAD_FAILED', "Couldn't upload the image. Try again.");
}

const PROVIDER_ABORTED = Symbol('PROVIDER_ABORTED');

/**
 * Upload one image to Cloudinary with Basic Auth. One AbortController and one timer cover
 * the request and reading the response body. Provider URLs are never read.
 *
 * @returns {Promise<{ version: number, width: number, height: number, bytes: number }>}
 */
export async function uploadImageToProvider({
    config,
    bytes,
    mimeType,
    publicId,
    fetchImpl = fetch,
    timeoutMs = MEDIA_PROVIDER_TIMEOUT_MS,
}) {
    const format = FORMAT_BY_MIME_TYPE[mimeType];
    if (!format) {
        throw new MediaError(415, 'UNSUPPORTED_MEDIA_TYPE', "That image type isn't supported.");
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    let onAbort = null;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(PROVIDER_ABORTED);
        controller.signal.addEventListener('abort', onAbort);
    });
    aborted.catch(() => {});

    const race = (operation) => {
        let pending;
        try {
            pending = Promise.resolve(operation());
        } catch (error) {
            pending = Promise.reject(error);
        }
        pending.catch(() => {});
        return Promise.race([pending, aborted]);
    };

    try {
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: mimeType }), 'upload');
        form.append('public_id', publicId);
        form.append('overwrite', 'false');
        form.append('allowed_formats', 'jpg,png,gif');

        const credentials = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
        const url = `${config.apiBase}/v1_1/${config.cloudName}/image/upload`;

        let response;
        try {
            response = await race(() => fetchImpl(url, {
                method: 'POST',
                headers: { Authorization: `Basic ${credentials}` },
                body: form,
                cache: 'no-store',
                signal: controller.signal,
            }));
        } catch {
            logProviderFailure(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK', null);
            throw uploadFailed();
        }

        const status = typeof response?.status === 'number' ? response.status : null;
        if (status === 400) {
            logProviderFailure('PROVIDER_HTTP', status);
            throw new MediaError(422, 'MEDIA_REJECTED', 'The image host rejected this file.');
        }
        if (status !== 200) {
            logProviderFailure('PROVIDER_HTTP', status);
            throw uploadFailed();
        }

        let payload;
        try {
            payload = await race(() => response.json());
        } catch {
            logProviderFailure(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_INVALID_RESPONSE', status);
            throw uploadFailed();
        }

        if (!isValidProviderPayload(payload, { publicId, format })) {
            logProviderFailure('PROVIDER_INVALID_RESPONSE', status);
            throw uploadFailed();
        }

        return {
            version: payload.version,
            width: payload.width,
            height: payload.height,
            bytes: payload.bytes,
        };
    } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
    }
}

/**
 * Public attachment for a `mediaUploads` record (mediaId -> id), or null.
 */
export function recordToAttachment(record) {
    if (!record || typeof record !== 'object') return null;
    return toPublicAttachment({
        id: record.mediaId,
        kind: 'image',
        provider: record.provider,
        cloudName: record.cloudName,
        publicId: record.publicId,
        version: record.version,
        format: record.format,
        width: record.width,
        height: record.height,
        bytes: record.bytes,
    });
}

/**
 * Whether `record` may be attached to the message described by `expected`.
 *
 * @param {object|null} record
 * @param {{ mediaId, authUid, fromId, toId, conversationId, year, epoch }} expected
 * @returns {null | 'ATTACHMENT_NOT_FOUND' | 'ATTACHMENT_MISMATCH' | 'ATTACHMENT_NOT_READY'}
 */
export function getAttachmentBindingError(record, expected) {
    if (!record) return 'ATTACHMENT_NOT_FOUND';
    if (BINDING_KEYS.some((key) => record[key] !== expected?.[key])) return 'ATTACHMENT_MISMATCH';
    if (record.status !== 'uploaded' || recordToAttachment(record) === null) return 'ATTACHMENT_NOT_READY';
    return null;
}
