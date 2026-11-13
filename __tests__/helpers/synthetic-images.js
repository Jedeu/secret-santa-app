/**
 * Synthetic image HEADER bytes for tests (no binary fixtures).
 *
 * Each function returns a Uint8Array built from literal byte arrays plus zero padding.
 * The bytes carry just enough for `sniffImage` to read a signature and dimensions.
 * They are NOT decodable images and no test may describe them as valid images.
 */

function u16be(value) {
    return [(value >> 8) & 0xff, value & 0xff];
}

function u16le(value) {
    return [value & 0xff, (value >> 8) & 0xff];
}

function u32be(value) {
    return [
        Math.floor(value / 0x1000000) & 0xff,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
    ];
}

function withPadding(header, padding) {
    const bytes = new Uint8Array(header.length + Math.max(0, padding));
    bytes.set(header, 0);
    return bytes;
}

/**
 * PNG signature + IHDR chunk header with width/height.
 * opts: { padding = 16 }
 */
export function pngHeaderBytes(width, height, { padding = 16 } = {}) {
    const header = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
        0x00, 0x00, 0x00, 0x0d, // IHDR length (13)
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        ...u32be(width),
        ...u32be(height),
        0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, colour type, compression, filter, interlace
    ];
    return withPadding(header, padding);
}

/**
 * GIF87a/GIF89a logical screen descriptor with width/height.
 * opts: { version = '89a', padding = 16 }
 */
export function gifHeaderBytes(width, height, { version = '89a', padding = 16 } = {}) {
    const versionByte = version === '87a' ? 0x37 : 0x39;
    const header = [
        0x47, 0x49, 0x46, 0x38, versionByte, 0x61, // "GIF87a" / "GIF89a"
        ...u16le(width),
        ...u16le(height),
        0x00, 0x00, 0x00, // packed fields, background, aspect
    ];
    return withPadding(header, padding);
}

/**
 * JPEG SOI, an APP0 (JFIF) segment, then a baseline SOF0 frame header with width/height.
 * opts: { padding = 16, sofMarker = 0xc0, app0 = true }
 */
export function jpegHeaderBytes(width, height, { padding = 16, sofMarker = 0xc0, app0 = true } = {}) {
    const soi = [0xff, 0xd8];
    const app0Segment = app0
        ? [
            0xff, 0xe0, 0x00, 0x10, // APP0, length 16
            0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
            0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        ]
        : [];
    const sof = [
        0xff, sofMarker, 0x00, 0x11, // SOFn, length 17
        0x08, // precision
        ...u16be(height),
        ...u16be(width),
        0x03, // components
        0x01, 0x22, 0x00,
        0x02, 0x11, 0x01,
        0x03, 0x11, 0x01,
    ];
    return withPadding([...soi, ...app0Segment, ...sof], padding);
}
