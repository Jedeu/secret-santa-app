/**
 * Message image attachments: shape, limits, header parser and URL builder.
 *
 * Pure module (no Firebase SDK, no imports), shared by the client and the server.
 *
 * An attachment is written only by the server (copied from a `mediaUploads` record) and
 * rendered only through a URL built here from validated structured fields on a fixed
 * host. `sniffImage` is a bounded header parser, NOT a validator: it proves a JPEG, PNG
 * or GIF signature and plausible dimensions, never that the data decodes.
 */

export const MEDIA_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MEDIA_STILL_TARGET_BYTES = 1024 * 1024;
export const MEDIA_STILL_MAX_EDGE = 1600;
export const MEDIA_STILL_FALLBACK_EDGE = 1280;
export const MEDIA_MAX_DIMENSION = 4096;
export const MEDIA_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MEDIA_MAX_INPUT_PIXELS = 50000000;
export const MEDIA_HEADER_SCAN_BYTES = 1024 * 1024;
export const MEDIA_DAILY_UPLOAD_LIMIT = 20;

export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
export const MEDIA_FORMATS = ['jpg', 'png', 'gif'];

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUD_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const PUBLIC_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const ATTACHMENT_KEYS = ['id', 'kind', 'provider', 'cloudName', 'publicId', 'version', 'format', 'width', 'height', 'bytes'];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR = [0x49, 0x48, 0x44, 0x52];

export function isUuid(value) {
    return typeof value === 'string' && UUID_V4_REGEX.test(value);
}

function toByteView(value) {
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
        return new Uint8Array(value);
    }
    return null;
}

function startsWith(bytes, signature, offset = 0) {
    if (bytes.length < offset + signature.length) return false;
    for (let i = 0; i < signature.length; i += 1) {
        if (bytes[offset + i] !== signature[i]) return false;
    }
    return true;
}

function readU16BE(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32BE(bytes, offset) {
    // Multiplication keeps the result unsigned.
    return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function result(mimeType, format, width, height) {
    if (!(width > 0) || !(height > 0)) return null;
    return { mimeType, format, width, height };
}

function sniffPng(bytes) {
    if (!startsWith(bytes, PNG_SIGNATURE)) return undefined;
    if (bytes.length < 24 || !startsWith(bytes, PNG_IHDR, 12)) return null;
    return result('image/png', 'png', readU32BE(bytes, 16), readU32BE(bytes, 20));
}

function sniffGif(bytes) {
    if (bytes.length < 6) return undefined;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
        && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
    if (!isGif) return undefined;
    if (bytes.length < 10) return null;
    return result('image/gif', 'gif', readU16LE(bytes, 6), readU16LE(bytes, 8));
}

function isSofMarker(marker) {
    return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function sniffJpeg(bytes) {
    if (!(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return undefined;

    let offset = 2;
    while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        // Skip fill bytes (0xFF padding before a marker code).
        let markerOffset = offset + 1;
        while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) {
            markerOffset += 1;
        }
        if (markerOffset >= bytes.length) return null;
        const marker = bytes[markerOffset];
        const segmentStart = markerOffset - 1;

        // Start of scan or end of image: no frame header was found.
        if (marker === 0xda || marker === 0xd9) return null;

        // Standalone markers without a length field.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            offset = markerOffset + 1;
            continue;
        }

        if (segmentStart + 4 > bytes.length) return null;
        const length = readU16BE(bytes, segmentStart + 2);
        if (length < 2) return null;

        if (isSofMarker(marker)) {
            if (segmentStart + 9 > bytes.length) return null;
            const height = readU16BE(bytes, segmentStart + 5);
            const width = readU16BE(bytes, segmentStart + 7);
            return result('image/jpeg', 'jpg', width, height);
        }

        offset = segmentStart + 2 + length;
    }
    return null;
}

/**
 * Bounded header parser for JPEG, PNG and GIF. Never reads past `bytes.length`.
 *
 * @param {Uint8Array} bytes
 * @returns {{ mimeType: string, format: 'jpg'|'png'|'gif', width: number, height: number } | null}
 */
export function sniffImage(bytes) {
    const view = toByteView(bytes);
    if (!view) return null;
    for (const sniff of [sniffPng, sniffGif, sniffJpeg]) {
        const found = sniff(view);
        if (found !== undefined) return found;
    }
    return null;
}

/**
 * Scale (width, height) so the longest side is at most maxEdge. Never upscales; rounds;
 * each side is at least 1.
 */
export function fitWithin(width, height, maxEdge) {
    const longest = Math.max(width, height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

function isIntegerInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * True for a non-null object whose 10 attachment fields all satisfy the message shape.
 */
export function isRenderableAttachment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return isUuid(value.id)
        && value.kind === 'image'
        && value.provider === 'cloudinary'
        && typeof value.cloudName === 'string' && CLOUD_NAME_REGEX.test(value.cloudName)
        && typeof value.publicId === 'string' && PUBLIC_ID_REGEX.test(value.publicId)
        && Number.isSafeInteger(value.version) && value.version > 0
        && MEDIA_FORMATS.includes(value.format)
        && isIntegerInRange(value.width, 1, MEDIA_MAX_DIMENSION)
        && isIntegerInRange(value.height, 1, MEDIA_MAX_DIMENSION)
        && isIntegerInRange(value.bytes, 1, MEDIA_MAX_UPLOAD_BYTES);
}

/**
 * A copy of exactly the 10 attachment keys when renderable, else null.
 */
export function toPublicAttachment(value) {
    if (!isRenderableAttachment(value)) return null;
    const copy = {};
    ATTACHMENT_KEYS.forEach((key) => {
        copy[key] = value[key];
    });
    return copy;
}

/**
 * Delivery URL on the fixed Cloudinary host, built only from validated fields.
 */
export function getAttachmentUrl(attachment) {
    if (!isRenderableAttachment(attachment)) return null;
    const { cloudName, version, publicId, format } = attachment;
    return `https://res.cloudinary.com/${cloudName}/image/upload/v${version}/${publicId}.${format}`;
}

/**
 * One-line preview of a message for thread lists.
 */
export function getMessagePreviewText(message) {
    const content = typeof message?.content === 'string' ? message.content : '';
    const attachment = message?.attachment;
    if (attachment && typeof attachment === 'object') {
        if (content.trim()) return `📷 ${content}`;
        return attachment.format === 'gif' ? '📷 GIF' : '📷 Photo';
    }
    return content;
}
