import {
    MEDIA_FORMATS,
    MEDIA_MAX_DIMENSION,
    MEDIA_MAX_UPLOAD_BYTES,
    MEDIA_MIME_TYPES,
    fitWithin,
    getAttachmentUrl,
    getMessagePreviewText,
    isRenderableAttachment,
    isUuid,
    sniffImage,
    toPublicAttachment,
} from '@/lib/message-media';
import { gifHeaderBytes, jpegHeaderBytes, pngHeaderBytes } from '../helpers/synthetic-images';

// Header-only synthetic bytes: enough for the header parser, never decodable images.

const ATTACHMENT = Object.freeze({
    id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    kind: 'image',
    provider: 'cloudinary',
    cloudName: 'demo-cloud',
    publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    version: 1700000000,
    format: 'png',
    width: 1600,
    height: 1200,
    bytes: 524288,
});

function ascii(text) {
    return new TextEncoder().encode(text);
}

describe('message-media constants', () => {
    test('formats, types and limits', () => {
        expect(MEDIA_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/gif']);
        expect(MEDIA_FORMATS).toEqual(['jpg', 'png', 'gif']);
        expect(MEDIA_MAX_UPLOAD_BYTES).toBe(3 * 1024 * 1024);
        expect(MEDIA_MAX_DIMENSION).toBe(4096);
    });

    test('isUuid matches the send route pattern', () => {
        expect(isUuid(ATTACHMENT.id)).toBe(true);
        expect(isUuid('not-a-uuid')).toBe(false);
        expect(isUuid(null)).toBe(false);
        expect(isUuid('3f2b8c1d-5e6a-6b7c-9d8e-1f2a3b4c5d6e')).toBe(false);
    });
});

describe('sniffImage (header parser, not a validator)', () => {
    test('PNG header', () => {
        expect(sniffImage(pngHeaderBytes(640, 480))).toEqual({ mimeType: 'image/png', format: 'png', width: 640, height: 480 });
    });

    test('PNG with a large u32 width stays unsigned', () => {
        expect(sniffImage(pngHeaderBytes(70000, 2))).toMatchObject({ width: 70000, height: 2 });
    });

    test('GIF87a and GIF89a headers', () => {
        expect(sniffImage(gifHeaderBytes(64, 32))).toEqual({ mimeType: 'image/gif', format: 'gif', width: 64, height: 32 });
        expect(sniffImage(gifHeaderBytes(300, 2, { version: '87a' }))).toEqual({ mimeType: 'image/gif', format: 'gif', width: 300, height: 2 });
    });

    test('JPEG header after an APP0 segment, and directly after SOI', () => {
        expect(sniffImage(jpegHeaderBytes(3000, 2000))).toEqual({ mimeType: 'image/jpeg', format: 'jpg', width: 3000, height: 2000 });
        expect(sniffImage(jpegHeaderBytes(12, 34, { app0: false }))).toMatchObject({ width: 12, height: 34 });
    });

    test('JPEG progressive SOF2 is a frame header; DHT (C4) is not', () => {
        expect(sniffImage(jpegHeaderBytes(800, 600, { sofMarker: 0xc2 }))).toMatchObject({ width: 800, height: 600 });
        expect(sniffImage(jpegHeaderBytes(800, 600, { sofMarker: 0xc4, padding: 0 }))).toBeNull();
    });

    test('JPEG stops at SOS without a frame header', () => {
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]);
        expect(sniffImage(bytes)).toBeNull();
    });

    test('truncated headers return null without reading past the end', () => {
        const png = pngHeaderBytes(640, 480, { padding: 0 });
        const gif = gifHeaderBytes(64, 32, { padding: 0 });
        const jpeg = jpegHeaderBytes(640, 480, { padding: 0 });
        for (const full of [png, gif, jpeg]) {
            for (let length = 0; length < full.length - 4; length += 1) {
                const truncated = full.slice(0, length);
                const found = sniffImage(truncated);
                if (found) {
                    // Only possible once every dimension byte is present.
                    expect(found.width).toBeGreaterThan(0);
                }
            }
        }
        // PNG needs 24 bytes; GIF needs 10; this JPEG's SOF width ends at byte 29.
        expect(sniffImage(png.slice(0, 23))).toBeNull();
        expect(sniffImage(gif.slice(0, 9))).toBeNull();
        expect(sniffImage(jpeg.slice(0, 28))).toBeNull();
        expect(sniffImage(jpeg.slice(0, 29))).toMatchObject({ width: 640, height: 480 });
    });

    test('zero dimensions return null', () => {
        expect(sniffImage(pngHeaderBytes(0, 10))).toBeNull();
        expect(sniffImage(gifHeaderBytes(10, 0))).toBeNull();
        expect(sniffImage(jpegHeaderBytes(0, 0))).toBeNull();
    });

    test('HTML, SVG and WebP return null', () => {
        expect(sniffImage(ascii('<!doctype html><html><body>hi</body></html>'))).toBeNull();
        expect(sniffImage(ascii('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'))).toBeNull();
        const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(sniffImage(webp)).toBeNull();
    });

    test('non-byte input returns null; ArrayBuffer and Buffer are accepted', () => {
        expect(sniffImage(null)).toBeNull();
        expect(sniffImage('GIF89a')).toBeNull();
        expect(sniffImage([0x47, 0x49, 0x46])).toBeNull();
        const gif = gifHeaderBytes(5, 6);
        expect(sniffImage(gif.buffer)).toMatchObject({ width: 5, height: 6 });
        expect(sniffImage(Buffer.from(gif))).toMatchObject({ width: 5, height: 6 });
    });
});

describe('fitWithin', () => {
    test.each([
        [[2400, 1800, 1600], { width: 1600, height: 1200 }],
        [[3000, 2000, 1600], { width: 1600, height: 1067 }],
        [[1800, 2400, 1280], { width: 960, height: 1280 }],
        [[800, 600, 1600], { width: 800, height: 600 }],
        [[10000, 1, 1600], { width: 1600, height: 1 }],
    ])('fitWithin(%j)', (args, expected) => {
        expect(fitWithin(...args)).toEqual(expected);
    });
});

describe('isRenderableAttachment and toPublicAttachment', () => {
    test('accepts the full shape', () => {
        expect(isRenderableAttachment(ATTACHMENT)).toBe(true);
        expect(isRenderableAttachment({ ...ATTACHMENT, format: 'gif' })).toBe(true);
        expect(isRenderableAttachment({ ...ATTACHMENT, format: 'jpg' })).toBe(true);
    });

    test.each([
        ['null', null],
        ['array', [ATTACHMENT]],
        ['id', { ...ATTACHMENT, id: 'nope' }],
        ['kind', { ...ATTACHMENT, kind: 'video' }],
        ['provider', { ...ATTACHMENT, provider: 'other' }],
        ['cloudName chars', { ...ATTACHMENT, cloudName: 'evil.example.com/x' }],
        ['cloudName empty', { ...ATTACHMENT, cloudName: '' }],
        ['publicId slash', { ...ATTACHMENT, publicId: 'a/b' }],
        ['publicId too long', { ...ATTACHMENT, publicId: 'a'.repeat(129) }],
        ['version zero', { ...ATTACHMENT, version: 0 }],
        ['version string', { ...ATTACHMENT, version: '1' }],
        ['version unsafe', { ...ATTACHMENT, version: 2 ** 53 }],
        ['format', { ...ATTACHMENT, format: 'webp' }],
        ['width zero', { ...ATTACHMENT, width: 0 }],
        ['width too large', { ...ATTACHMENT, width: 4097 }],
        ['height fraction', { ...ATTACHMENT, height: 10.5 }],
        ['bytes zero', { ...ATTACHMENT, bytes: 0 }],
        ['bytes too large', { ...ATTACHMENT, bytes: MEDIA_MAX_UPLOAD_BYTES + 1 }],
    ])('rejects a bad %s', (_label, value) => {
        expect(isRenderableAttachment(value)).toBe(false);
        expect(toPublicAttachment(value)).toBeNull();
    });

    test('toPublicAttachment keeps exactly the 10 keys and drops extras such as sha256', () => {
        const copy = toPublicAttachment({ ...ATTACHMENT, sha256: 'abc', url: 'https://example.test/x', previewUrl: 'blob:x' });
        expect(copy).toEqual(ATTACHMENT);
        expect(Object.keys(copy).sort()).toEqual(
            ['bytes', 'cloudName', 'format', 'height', 'id', 'kind', 'provider', 'publicId', 'version', 'width']
        );
        expect(copy).not.toHaveProperty('sha256');
        expect(copy).not.toBe(ATTACHMENT);
    });
});

describe('getAttachmentUrl', () => {
    test('builds the fixed-host delivery URL', () => {
        expect(getAttachmentUrl(ATTACHMENT)).toBe(
            'https://res.cloudinary.com/demo-cloud/image/upload/v1700000000/ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e.png'
        );
        expect(getAttachmentUrl({ ...ATTACHMENT, format: 'gif' })).toMatch(/\.gif$/);
    });

    test('returns null for anything not renderable', () => {
        expect(getAttachmentUrl(null)).toBeNull();
        expect(getAttachmentUrl({ ...ATTACHMENT, cloudName: 'x/../../evil' })).toBeNull();
        expect(getAttachmentUrl({ ...ATTACHMENT, publicId: '../x' })).toBeNull();
        expect(getAttachmentUrl({ url: 'https://evil.example/x.png' })).toBeNull();
    });
});

describe('getMessagePreviewText', () => {
    test('text-only messages are unchanged', () => {
        expect(getMessagePreviewText({ content: 'Hello there' })).toBe('Hello there');
        expect(getMessagePreviewText({ content: 42 })).toBe('');
        expect(getMessagePreviewText(null)).toBe('');
    });

    test('captioned image', () => {
        expect(getMessagePreviewText({ content: 'Look!', attachment: ATTACHMENT })).toBe('📷 Look!');
    });

    test('media-only photo and GIF', () => {
        expect(getMessagePreviewText({ content: '', attachment: ATTACHMENT })).toBe('📷 Photo');
        expect(getMessagePreviewText({ content: '   ', attachment: { ...ATTACHMENT, format: 'gif' } })).toBe('📷 GIF');
    });
});
