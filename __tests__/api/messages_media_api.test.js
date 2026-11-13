/** @jest-environment node */
import { GET, POST } from '@/app/api/messages/media/route';
import { firestore } from '@/lib/firebase';
import {
    verifyRequestToken,
    assertAdmissibleToken,
    runFencedTransaction,
    AdmissionError,
} from '@/lib/participant-admission';
import { sha256Hex, MEDIA_PROVIDER_TIMEOUT_MS } from '@/lib/media-server';
import { sniffImage } from '@/lib/message-media';
import { gifHeaderBytes, pngHeaderBytes } from '../helpers/synthetic-images';

/**
 * POST/GET /api/messages/media with an in-memory store, a fake fenced transaction and a
 * mocked provider (global fetch). Synthetic ids, credentials and header-only bytes: the
 * bytes are not decodable images; the provider mock never decodes them.
 */

jest.mock('@/lib/firebase', () => {
    const collection = jest.fn((path) => ({
        doc: (id) => ({ __kind: 'doc', path, id }),
        where: (field, op, value) => ({
            limit: (limit) => ({ __kind: 'query', path, field, op, value, limit }),
        }),
    }));
    return {
        auth: { verifyIdToken: jest.fn() },
        firestore: { collection },
    };
});

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        verifyRequestToken: jest.fn(),
        assertAdmissibleToken: jest.fn(),
        runFencedTransaction: jest.fn(),
    };
});

const UID = 'auth-uid';
const SANTA_ID = 'user-santa';
const RECIPIENT_ID = 'user-recipient';
const OTHER_ID = 'user-other';
const STRANGER_ID = 'user-stranger';
const CONV = `santa_${SANTA_ID}_recipient_${RECIPIENT_ID}`;
const REVERSE_CONV = `santa_${RECIPIENT_ID}_recipient_${SANTA_ID}`;
const CLIENT_MESSAGE_ID = '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472';
const OLD_MEDIA_ID = '9d1e2f3a-4b5c-4d6e-8f7a-0b1c2d3e4f5a';
const OLD_PUBLIC_ID = `ss-2025-${OLD_MEDIA_ID}`;
const PROVIDER_MARKER = 'synthetic-provider-text-91c2';

const PNG = pngHeaderBytes(640, 480, { padding: 200 });
const PNG_SHA = sha256Hex(PNG);

const USERS = {
    [SANTA_ID]: { id: SANTA_ID, recipientId: RECIPIENT_ID, gifterId: OTHER_ID },
    [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: OTHER_ID, gifterId: SANTA_ID },
    [OTHER_ID]: { id: OTHER_ID, recipientId: SANTA_ID, gifterId: RECIPIENT_ID },
    [STRANGER_ID]: { id: STRANGER_ID, recipientId: null, gifterId: null },
};

let mockStore;
let callbackDepth;
let fenceCalls;
let fenceScript;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function snap(ref) {
    const data = mockStore[ref.path]?.[ref.id];
    return { id: ref.id, exists: data !== undefined, data: () => clone(data) };
}

function runQuery(query) {
    const docs = Object.entries(mockStore[query.path] || {})
        .filter(([, data]) => data?.[query.field] === query.value)
        .slice(0, query.limit)
        .map(([id, data]) => ({ id, data: () => clone(data) }));
    return { size: docs.length, empty: docs.length === 0, docs };
}

function defaultContext() {
    return {
        uid: UID,
        email: 'santa@example.test',
        epoch: 1,
        year: 2025,
        state: 'active',
        user: clone(mockStore.users[SANTA_ID]),
    };
}

/**
 * Fake fenced transaction. fenceScript[i] (0-based call index) may be
 * { error } to throw before the callback, or { context } to override callback fields.
 * Writes apply only when the callback returns (a throw rolls back).
 */
function installFence() {
    runFencedTransaction.mockImplementation(async (decoded, work) => {
        const index = fenceCalls;
        fenceCalls += 1;
        const script = fenceScript[index] || {};
        if (script.error) throw script.error;

        const writes = [];
        const tx = {
            getAll: jest.fn(async (...refs) => refs.map(snap)),
            get: jest.fn(async (target) => (target.__kind === 'query' ? runQuery(target) : snap(target))),
            create: jest.fn((ref, data) => writes.push({ op: 'set', ref, data: clone(data) })),
            set: jest.fn((ref, data) => writes.push({ op: 'set', ref, data: clone(data) })),
            update: jest.fn((ref, data) => writes.push({ op: 'update', ref, data: clone(data) })),
        };
        const context = { ...defaultContext(), ...(script.context || {}) };

        callbackDepth += 1;
        let result;
        try {
            result = await work(tx, context);
        } finally {
            callbackDepth -= 1;
        }

        writes.forEach(({ op, ref, data }) => {
            mockStore[ref.path] = mockStore[ref.path] || {};
            mockStore[ref.path][ref.id] = op === 'update'
                ? { ...mockStore[ref.path][ref.id], ...data }
                : data;
        });
        return result;
    });
}

function providerResponse(status, body) {
    return { status, ok: status >= 200 && status < 300, json: jest.fn(async () => body) };
}

function providerOk(formData, overrides = {}) {
    return providerResponse(200, {
        public_id: formData.get('public_id'),
        version: 1700000123,
        resource_type: 'image',
        type: 'upload',
        format: 'png',
        width: 320,
        height: 240,
        bytes: 777,
        ...overrides,
    });
}

/**
 * Provider mock. `behavior(init, record)` returns the response; the default succeeds.
 * Records whether each call happened inside a fence callback and the record state then.
 */
function mockProvider(behavior = null) {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
        const record = clone(mockStore.mediaUploads?.[CLIENT_MESSAGE_ID]);
        calls.push({ url, init, insideCallback: callbackDepth > 0, record });
        return behavior ? behavior(init, record) : providerOk(init.body);
    });
    return calls;
}

function makeReader(bytes, { hang = false } = {}) {
    let done = false;
    return {
        read: jest.fn(() => {
            if (hang) return new Promise(() => { });
            if (done) return Promise.resolve({ done: true, value: undefined });
            done = true;
            return Promise.resolve({ done: false, value: bytes });
        }),
        cancel: jest.fn(() => Promise.resolve()),
    };
}

function mediaRequest({ bytes = PNG, contentType = 'image/png', headers = {}, hang = false, contentLength } = {}) {
    const all = {
        authorization: 'Bearer synthetic-token',
        'content-type': contentType,
        'x-media-to-id': RECIPIENT_ID,
        'x-media-sender-user-id': SANTA_ID,
        'x-media-conversation-id': CONV,
        'x-media-client-message-id': CLIENT_MESSAGE_ID,
        'content-length': contentLength === undefined ? String(bytes.length) : contentLength,
    };
    Object.entries(headers).forEach(([name, value]) => {
        all[name.toLowerCase()] = value;
    });
    const reader = makeReader(bytes, { hang });
    const getReader = jest.fn(() => reader);
    return {
        reader,
        getReader,
        request: {
            headers: { get: (name) => all[String(name).toLowerCase()] ?? null },
            body: { getReader },
        },
    };
}

function seedRecord(overrides = {}) {
    const record = {
        id: CLIENT_MESSAGE_ID,
        mediaId: OLD_MEDIA_ID,
        status: 'uploaded',
        attempts: 1,
        authUid: UID,
        fromId: SANTA_ID,
        toId: RECIPIENT_ID,
        conversationId: CONV,
        year: 2025,
        epoch: 1,
        quotaKey: `${UID}|2026-12-01`,
        sha256: PNG_SHA,
        provider: 'cloudinary',
        cloudName: 'unit-cloud',
        publicId: OLD_PUBLIC_ID,
        staleProviderIds: [],
        format: 'png',
        width: 320,
        height: 240,
        bytes: 777,
        version: 1700000000,
        createdAt: '2026-12-01T10:00:00.000Z',
        updatedAt: '2026-12-01T10:00:00.000Z',
        uploadedAt: '2026-12-01T10:00:01.000Z',
        attachedAt: null,
        ...overrides,
    };
    mockStore.mediaUploads[CLIENT_MESSAGE_ID] = record;
    return clone(record);
}

function record() {
    return mockStore.mediaUploads[CLIENT_MESSAGE_ID];
}

async function call(options = {}) {
    const built = mediaRequest(options);
    const res = await POST(built.request);
    return { res, body: await res.json(), ...built };
}

const ENV_KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'MEDIA_UPLOAD_API_BASE'];

describe('/api/messages/media', () => {
    let savedEnv;
    let savedFetch;

    beforeEach(() => {
        jest.clearAllMocks();
        savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
        savedFetch = global.fetch;
        process.env.CLOUDINARY_CLOUD_NAME = 'unit-cloud';
        process.env.CLOUDINARY_API_KEY = 'unit-key';
        process.env.CLOUDINARY_API_SECRET = 'unit-secret';
        delete process.env.MEDIA_UPLOAD_API_BASE;

        mockStore = { users: clone(USERS), messages: {}, mediaUploads: {} };
        callbackDepth = 0;
        fenceCalls = 0;
        fenceScript = [];
        installFence();
        verifyRequestToken.mockResolvedValue({ uid: UID, email: 'santa@example.test' });
        assertAdmissibleToken.mockReturnValue({ uid: UID, email: 'santa@example.test' });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        ENV_KEYS.forEach((key) => {
            if (savedEnv[key] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[key];
        });
        global.fetch = savedFetch;
        jest.useRealTimers();
        console.error.mockRestore();
    });

    describe('before the body is read', () => {
        test('503 MEDIA_DISABLED when unconfigured; no auth, no body read', async () => {
            delete process.env.CLOUDINARY_API_SECRET;
            const { res, body, getReader } = await call();

            expect(res.status).toBe(503);
            expect(body).toMatchObject({ code: 'MEDIA_DISABLED' });
            expect(getReader).not.toHaveBeenCalled();
            expect(verifyRequestToken).not.toHaveBeenCalled();
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });

        test('401 without a valid token; body never read', async () => {
            verifyRequestToken.mockRejectedValue(new AdmissionError('UNAUTHENTICATED'));
            const { res, body, getReader } = await call();

            expect(res.status).toBe(401);
            expect(body.code).toBe('UNAUTHENTICATED');
            expect(getReader).not.toHaveBeenCalled();
        });

        test('403 for an account not on any roster; body never read', async () => {
            assertAdmissibleToken.mockImplementation(() => { throw new AdmissionError('ACCESS_DENIED'); });
            const { res, body, getReader } = await call();

            expect(res.status).toBe(403);
            expect(body.code).toBe('ACCESS_DENIED');
            expect(getReader).not.toHaveBeenCalled();
        });

        test.each([
            ['missing recipient header', { 'x-media-to-id': null }],
            ['recipient with a slash', { 'x-media-to-id': 'a/b' }],
            ['sender too long', { 'x-media-sender-user-id': 'a'.repeat(129) }],
            ['conversation with a dot', { 'x-media-conversation-id': 'santa.x' }],
            ['client message id not a UUID', { 'x-media-client-message-id': 'not-a-uuid' }],
        ])('400 INVALID_REQUEST for %s', async (_label, headers) => {
            const { res, body, getReader } = await call({ headers });

            expect(res.status).toBe(400);
            expect(body).toMatchObject({ code: 'INVALID_REQUEST' });
            expect(getReader).not.toHaveBeenCalled();
        });

        test('415 for an unlisted content type; body never read', async () => {
            const { res, body, getReader } = await call({ contentType: 'image/webp' });

            expect(res.status).toBe(415);
            expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
            expect(getReader).not.toHaveBeenCalled();
        });

        test('413 for a declared length above 3 MiB; body never read', async () => {
            const { res, body, getReader } = await call({ contentLength: String(3 * 1024 * 1024 + 1) });

            expect(res.status).toBe(413);
            expect(body.code).toBe('MEDIA_TOO_LARGE');
            expect(getReader).not.toHaveBeenCalled();
        });
    });

    describe('body and header checks', () => {
        test('413 when the streamed body exceeds 3 MiB', async () => {
            const big = new Uint8Array(3 * 1024 * 1024 + 1);
            big.set(PNG, 0);
            const { res, body, reader } = await call({ bytes: big, contentLength: null });

            expect(res.status).toBe(413);
            expect(body.code).toBe('MEDIA_TOO_LARGE');
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });

        test('408 when the body stalls past the read deadline', async () => {
            jest.useFakeTimers();
            const built = mediaRequest({ hang: true });
            const pending = POST(built.request);

            await jest.advanceTimersByTimeAsync(0);
            await jest.advanceTimersByTimeAsync(25000);
            const res = await pending;

            expect(res.status).toBe(408);
            expect((await res.json()).code).toBe('UPLOAD_TIMEOUT');
            expect(built.reader.cancel).toHaveBeenCalledTimes(1);
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });

        test('415 when the declared type differs from the parsed header', async () => {
            const { res, body } = await call({ bytes: gifHeaderBytes(10, 10), contentType: 'image/png' });

            expect(res.status).toBe(415);
            expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });

        test('415 for HTML labelled image/png', async () => {
            const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
            const { res, body } = await call({ bytes: html, contentType: 'image/png' });

            expect(res.status).toBe(415);
            expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });

        test('400 MEDIA_DIMENSIONS for a side above 4096', async () => {
            const { res, body } = await call({ bytes: pngHeaderBytes(5000, 10) });

            expect(res.status).toBe(400);
            expect(body.code).toBe('MEDIA_DIMENSIONS');
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });
    });

    describe('happy path', () => {
        test('reserved -> uploaded; the attachment carries the provider values and no sha256', async () => {
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.replayed).toBeUndefined();
            expect(calls).toHaveLength(1);

            const stored = record();
            expect(stored).toMatchObject({
                id: CLIENT_MESSAGE_ID,
                status: 'uploaded',
                attempts: 1,
                authUid: UID,
                fromId: SANTA_ID,
                toId: RECIPIENT_ID,
                conversationId: CONV,
                year: 2025,
                epoch: 1,
                sha256: PNG_SHA,
                provider: 'cloudinary',
                cloudName: 'unit-cloud',
                staleProviderIds: [],
                format: 'png',
                version: 1700000123,
                width: 320,
                height: 240,
                bytes: 777,
                uploadedAt: expect.any(String),
                attachedAt: null,
            });
            expect(stored.quotaKey).toMatch(new RegExp(`^${UID}\\|\\d{4}-\\d{2}-\\d{2}$`));
            expect(stored.publicId).toBe(`ss-2025-${stored.mediaId}`);

            expect(body.attachment).toEqual({
                id: stored.mediaId,
                kind: 'image',
                provider: 'cloudinary',
                cloudName: 'unit-cloud',
                publicId: stored.publicId,
                version: 1700000123,
                format: 'png',
                width: 320,
                height: 240,
                bytes: 777,
            });
            expect(body.attachment).not.toHaveProperty('sha256');
            expect(JSON.stringify(body)).not.toContain(PNG_SHA);

            // The provider received the exact bytes under the reserved public id.
            const form = calls[0].init.body;
            expect(form.get('public_id')).toBe(stored.publicId);
            expect(new Uint8Array(await form.get('file').arrayBuffer())).toEqual(PNG);
        });

        test('the provider is called only after the reservation returned, never inside a callback', async () => {
            const calls = mockProvider();
            await call();

            expect(calls).toHaveLength(1);
            expect(calls[0].insideCallback).toBe(false);
            expect(calls[0].record).toMatchObject({ status: 'reserved', attempts: 1, sha256: PNG_SHA, version: null });
            expect(runFencedTransaction).toHaveBeenCalledTimes(2);
            expect(runFencedTransaction.mock.calls.every((args) => args.length === 2)).toBe(true);
        });
    });

    describe('reservation refusals write nothing and never call the provider', () => {
        test.each([
            ['SENDER_MISMATCH', 403, { headers: { 'x-media-sender-user-id': OTHER_ID } }],
            ['NOT_ASSIGNED', 400, { headers: { 'x-media-to-id': STRANGER_ID, 'x-media-conversation-id': `santa_${SANTA_ID}_recipient_${STRANGER_ID}` } }],
            ['INVALID_CONVERSATION', 400, { headers: { 'x-media-conversation-id': REVERSE_CONV } }],
            ['RECIPIENT_NOT_FOUND', 400, { headers: { 'x-media-to-id': 'user-missing', 'x-media-conversation-id': `santa_${SANTA_ID}_recipient_user-missing` } }],
        ])('%s', async (code, status, options) => {
            const calls = mockProvider();
            const { res, body } = await call(options);

            expect(res.status).toBe(status);
            expect(body.code).toBe(code);
            expect(mockStore.mediaUploads).toEqual({});
            expect(calls).toHaveLength(0);
        });

        test('missing recipient says "Recipient not found"', async () => {
            const { body } = await call({ headers: { 'x-media-to-id': 'user-missing' } });
            expect(body.error).toBe('Recipient not found');
        });

        test('YEAR_CLOSED at reservation', async () => {
            fenceScript = [{ error: new AdmissionError('YEAR_CLOSED') }];
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('YEAR_CLOSED');
            expect(mockStore.mediaUploads).toEqual({});
            expect(calls).toHaveLength(0);
        });

        test('MESSAGE_ALREADY_SENT when the message exists', async () => {
            mockStore.messages[CLIENT_MESSAGE_ID] = { id: CLIENT_MESSAGE_ID };
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('MESSAGE_ALREADY_SENT');
            expect(calls).toHaveLength(0);
        });
    });

    describe('same id', () => {
        test('same bytes on an uploaded record -> replayed, no provider call', async () => {
            const seeded = seedRecord({ status: 'uploaded' });
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(200);
            expect(body.replayed).toBe(true);
            expect(body.attachment).toMatchObject({ id: OLD_MEDIA_ID, publicId: OLD_PUBLIC_ID, version: 1700000000 });
            expect(body.attachment).not.toHaveProperty('sha256');
            expect(calls).toHaveLength(0);
            expect(record()).toEqual(seeded);
        });

        test('same bytes on an attached record -> replayed', async () => {
            seedRecord({ status: 'attached', attachedAt: '2026-12-01T10:00:02.000Z' });
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(200);
            expect(body.replayed).toBe(true);
            expect(calls).toHaveLength(0);
        });

        const STALE = '2000-01-01T00:00:00.000Z';
        const DIFFERENT_LENGTH = pngHeaderBytes(640, 480, { padding: 201 });
        const ONE_BYTE_CHANGED = (() => {
            const copy = new Uint8Array(PNG);
            copy[copy.length - 1] = 0x01;
            return copy;
        })();

        test.each([
            ['uploaded', 'a different length', { status: 'uploaded' }, DIFFERENT_LENGTH],
            ['uploaded', 'one byte changed', { status: 'uploaded' }, ONE_BYTE_CHANGED],
            ['failed', 'a different length', { status: 'failed', version: null }, DIFFERENT_LENGTH],
            ['failed', 'one byte changed', { status: 'failed', version: null }, ONE_BYTE_CHANGED],
            ['stale reserved', 'a different length', { status: 'reserved', version: null, updatedAt: STALE }, DIFFERENT_LENGTH],
            ['stale reserved', 'one byte changed', { status: 'reserved', version: null, updatedAt: STALE }, ONE_BYTE_CHANGED],
        ])('%s record, %s -> 409 MEDIA_ID_CONFLICT, record unchanged', async (_status, _change, overrides, bytes) => {
            expect(sha256Hex(bytes)).not.toBe(PNG_SHA);
            const seeded = seedRecord(overrides);
            const calls = mockProvider();
            const { res, body } = await call({ bytes });

            expect(res.status).toBe(409);
            expect(body.code).toBe('MEDIA_ID_CONFLICT');
            expect(calls).toHaveLength(0);
            expect(record()).toEqual(seeded);
        });

        test('one changed byte keeps equal length and equal parsed dimensions', () => {
            expect(ONE_BYTE_CHANGED.length).toBe(PNG.length);
            expect(sniffImage(ONE_BYTE_CHANGED)).toEqual(sniffImage(PNG));
        });

        test.each([
            ['authUid', { authUid: 'auth-other' }],
            ['toId', { toId: OTHER_ID }],
            ['conversationId', { conversationId: REVERSE_CONV }],
            ['year', { year: 2026 }],
            ['epoch', { epoch: 2 }],
            ['fromId', { fromId: OTHER_ID }],
        ])('a record bound to a different %s -> 409 MEDIA_ID_CONFLICT', async (_label, overrides) => {
            const seeded = seedRecord(overrides);
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('MEDIA_ID_CONFLICT');
            expect(calls).toHaveLength(0);
            expect(record()).toEqual(seeded);
        });

        test('a fresh reservation -> 409 UPLOAD_IN_PROGRESS', async () => {
            const seeded = seedRecord({ status: 'reserved', version: null, updatedAt: new Date().toISOString() });
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('UPLOAD_IN_PROGRESS');
            expect(calls).toHaveLength(0);
            expect(record()).toEqual(seeded);
        });

        test.each([
            ['stale reserved', { status: 'reserved', version: null, updatedAt: STALE }],
            ['failed', { status: 'failed', version: null }],
        ])('%s with the same digest -> takeover with a new public id', async (_label, overrides) => {
            seedRecord(overrides);
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(200);
            expect(calls).toHaveLength(1);
            expect(calls[0].record).toMatchObject({ status: 'reserved', attempts: 2, staleProviderIds: [OLD_PUBLIC_ID] });
            const stored = record();
            expect(stored.mediaId).not.toBe(OLD_MEDIA_ID);
            expect(stored.publicId).toBe(`ss-2025-${stored.mediaId}`);
            expect(stored).toMatchObject({ status: 'uploaded', attempts: 2, staleProviderIds: [OLD_PUBLIC_ID], createdAt: '2026-12-01T10:00:00.000Z' });
            expect(body.attachment.id).toBe(stored.mediaId);
        });

        test('attempts cap -> 409 UPLOAD_ATTEMPTS_EXCEEDED', async () => {
            const seeded = seedRecord({ status: 'failed', version: null, attempts: 3 });
            const calls = mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('UPLOAD_ATTEMPTS_EXCEEDED');
            expect(calls).toHaveLength(0);
            expect(record()).toEqual(seeded);
        });
    });

    test('daily quota -> 429 with no new record', async () => {
        const quotaKey = `${UID}|${new Date().toISOString().slice(0, 10)}`;
        for (let i = 0; i < 20; i += 1) {
            mockStore.mediaUploads[`other-${i}`] = { quotaKey, status: 'attached' };
        }
        const calls = mockProvider();
        const { res, body } = await call();

        expect(res.status).toBe(429);
        expect(body.code).toBe('MEDIA_QUOTA_EXCEEDED');
        expect(calls).toHaveLength(0);
        expect(record()).toBeUndefined();
    });

    test('19 earlier reservations still allow one more', async () => {
        const quotaKey = `${UID}|${new Date().toISOString().slice(0, 10)}`;
        for (let i = 0; i < 19; i += 1) {
            mockStore.mediaUploads[`other-${i}`] = { quotaKey, status: 'attached' };
        }
        mockProvider();
        const { res } = await call();
        expect(res.status).toBe(200);
    });

    describe('provider failure', () => {
        test.each([
            [500, 502, 'MEDIA_UPLOAD_FAILED'],
            [400, 422, 'MEDIA_REJECTED'],
        ])('provider %i while the reservation is held -> %i, record failed, no provider text', async (providerStatus, status, code) => {
            mockProvider(() => providerResponse(providerStatus, { error: { message: PROVIDER_MARKER } }));
            const { res, body } = await call();

            expect(res.status).toBe(status);
            expect(body.code).toBe(code);
            expect(JSON.stringify(body)).not.toContain(PROVIDER_MARKER);
            expect(record()).toMatchObject({ status: 'failed', attempts: 1, version: null });
            expect(JSON.stringify(console.error.mock.calls)).not.toContain(PROVIDER_MARKER);
        });

        test('a provider timeout is reported as the provider error', async () => {
            jest.useFakeTimers();
            mockProvider(() => new Promise(() => { }));
            const built = mediaRequest();
            const pending = POST(built.request);

            for (let i = 0; i < 5; i += 1) {
                await jest.advanceTimersByTimeAsync(0);
            }
            await jest.advanceTimersByTimeAsync(MEDIA_PROVIDER_TIMEOUT_MS);
            const res = await pending;

            expect(res.status).toBe(502);
            expect((await res.json()).code).toBe('MEDIA_UPLOAD_FAILED');
            expect(record()).toMatchObject({ status: 'failed' });
        });

        describe('the failure mark must not write', () => {
            function failingProvider(mutate = null) {
                let snapshot = null;
                mockProvider(() => {
                    if (mutate) mutate(mockStore.mediaUploads[CLIENT_MESSAGE_ID]);
                    snapshot = clone(mockStore.mediaUploads[CLIENT_MESSAGE_ID]);
                    return providerResponse(500, { error: { message: PROVIDER_MARKER } });
                });
                return () => snapshot;
            }

            test.each([
                ['the fence throws YEAR_CLOSED', { error: new AdmissionError('YEAR_CLOSED') }, null],
                ['the callback runs in a different year', { context: { year: 2026 } }, null],
                ['the callback runs at a different epoch', { context: { epoch: 2 } }, null],
                ['the callback has a different user.id', { context: { user: { id: OTHER_ID } } }, null],
                ['the callback has a different uid', { context: { uid: 'auth-other' } }, null],
                ['the record mediaId changed', {}, (stored) => { stored.mediaId = OLD_MEDIA_ID; }],
                ['the record is no longer reserved', {}, (stored) => { stored.status = 'uploaded'; }],
            ])('%s -> the original provider error and an unchanged record', async (_label, script, mutate) => {
                fenceScript = [{}, script];
                const snapshotAtProvider = failingProvider(mutate);
                const { res, body } = await call();

                expect(res.status).toBe(502);
                expect(body.code).toBe('MEDIA_UPLOAD_FAILED');
                expect(JSON.stringify(body)).not.toContain(PROVIDER_MARKER);
                expect(snapshotAtProvider()).not.toBeNull();
                expect(record()).toEqual(snapshotAtProvider());
                expect(runFencedTransaction).toHaveBeenCalledTimes(2);
            });

            test('a non-admission error thrown by the failure mark is swallowed', async () => {
                fenceScript = [{}, { error: Object.assign(new Error('unavailable'), { code: 'unavailable' }) }];
                const snapshotAtProvider = failingProvider();
                const { res, body } = await call();

                expect(res.status).toBe(502);
                expect(body.code).toBe('MEDIA_UPLOAD_FAILED');
                expect(record()).toEqual(snapshotAtProvider());
            });
        });
    });

    describe('finalize must not write', () => {
        test('the fence throws YEAR_CLOSED -> 409, record reserved, no attachment', async () => {
            fenceScript = [{}, { error: new AdmissionError('YEAR_CLOSED') }];
            mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('YEAR_CLOSED');
            expect(body.attachment).toBeUndefined();
            expect(record()).toMatchObject({ status: 'reserved', version: null, uploadedAt: null });
        });

        test('the caller is off the new roster -> 403, record reserved', async () => {
            fenceScript = [{}, { error: new AdmissionError('ACCESS_DENIED') }];
            mockProvider();
            const { res, body } = await call();

            expect(res.status).toBe(403);
            expect(body.attachment).toBeUndefined();
            expect(record()).toMatchObject({ status: 'reserved' });
        });

        test.each([
            ['a different year', { context: { year: 2026 } }, null],
            ['a different epoch', { context: { epoch: 2 } }, null],
            ['a different user.id', { context: { user: { id: OTHER_ID } } }, null],
            ['a different uid', { context: { uid: 'auth-other' } }, null],
            ['a changed mediaId', {}, (stored) => { stored.mediaId = OLD_MEDIA_ID; }],
            ['a changed status', {}, (stored) => { stored.status = 'failed'; }],
        ])('%s -> 409 UPLOAD_STALE and an unchanged record', async (_label, script, mutate) => {
            fenceScript = [{}, script];
            let snapshot = null;
            mockProvider((init) => {
                if (mutate) mutate(mockStore.mediaUploads[CLIENT_MESSAGE_ID]);
                snapshot = clone(mockStore.mediaUploads[CLIENT_MESSAGE_ID]);
                return providerOk(init.body);
            });
            const { res, body } = await call();

            expect(res.status).toBe(409);
            expect(body.code).toBe('UPLOAD_STALE');
            expect(body.attachment).toBeUndefined();
            expect(record()).toEqual(snapshot);
        });
    });

    describe('GET capability probe', () => {
        test('enabled without the sandbox; no Firestore call', async () => {
            const res = await GET(mediaRequest().request);

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ enabled: true, sandbox: false });
            expect(firestore.collection).not.toHaveBeenCalled();
            expect(runFencedTransaction).not.toHaveBeenCalled();
        });

        test('sandbox with a loopback API base outside production', async () => {
            process.env.MEDIA_UPLOAD_API_BASE = 'http://127.0.0.1:8791';
            const res = await GET(mediaRequest().request);

            expect(await res.json()).toEqual({ enabled: true, sandbox: true });
        });

        test('disabled when unconfigured', async () => {
            delete process.env.CLOUDINARY_CLOUD_NAME;
            const res = await GET(mediaRequest().request);

            expect(await res.json()).toEqual({ enabled: false, sandbox: false });
            expect(firestore.collection).not.toHaveBeenCalled();
        });

        test('requires a roster account', async () => {
            assertAdmissibleToken.mockImplementation(() => { throw new AdmissionError('ACCESS_DENIED'); });
            const res = await GET(mediaRequest().request);

            expect(res.status).toBe(403);
        });
    });
});
