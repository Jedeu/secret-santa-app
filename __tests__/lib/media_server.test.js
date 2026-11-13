/** @jest-environment node */
import {
    MEDIA_UPLOADS_COLLECTION,
    MEDIA_RESERVATION_TTL_MS,
    MEDIA_PROVIDER_TIMEOUT_MS,
    MEDIA_BODY_READ_TIMEOUT_MS,
    MEDIA_MAX_ATTEMPTS,
    MediaError,
    buildPublicId,
    getAttachmentBindingError,
    getMediaConfig,
    quotaKeyFor,
    readBodyWithLimit,
    recordToAttachment,
    sha256Hex,
    uploadImageToProvider,
} from '@/lib/media-server';
import { pngHeaderBytes } from '../helpers/synthetic-images';

// Synthetic credentials and header-only bytes; no network request leaves the process.

const CONFIG = {
    cloudName: 'unit-cloud',
    apiKey: 'unit-key',
    apiSecret: 'unit-secret',
    apiBase: 'http://127.0.0.1:9',
    sandbox: true,
};
const PUBLIC_ID = 'ss-2026-0b6d2f4e-8a1c-4e3b-9d7f-5c2a1b0e9f8d';
const MEDIA_ID = '0b6d2f4e-8a1c-4e3b-9d7f-5c2a1b0e9f8d';
const PROVIDER_OK = {
    public_id: PUBLIC_ID,
    version: 1700000001,
    resource_type: 'image',
    type: 'upload',
    format: 'png',
    width: 640,
    height: 480,
    bytes: 4321,
    url: 'http://ignored.example/x.png',
    secure_url: 'https://ignored.example/x.png',
    extra_field: { nested: true },
};

function response(status, body, { invalidJson = false } = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: jest.fn(async () => {
            if (invalidJson) throw new SyntaxError('Unexpected token < in JSON');
            return body;
        }),
    };
}

function fakeRequest({ chunks = [], contentLength = null, hang = false, body = true } = {}) {
    let index = 0;
    const reader = {
        read: jest.fn(() => {
            if (index < chunks.length) {
                const value = chunks[index];
                index += 1;
                return Promise.resolve({ done: false, value });
            }
            if (hang) return new Promise(() => { });
            return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: jest.fn(() => Promise.resolve()),
    };
    const getReader = jest.fn(() => reader);
    return {
        reader,
        getReader,
        request: {
            headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? contentLength : null) },
            body: body ? { getReader } : null,
        },
    };
}

describe('media-server constants and helpers', () => {
    test('constants', () => {
        expect(MEDIA_UPLOADS_COLLECTION).toBe('mediaUploads');
        expect(MEDIA_RESERVATION_TTL_MS).toBe(60000);
        expect(MEDIA_PROVIDER_TIMEOUT_MS).toBe(8000);
        expect(MEDIA_BODY_READ_TIMEOUT_MS).toBe(25000);
        expect(MEDIA_MAX_ATTEMPTS).toBe(3);
    });

    test('MediaError carries status and code', () => {
        const error = new MediaError(413, 'MEDIA_TOO_LARGE', 'Too big');
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ status: 413, code: 'MEDIA_TOO_LARGE', message: 'Too big', isMediaError: true });
        expect(new MediaError(400, 'EMPTY_BODY').message).toBe('EMPTY_BODY');
    });

    test('sha256Hex', () => {
        expect(sha256Hex(new TextEncoder().encode('abc')))
            .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    test('buildPublicId and quotaKeyFor', () => {
        expect(buildPublicId(2026, MEDIA_ID)).toBe(PUBLIC_ID);
        expect(quotaKeyFor('uid-1', new Date('2026-12-01T23:59:59.000Z'))).toBe('uid-1|2026-12-01');
    });
});

describe('getMediaConfig', () => {
    const FULL = { CLOUDINARY_CLOUD_NAME: 'unit-cloud', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };

    test('all three variables enable the production API base', () => {
        expect(getMediaConfig({ ...FULL, NODE_ENV: 'production' })).toEqual({
            cloudName: 'unit-cloud',
            apiKey: 'k',
            apiSecret: 's',
            apiBase: 'https://api.cloudinary.com',
            sandbox: false,
        });
    });

    test.each([
        ['missing cloud name', { ...FULL, CLOUDINARY_CLOUD_NAME: undefined }],
        ['blank key', { ...FULL, CLOUDINARY_API_KEY: '   ' }],
        ['missing secret', { ...FULL, CLOUDINARY_API_SECRET: undefined }],
        ['malformed cloud name', { ...FULL, CLOUDINARY_CLOUD_NAME: 'bad/name' }],
    ])('%s -> null', (_label, env) => {
        expect(getMediaConfig(env)).toBeNull();
    });

    test('loopback override only outside production', () => {
        expect(getMediaConfig({ ...FULL, NODE_ENV: 'development', MEDIA_UPLOAD_API_BASE: 'http://127.0.0.1:8791' }))
            .toMatchObject({ apiBase: 'http://127.0.0.1:8791', sandbox: true });
        expect(getMediaConfig({ ...FULL, NODE_ENV: 'test', MEDIA_UPLOAD_API_BASE: 'http://localhost:9000' }))
            .toMatchObject({ apiBase: 'http://localhost:9000', sandbox: true });
        expect(getMediaConfig({ ...FULL, NODE_ENV: 'production', MEDIA_UPLOAD_API_BASE: 'http://127.0.0.1:8791' }))
            .toMatchObject({ apiBase: 'https://api.cloudinary.com', sandbox: false });
    });

    test.each([
        'https://127.0.0.1:8791',
        'http://evil.example:8791',
        'http://127.0.0.1:8791/path',
        'http://127.0.0.1',
        'http://10.0.0.1:80',
    ])('non-loopback override %s is ignored', (base) => {
        expect(getMediaConfig({ ...FULL, NODE_ENV: 'development', MEDIA_UPLOAD_API_BASE: base }))
            .toMatchObject({ apiBase: 'https://api.cloudinary.com', sandbox: false });
    });
});

describe('readBodyWithLimit', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('reads every chunk and leaves no timer', async () => {
        jest.useFakeTimers();
        const { request, reader } = fakeRequest({ chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] });

        const bytes = await readBodyWithLimit(request, { maxBytes: 10, timeoutMs: 1000 });

        expect(Array.from(bytes)).toEqual([1, 2, 3]);
        expect(reader.cancel).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    test('a content-length above the cap -> 413 without reading', async () => {
        jest.useFakeTimers();
        const { request, getReader } = fakeRequest({ chunks: [new Uint8Array([1])], contentLength: '11' });

        await expect(readBodyWithLimit(request, { maxBytes: 10, timeoutMs: 1000 }))
            .rejects.toMatchObject({ status: 413, code: 'MEDIA_TOO_LARGE' });
        expect(getReader).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    test('mid-stream overflow -> one cancel, no further reads, 413', async () => {
        jest.useFakeTimers();
        const { request, reader } = fakeRequest({
            chunks: [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])],
        });

        await expect(readBodyWithLimit(request, { maxBytes: 3, timeoutMs: 1000 }))
            .rejects.toMatchObject({ status: 413, code: 'MEDIA_TOO_LARGE' });
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('no body or zero bytes -> 400 EMPTY_BODY', async () => {
        jest.useFakeTimers();
        await expect(readBodyWithLimit(fakeRequest({ body: false }).request, { maxBytes: 10, timeoutMs: 1000 }))
            .rejects.toMatchObject({ status: 400, code: 'EMPTY_BODY' });
        expect(jest.getTimerCount()).toBe(0);

        await expect(readBodyWithLimit(fakeRequest({ chunks: [] }).request, { maxBytes: 10, timeoutMs: 1000 }))
            .rejects.toMatchObject({ status: 400, code: 'EMPTY_BODY' });
        expect(jest.getTimerCount()).toBe(0);
    });

    test('a read that never resolves -> 408 exactly at the deadline, one cancel', async () => {
        jest.useFakeTimers();
        const { request, reader } = fakeRequest({ chunks: [new Uint8Array([1])], hang: true });
        let settled = null;
        const pending = readBodyWithLimit(request, { maxBytes: 10, timeoutMs: 25000 }).then(
            () => { settled = 'resolved'; },
            (error) => { settled = error; }
        );

        await jest.advanceTimersByTimeAsync(24999);
        expect(settled).toBeNull();

        await jest.advanceTimersByTimeAsync(1);
        await pending;
        expect(settled).toMatchObject({ status: 408, code: 'UPLOAD_TIMEOUT', isMediaError: true });
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe('uploadImageToProvider', () => {
    const bytes = pngHeaderBytes(640, 480, { padding: 64 });
    let errorSpy;

    beforeEach(() => {
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        errorSpy.mockRestore();
        jest.useRealTimers();
    });

    function upload(fetchImpl, overrides = {}) {
        return uploadImageToProvider({
            config: CONFIG,
            bytes,
            mimeType: 'image/png',
            publicId: PUBLIC_ID,
            fetchImpl,
            ...overrides,
        });
    }

    test('posts multipart with Basic auth, fixed filename and the four fields; returns provider values', async () => {
        const fetchImpl = jest.fn(async () => response(200, PROVIDER_OK));

        const result = await upload(fetchImpl);

        expect(result).toEqual({ version: 1700000001, width: 640, height: 480, bytes: 4321 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:9/v1_1/unit-cloud/image/upload');
        expect(init.method).toBe('POST');
        expect(init.cache).toBe('no-store');
        expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('unit-key:unit-secret').toString('base64')}`);
        expect(init.signal).toBeDefined();

        const form = init.body;
        expect(form).toBeInstanceOf(FormData);
        const file = form.get('file');
        expect(file.name).toBe('upload');
        expect(file.type).toBe('image/png');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
        expect(form.get('public_id')).toBe(PUBLIC_ID);
        expect(form.get('overwrite')).toBe('false');
        expect(form.get('allowed_formats')).toBe('jpg,png,gif');
        expect(Array.from(form.keys()).sort()).toEqual(['allowed_formats', 'file', 'overwrite', 'public_id']);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    test('HTTP 400 -> 422 MEDIA_REJECTED', async () => {
        await expect(upload(jest.fn(async () => response(400, { error: { message: 'bad' } }))))
            .rejects.toMatchObject({ status: 422, code: 'MEDIA_REJECTED' });
        expect(errorSpy).toHaveBeenCalledWith('Media provider upload failed', { code: 'PROVIDER_HTTP', status: 400 });
    });

    test.each([401, 403, 420, 500, 503, 201])('HTTP %i -> 502 MEDIA_UPLOAD_FAILED', async (status) => {
        await expect(upload(jest.fn(async () => response(status, PROVIDER_OK))))
            .rejects.toMatchObject({ status: 502, code: 'MEDIA_UPLOAD_FAILED' });
    });

    test('non-JSON body -> 502', async () => {
        await expect(upload(jest.fn(async () => response(200, null, { invalidJson: true }))))
            .rejects.toMatchObject({ status: 502, code: 'MEDIA_UPLOAD_FAILED' });
        expect(errorSpy).toHaveBeenCalledWith('Media provider upload failed', { code: 'PROVIDER_INVALID_RESPONSE', status: 200 });
    });

    test('network error -> 502 with PROVIDER_NETWORK', async () => {
        await expect(upload(jest.fn(async () => { throw new TypeError('fetch failed'); })))
            .rejects.toMatchObject({ status: 502, code: 'MEDIA_UPLOAD_FAILED' });
        expect(errorSpy).toHaveBeenCalledWith('Media provider upload failed', { code: 'PROVIDER_NETWORK', status: null });
    });

    test.each([
        ['public_id', { public_id: 'ss-2026-other' }],
        ['resource_type', { resource_type: 'video' }],
        ['type', { type: 'private' }],
        ['format', { format: 'gif' }],
        ['version zero', { version: 0 }],
        ['version string', { version: '1700000001' }],
        ['width zero', { width: 0 }],
        ['width too large', { width: 4097 }],
        ['height fraction', { height: 1.5 }],
        ['bytes zero', { bytes: 0 }],
        ['bytes too large', { bytes: 3 * 1024 * 1024 + 1 }],
        ['not an object', null],
    ])('wrong %s -> 502', async (_label, change) => {
        const body = change === null ? 'string body' : { ...PROVIDER_OK, ...change };
        await expect(upload(jest.fn(async () => response(200, body))))
            .rejects.toMatchObject({ status: 502, code: 'MEDIA_UPLOAD_FAILED' });
        expect(errorSpy).toHaveBeenCalledWith('Media provider upload failed', { code: 'PROVIDER_INVALID_RESPONSE', status: 200 });
    });

    test('timeout aborts the signal, rejects 502 and clears the timer', async () => {
        jest.useFakeTimers();
        let signal = null;
        const fetchImpl = jest.fn((url, init) => {
            signal = init.signal;
            return new Promise(() => { });
        });
        let settled = null;
        const pending = upload(fetchImpl).then(
            () => { settled = 'resolved'; },
            (error) => { settled = error; }
        );

        await jest.advanceTimersByTimeAsync(MEDIA_PROVIDER_TIMEOUT_MS - 1);
        expect(settled).toBeNull();
        expect(signal.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(1);
        await pending;
        expect(signal.aborted).toBe(true);
        expect(settled).toMatchObject({ status: 502, code: 'MEDIA_UPLOAD_FAILED' });
        expect(errorSpy).toHaveBeenCalledWith('Media provider upload failed', { code: 'PROVIDER_TIMEOUT', status: null });
        expect(jest.getTimerCount()).toBe(0);
    });

    test('the timer also covers reading the response body', async () => {
        jest.useFakeTimers();
        const fetchImpl = jest.fn(async () => ({ status: 200, ok: true, json: () => new Promise(() => { }) }));
        const pending = upload(fetchImpl, { timeoutMs: 500 });
        const assertion = expect(pending).rejects.toMatchObject({ status: 502, code: 'MEDIA_UPLOAD_FAILED' });

        await jest.advanceTimersByTimeAsync(500);
        await assertion;
        expect(errorSpy).toHaveBeenCalledWith('Media provider upload failed', { code: 'PROVIDER_TIMEOUT', status: 200 });
        expect(jest.getTimerCount()).toBe(0);
    });

    test('success clears the timer', async () => {
        jest.useFakeTimers();
        await upload(jest.fn(async () => response(200, PROVIDER_OK)));
        expect(jest.getTimerCount()).toBe(0);
    });

    test('logged arguments are exactly { code, status } and never contain provider text', async () => {
        const marker = 'PROVIDER-ECHO-MARKER-7f3a';
        const echo = { error: { message: `${marker} unit-secret` }, public_id: marker };
        for (const status of [400, 500, 200]) {
            const body = status === 200 ? { ...PROVIDER_OK, public_id: marker } : echo;
            await expect(upload(jest.fn(async () => response(status, body)))).rejects.toBeInstanceOf(MediaError);
        }

        expect(errorSpy).toHaveBeenCalledTimes(3);
        errorSpy.mock.calls.forEach((call) => {
            expect(call).toHaveLength(2);
            expect(call[0]).toBe('Media provider upload failed');
            expect(Object.keys(call[1]).sort()).toEqual(['code', 'status']);
        });
        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).not.toContain(marker);
        expect(logged).not.toContain('unit-secret');
        expect(logged).not.toContain('unit-key');
    });
});

describe('recordToAttachment and getAttachmentBindingError', () => {
    const RECORD = {
        id: '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472',
        mediaId: MEDIA_ID,
        status: 'uploaded',
        attempts: 1,
        authUid: 'auth-uid',
        fromId: 'user-a',
        toId: 'user-b',
        conversationId: 'santa_user-a_recipient_user-b',
        year: 2026,
        epoch: 2,
        quotaKey: 'auth-uid|2026-12-01',
        sha256: 'f'.repeat(64),
        provider: 'cloudinary',
        cloudName: 'unit-cloud',
        publicId: PUBLIC_ID,
        staleProviderIds: [],
        format: 'png',
        width: 640,
        height: 480,
        bytes: 4321,
        version: 1700000001,
    };
    const EXPECTED = {
        mediaId: MEDIA_ID,
        authUid: 'auth-uid',
        fromId: 'user-a',
        toId: 'user-b',
        conversationId: 'santa_user-a_recipient_user-b',
        year: 2026,
        epoch: 2,
    };

    test('recordToAttachment maps mediaId to id and drops server fields', () => {
        const attachment = recordToAttachment(RECORD);
        expect(attachment).toEqual({
            id: MEDIA_ID,
            kind: 'image',
            provider: 'cloudinary',
            cloudName: 'unit-cloud',
            publicId: PUBLIC_ID,
            version: 1700000001,
            format: 'png',
            width: 640,
            height: 480,
            bytes: 4321,
        });
        expect(attachment).not.toHaveProperty('sha256');
        expect(recordToAttachment({ ...RECORD, version: null })).toBeNull();
        expect(recordToAttachment(null)).toBeNull();
    });

    test('binding checks', () => {
        expect(getAttachmentBindingError(RECORD, EXPECTED)).toBeNull();
        expect(getAttachmentBindingError(null, EXPECTED)).toBe('ATTACHMENT_NOT_FOUND');
        Object.keys(EXPECTED).forEach((key) => {
            const changed = typeof EXPECTED[key] === 'number' ? EXPECTED[key] + 1 : `${EXPECTED[key]}-x`;
            expect(getAttachmentBindingError(RECORD, { ...EXPECTED, [key]: changed })).toBe('ATTACHMENT_MISMATCH');
        });
        ['reserved', 'attached', 'failed'].forEach((status) => {
            expect(getAttachmentBindingError({ ...RECORD, status }, EXPECTED)).toBe('ATTACHMENT_NOT_READY');
        });
        expect(getAttachmentBindingError({ ...RECORD, version: null }, EXPECTED)).toBe('ATTACHMENT_NOT_READY');
    });
});
