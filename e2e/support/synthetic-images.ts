import type { Page } from '@playwright/test';

/**
 * Synthetic images for the media E2E spec. No dependency and no binary fixture.
 *
 * - buildAnimatedGif(): a hand-built two-frame GIF89a (red, then blue) using an
 *   uncompressed LZW stream. The browser under test is the decode proof.
 * - makeStillInPage(): PNG/JPEG bytes produced by the browser's own canvas toBlob, so
 *   still inputs are real images from the browser being tested.
 * - pasteImage(): dispatches a synthetic paste with a DataTransfer holding one File.
 */

const CLEAR_CODE = 4;
const END_CODE = 5;
const CODE_BITS = 3;

/**
 * Uncompressed LZW for GIF minimum code size 2: a clear code before every two pixels,
 * each pixel index as a literal, then the end code. Every code is 3 bits, packed
 * least-significant-bit first. Two literals per clear keep the decoder's table below
 * 8 entries, so the code size never grows.
 *
 * Reference vectors: [0,0,0,0] -> 04 08 14; [1,1,1,1] -> 4C 98 14.
 */
export function encodeUncompressedLzw(indices: number[]): Buffer {
    const codes: number[] = [];
    for (let i = 0; i < indices.length; i += 2) {
        codes.push(CLEAR_CODE);
        codes.push(indices[i] & 0x03);
        if (i + 1 < indices.length) {
            codes.push(indices[i + 1] & 0x03);
        }
    }
    codes.push(END_CODE);

    const bytes: number[] = [];
    let buffer = 0;
    let bitCount = 0;
    for (const code of codes) {
        buffer |= code << bitCount;
        bitCount += CODE_BITS;
        while (bitCount >= 8) {
            bytes.push(buffer & 0xff);
            buffer >>= 8;
            bitCount -= 8;
        }
    }
    if (bitCount > 0) {
        bytes.push(buffer & 0xff);
    }
    return Buffer.from(bytes);
}

function u16le(value: number): number[] {
    return [value & 0xff, (value >> 8) & 0xff];
}

function subBlocks(data: Buffer): number[] {
    const out: number[] = [];
    for (let offset = 0; offset < data.length; offset += 255) {
        const chunk = data.subarray(offset, Math.min(offset + 255, data.length));
        out.push(chunk.length, ...chunk);
    }
    out.push(0x00);
    return out;
}

function frame(size: number, colorIndex: number): number[] {
    const pixels = new Array<number>(size * size).fill(colorIndex);
    return [
        // Graphic control extension: disposal 1, 500 ms delay, no transparency.
        0x21, 0xf9, 0x04, 0x04, 0x32, 0x00, 0x00, 0x00,
        // Image descriptor: full logical screen, no local color table.
        0x2c, 0x00, 0x00, 0x00, 0x00, ...u16le(size), ...u16le(size), 0x00,
        // LZW minimum code size, then the data sub-blocks and terminator.
        0x02,
        ...subBlocks(encodeUncompressedLzw(pixels)),
    ];
}

/**
 * Two-frame looping GIF89a: frame 1 all red (index 0), frame 2 all blue (index 1).
 */
export function buildAnimatedGif(size = 64): Buffer {
    const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
    const screen = [...u16le(size), ...u16le(size), 0x80, 0x00, 0x00];
    const colorTable = [0xff, 0x00, 0x00, 0x00, 0x00, 0xff];
    const netscape = [
        0x21, 0xff, 0x0b,
        ...Buffer.from('NETSCAPE2.0', 'ascii'),
        0x03, 0x01, 0x00, 0x00, 0x00,
    ];
    return Buffer.from([
        ...header,
        ...screen,
        ...colorTable,
        ...netscape,
        ...frame(size, 0),
        ...frame(size, 1),
        0x3b,
    ]);
}

export type StillOptions = {
    width: number;
    height: number;
    type: 'image/png' | 'image/jpeg';
    quality?: number;
    noisy?: boolean;
};

/**
 * Draws on an in-page canvas and returns the browser's own toBlob bytes.
 * Plain: two flat colour halves. Noisy: a gradient with deterministic pixel noise.
 */
export async function makeStillInPage(page: Page, { width, height, type, quality, noisy = false }: StillOptions): Promise<Buffer> {
    const base64 = await page.evaluate(async (options) => {
        const canvas = document.createElement('canvas');
        canvas.width = options.width;
        canvas.height = options.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('2d context unavailable');

        if (options.noisy) {
            const image = context.createImageData(options.width, options.height);
            let seed = 0x2f6e2b1;
            for (let y = 0; y < options.height; y += 1) {
                for (let x = 0; x < options.width; x += 1) {
                    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
                    const noise = (seed >>> 24) % 64;
                    const offset = (y * options.width + x) * 4;
                    image.data[offset] = Math.min(255, Math.floor((x / options.width) * 191) + noise);
                    image.data[offset + 1] = Math.min(255, Math.floor((y / options.height) * 191) + noise);
                    image.data[offset + 2] = Math.min(255, 96 + noise);
                    image.data[offset + 3] = 255;
                }
            }
            context.putImageData(image, 0, 0);
        } else {
            const half = Math.floor(options.width / 2);
            context.fillStyle = '#d32f2f';
            context.fillRect(0, 0, half, options.height);
            context.fillStyle = '#1565c0';
            context.fillRect(half, 0, options.width - half, options.height);
        }

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, options.type, options.quality));
        if (!blob || blob.type !== options.type) throw new Error('toBlob did not produce the requested type');
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        return dataUrl.slice(dataUrl.indexOf(',') + 1);
    }, { width, height, type, quality: quality ?? null, noisy });
    return Buffer.from(base64, 'base64');
}

/**
 * Dispatches a synthetic paste on the message input with one File in a DataTransfer.
 */
export async function pasteImage(page: Page, bytes: Buffer, type: string, name = 'pasted-image'): Promise<void> {
    await page.evaluate(({ base64, type, name }) => {
        const binary = atob(base64);
        const data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            data[i] = binary.charCodeAt(i);
        }
        const file = new File([data], name, { type });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const input = document.querySelector('input[placeholder="Type a message..."]');
        if (!input) throw new Error('Message input not found');
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, { base64: bytes.toString('base64'), type, name });
}
