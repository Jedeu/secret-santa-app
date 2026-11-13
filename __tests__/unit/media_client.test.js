/** @jest-environment jsdom */
import {
    MEDIA_CLIENT_UPLOAD_TIMEOUT_MS,
    MediaClientError,
    captureMediaSession,
    describeMediaError,
    getMediaStatus,
    isMediaSessionCurrent,
    prepareImageForUpload,
    resetMediaStatusCache,
    uploadMessageMedia,
} from '@/lib/media-client';
import { setWritableScope } from '@/lib/year-client';
import { gifHeaderBytes, jpegHeaderBytes, pngHeaderBytes } from '../helpers/synthetic-images';

/**
 * Client media helpers. Synthetic uids/ids; header-only bytes from the T0 helper
 * (never decodable). JSDOM cannot decode images, so the still-encoding cases use
 * injected loadImage/createCanvas fakes and test control flow only.
 */

const mockAuth = { currentUser: null };

jest.mock('@/lib/firebase-client', () => ({
    clientAuth: {
        get currentUser() {
            return mockAuth.currentUser;
        },
    },
    firestore: {},
}));

const UID = 'uid-a';
const FROM = 'user-a';
const TO = 'user-b';
const CONV = 'santa_user-a_recipient_user-b';
const CLIENT_MESSAGE_ID = '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472';
const SCOPE_KEY = `${UID}|${FROM}|2026|2`;

const ATTACHMENT = {
    id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    kind: 'image',
    provider: 'cloudinary',
    cloudName: 'unit-cloud',
    publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    version: 1700000000,
    format: 'png',
    width: 640,
    height: 480,
    bytes: 4321,
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function flush() {
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }
}

function makeUser(uid = UID) {
    return {
        uid,
        getIdToken: jest.fn(async (force) => (force ? 'fresh-token' : 'token')),
    };
}

function jsonResponse(status, body) {
    return { status, ok: status >= 200 && status < 300, json: jest.fn(async () => body) };
}

function signIn(uid = UID, key = SCOPE_KEY) {
    mockAuth.currentUser = makeUser(uid);
    setWritableScope({ key, year: 2026 });
}

function session() {
    return captureMediaSession({ ownerUid: UID, fromUserId: FROM });
}

function uploadArgs(overrides = {}) {
    return {
        session: session(),
        fromUserId: FROM,
        toId: TO,
        conversationId: CONV,
        clientMessageId: CLIENT_MESSAGE_ID,
        blob: { type: 'image/png', size: 10 },
        mimeType: 'image/png',
        ...overrides,
    };
}

// Changes the writable scope to a new object with the same key (same-account sign-out/in).
function churnScope() {
    setWritableScope(null);
    setWritableScope({ key: SCOPE_KEY, year: 2026 });
}

function spiedSignal() {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    return { controller, signal: controller.signal, add, remove };
}

function expectListenerRemoved({ add, remove }) {
    const added = add.mock.calls.filter(([type]) => type === 'abort');
    expect(added).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('abort', added[0][1]);
}

/**
 * Duck-typed File over synthetic bytes. `size` may claim more bytes than exist.
 */
function duckBlob(bytes, type) {
    return {
        type,
        size: bytes.length,
        bytes,
        arrayBuffer: jest.fn(async () => bytes.slice().buffer),
    };
}

function duckFile(bytes, type, { size = bytes.length } = {}) {
    return {
        type,
        size,
        bytes,
        slice: jest.fn((start = 0, end = size, contentType = '') => duckBlob(bytes.slice(start, Math.min(end, bytes.length)), contentType)),
    };
}

/**
 * Canvas fakes: each toBlob call takes the next planned result
 * ({ size, type? } or null). Records fills and draws per canvas.
 */
function canvasFactory(plan) {
    const queue = [...plan];
    const canvases = [];
    const createCanvas = jest.fn((width, height) => {
        const context = { fillStyle: null, fillRect: jest.fn(), drawImage: jest.fn() };
        const canvas = {
            width,
            height,
            context,
            getContext: jest.fn(() => context),
            toBlob: jest.fn((callback, type, quality) => {
                const next = queue.shift();
                canvas.requested = { type, quality };
                callback(next ? { type: next.type ?? type, size: next.size } : null);
            }),
        };
        canvases.push(canvas);
        return canvas;
    });
    return { createCanvas, canvases };
}

describe('media-client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetMediaStatusCache();
        signIn();
    });

    afterEach(() => {
        jest.useRealTimers();
        setWritableScope(null);
        mockAuth.currentUser = null;
    });

    describe('MediaClientError and describeMediaError', () => {
        test('defaults', () => {
            const error = new MediaClientError();
            expect(error).toBeInstanceOf(Error);
            expect(error).toMatchObject({
                name: 'MediaClientError',
                code: 'UPLOAD_FAILED',
                status: null,
                message: 'UPLOAD_FAILED',
                isMediaClientError: true,
            });
        });

        test('explicit values', () => {
            expect(new MediaClientError('YEAR_CLOSED', 409, 'Closed.')).toMatchObject({
                code: 'YEAR_CLOSED',
                status: 409,
                message: 'Closed.',
            });
        });

        test('fixed strings', () => {
            expect(describeMediaError(new MediaClientError('UNSUPPORTED_MEDIA_TYPE')))
                .toBe("That image type isn't supported. Use JPEG, PNG or GIF.");
            expect(describeMediaError(new MediaClientError('MEDIA_REJECTED')))
                .toBe('The image host rejected this file. It may be damaged or, for a GIF, too long.');
            expect(describeMediaError(new MediaClientError('UPLOAD_TIMEOUT')))
                .toBe('The upload took too long. Check your connection and press Send to try again.');
            expect(describeMediaError(new MediaClientError('YEAR_CLOSED', 409, 'Server says closed.')))
                .toBe('Server says closed.');
            ['MEDIA_DISABLED', 'MEDIA_TOO_LARGE', 'MEDIA_DIMENSIONS', 'MEDIA_ENCODE_FAILED',
                'MEDIA_QUOTA_EXCEEDED', 'UPLOAD_IN_PROGRESS', 'OFFLINE'].forEach((code) => {
                const text = describeMediaError(new MediaClientError(code));
                expect(typeof text).toBe('string');
                expect(text).not.toBe(code);
                expect(text).not.toBe("Couldn't upload the image. Check your connection and try again.");
            });
        });

        test('anything else is generic', () => {
            const generic = "Couldn't upload the image. Check your connection and try again.";
            expect(describeMediaError(new MediaClientError('UPLOAD_FAILED'))).toBe(generic);
            expect(describeMediaError(new MediaClientError('SOMETHING_NEW', 500, 'raw server text'))).toBe(generic);
            expect(describeMediaError(new TypeError('boom'))).toBe(generic);
            expect(describeMediaError(null)).toBe(generic);
        });
    });

    describe('sessions', () => {
        test('captureMediaSession requires a matching scope and uid', () => {
            expect(session()).toEqual({ scope: expect.objectContaining({ key: SCOPE_KEY }), ownerUid: UID });

            setWritableScope(null);
            expect(session()).toBeNull();

            setWritableScope({ key: `${UID}|user-other|2026|2`, year: 2026 });
            expect(session()).toBeNull();

            signIn('uid-other', SCOPE_KEY);
            expect(session()).toBeNull();

            expect(captureMediaSession({ ownerUid: '', fromUserId: FROM })).toBeNull();
        });

        test('isMediaSessionCurrent tracks object identity and the uid', () => {
            let captured = session();
            expect(isMediaSessionCurrent(captured)).toBe(true);

            setWritableScope(null);
            expect(isMediaSessionCurrent(captured)).toBe(false);

            signIn();
            captured = session();
            setWritableScope({ key: `${UID}|${FROM}|2027|3`, year: 2027 });
            expect(isMediaSessionCurrent(captured)).toBe(false);

            signIn();
            captured = session();
            churnScope();
            expect(isMediaSessionCurrent(captured)).toBe(false);

            signIn();
            captured = session();
            mockAuth.currentUser = makeUser('uid-other');
            expect(isMediaSessionCurrent(captured)).toBe(false);

            expect(isMediaSessionCurrent(null)).toBe(false);
        });
    });

    describe('uploadMessageMedia basics', () => {
        test('posts the blob with the routing headers and returns the attachment', async () => {
            const fetchImpl = jest.fn(async () => jsonResponse(200, { success: true, attachment: { ...ATTACHMENT, sha256: 'x' } }));
            const blob = { type: 'image/png', size: 10 };

            const result = await uploadMessageMedia({ ...uploadArgs({ blob }), fetchImpl });

            expect(result).toEqual(ATTACHMENT);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            const [url, init] = fetchImpl.mock.calls[0];
            expect(url).toBe('/api/messages/media');
            expect(init.method).toBe('POST');
            expect(init.body).toBe(blob);
            expect(init.headers).toEqual({
                'Authorization': 'Bearer token',
                'Content-Type': 'image/png',
                'X-Media-To-Id': TO,
                'X-Media-Sender-User-Id': FROM,
                'X-Media-Conversation-Id': CONV,
                'X-Media-Client-Message-Id': CLIENT_MESSAGE_ID,
            });
            expect(init.signal).toBeDefined();
        });

        test('non-2xx maps the body code, status and error', async () => {
            const fetchImpl = jest.fn(async () => jsonResponse(409, { error: 'Closed for the year.', code: 'YEAR_CLOSED' }));

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl })).rejects.toMatchObject({
                code: 'YEAR_CLOSED',
                status: 409,
                message: 'Closed for the year.',
                isMediaClientError: true,
            });
        });

        test('non-2xx without a JSON body -> UPLOAD_FAILED with the status', async () => {
            const fetchImpl = jest.fn(async () => ({ status: 502, ok: false, json: async () => { throw new SyntaxError('x'); } }));

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl }))
                .rejects.toMatchObject({ code: 'UPLOAD_FAILED', status: 502 });
        });

        test('a 2xx body without a renderable attachment -> INVALID_RESPONSE', async () => {
            const fetchImpl = jest.fn(async () => jsonResponse(200, { success: true, attachment: { ...ATTACHMENT, cloudName: 'x/y' } }));

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl }))
                .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
        });

        test('a thrown network error -> UPLOAD_FAILED', async () => {
            const fetchImpl = jest.fn(async () => { throw new TypeError('Failed to fetch'); });

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl }))
                .rejects.toMatchObject({ code: 'UPLOAD_FAILED', status: null });
        });

        test('one 401 refresh with the captured user, then success', async () => {
            const user = mockAuth.currentUser;
            const fetchImpl = jest.fn()
                .mockResolvedValueOnce(jsonResponse(401, { error: 'expired', code: 'UNAUTHENTICATED' }))
                .mockResolvedValueOnce(jsonResponse(200, { attachment: ATTACHMENT }));

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl })).resolves.toEqual(ATTACHMENT);
            expect(user.getIdToken.mock.calls).toEqual([[false], [true]]);
            expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
        });

        test('a second 401 is not retried again', async () => {
            const fetchImpl = jest.fn(async () => jsonResponse(401, { error: 'expired', code: 'UNAUTHENTICATED' }));

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl }))
                .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        });
    });

    describe('uploadMessageMedia session boundaries', () => {
        test('before the token -> SESSION_CHANGED, no token request', async () => {
            const args = uploadArgs();
            const fetchImpl = jest.fn();
            churnScope();

            await expect(uploadMessageMedia({ ...args, fetchImpl })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
            expect(mockAuth.currentUser.getIdToken).not.toHaveBeenCalled();
            expect(fetchImpl).toHaveBeenCalledTimes(0);
        });

        test('after the token -> SESSION_CHANGED with 0 fetches', async () => {
            const args = uploadArgs();
            mockAuth.currentUser.getIdToken.mockImplementationOnce(async () => {
                churnScope();
                return 'token';
            });
            const fetchImpl = jest.fn();

            await expect(uploadMessageMedia({ ...args, fetchImpl })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
            expect(fetchImpl).toHaveBeenCalledTimes(0);
        });

        test('after the fetch -> SESSION_CHANGED, body not read', async () => {
            const args = uploadArgs();
            const response = jsonResponse(200, { attachment: ATTACHMENT });
            const fetchImpl = jest.fn(async () => {
                setWritableScope(null);
                return response;
            });

            await expect(uploadMessageMedia({ ...args, fetchImpl })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(response.json).not.toHaveBeenCalled();
        });

        test('after the body -> SESSION_CHANGED', async () => {
            const args = uploadArgs();
            const fetchImpl = jest.fn(async () => ({
                status: 200,
                ok: true,
                json: async () => {
                    mockAuth.currentUser = makeUser('uid-other');
                    return { attachment: ATTACHMENT };
                },
            }));

            await expect(uploadMessageMedia({ ...args, fetchImpl })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('after the 401 refresh token -> SESSION_CHANGED with 1 fetch', async () => {
            const args = uploadArgs();
            const user = mockAuth.currentUser;
            user.getIdToken.mockImplementation(async (force) => {
                if (force) churnScope();
                return force ? 'fresh-token' : 'token';
            });
            const fetchImpl = jest.fn(async () => jsonResponse(401, { code: 'UNAUTHENTICATED' }));

            await expect(uploadMessageMedia({ ...args, fetchImpl })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('after the retry fetch -> SESSION_CHANGED with 2 fetches', async () => {
            const args = uploadArgs();
            const fetchImpl = jest.fn()
                .mockResolvedValueOnce(jsonResponse(401, { code: 'UNAUTHENTICATED' }))
                .mockImplementationOnce(async () => {
                    churnScope();
                    return jsonResponse(200, { attachment: ATTACHMENT });
                });

            await expect(uploadMessageMedia({ ...args, fetchImpl })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        });
    });

    describe('uploadMessageMedia deadline', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        function track(promise) {
            const state = { settled: false, value: undefined, error: undefined };
            promise.then(
                (value) => { state.settled = true; state.value = value; },
                (error) => { state.settled = true; state.error = error; }
            );
            return state;
        }

        test('an initial token that never resolves times out at exactly 45,000 ms with 0 fetches', async () => {
            expect(MEDIA_CLIENT_UPLOAD_TIMEOUT_MS).toBe(45000);
            const token = deferred();
            mockAuth.currentUser.getIdToken.mockReturnValueOnce(token.promise);
            const fetchImpl = jest.fn();
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl }));

            await jest.advanceTimersByTimeAsync(44999);
            expect(state.settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
            expect(fetchImpl).toHaveBeenCalledTimes(0);

            token.resolve('late-token');
            await flush();
            expect(fetchImpl).toHaveBeenCalledTimes(0);
            expect(jest.getTimerCount()).toBe(0);
        });

        test('a fetch that never resolves times out and aborts its signal; a late response does nothing', async () => {
            const gate = deferred();
            const response = jsonResponse(200, { attachment: ATTACHMENT });
            const fetchImpl = jest.fn(() => gate.promise);
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl }));

            await jest.advanceTimersByTimeAsync(MEDIA_CLIENT_UPLOAD_TIMEOUT_MS);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);

            gate.resolve(response);
            await flush();
            expect(response.json).not.toHaveBeenCalled();
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('a body read that never resolves times out', async () => {
            const fetchImpl = jest.fn(async () => ({ status: 200, ok: true, json: () => new Promise(() => { }) }));
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl }));

            await jest.advanceTimersByTimeAsync(MEDIA_CLIENT_UPLOAD_TIMEOUT_MS);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
        });

        test('a 401 refresh token that never resolves times out with exactly 1 fetch', async () => {
            const refresh = deferred();
            mockAuth.currentUser.getIdToken.mockImplementation((force) => (force ? refresh.promise : Promise.resolve('token')));
            const fetchImpl = jest.fn(async () => jsonResponse(401, { code: 'UNAUTHENTICATED' }));
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl }));

            await jest.advanceTimersByTimeAsync(MEDIA_CLIENT_UPLOAD_TIMEOUT_MS);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
            expect(fetchImpl).toHaveBeenCalledTimes(1);

            refresh.resolve('late-fresh-token');
            await flush();
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('the deadline is total: 30 s token + 20 s fetch times out at 45 s', async () => {
            mockAuth.currentUser.getIdToken.mockImplementationOnce(
                () => new Promise((resolve) => setTimeout(() => resolve('token'), 30000))
            );
            const fetchImpl = jest.fn(
                () => new Promise((resolve) => setTimeout(() => resolve(jsonResponse(200, { attachment: ATTACHMENT })), 20000))
            );
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl }));

            await jest.advanceTimersByTimeAsync(30000);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(state.settled).toBe(false);

            await jest.advanceTimersByTimeAsync(14999);
            expect(state.settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
        });

        test('a custom timeoutMs is honored', async () => {
            const fetchImpl = jest.fn(() => new Promise(() => { }));
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl, timeoutMs: 1000 }));

            await jest.advanceTimersByTimeAsync(999);
            expect(state.settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
        });

        test('a step rejecting after the stop is already handled', async () => {
            const token = deferred();
            const thenSpy = jest.spyOn(token.promise, 'then');
            mockAuth.currentUser.getIdToken.mockReturnValueOnce(token.promise);
            const state = track(uploadMessageMedia({ ...uploadArgs(), fetchImpl: jest.fn() }));

            await jest.advanceTimersByTimeAsync(MEDIA_CLIENT_UPLOAD_TIMEOUT_MS);
            expect(state.error).toMatchObject({ code: 'UPLOAD_TIMEOUT' });

            // A rejection handler was attached before the late rejection.
            expect(thenSpy.mock.calls.some(([, onRejected]) => typeof onRejected === 'function')).toBe(true);
            token.reject(new Error('late token failure'));
            await flush();
            expect(state.error.code).toBe('UPLOAD_TIMEOUT');
        });
    });

    describe('uploadMessageMedia cancellation', () => {
        test('the caller aborting during the fetch -> UPLOAD_CANCELLED, not UPLOAD_TIMEOUT', async () => {
            jest.useFakeTimers();
            const { controller, signal } = spiedSignal();
            const fetchImpl = jest.fn(() => new Promise(() => { }));
            const pending = uploadMessageMedia({ ...uploadArgs(), fetchImpl, signal });
            const assertion = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });

            await jest.advanceTimersByTimeAsync(10);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            controller.abort();
            await assertion;
            expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
        });

        test('a signal already aborted on entry -> UPLOAD_CANCELLED with no token request or fetch', async () => {
            const { controller, signal, add, remove } = spiedSignal();
            controller.abort();
            const fetchImpl = jest.fn();

            await expect(uploadMessageMedia({ ...uploadArgs(), fetchImpl, signal }))
                .rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
            expect(mockAuth.currentUser.getIdToken).not.toHaveBeenCalled();
            expect(fetchImpl).not.toHaveBeenCalled();
            expectListenerRemoved({ add, remove });
        });

        test('cancel then timer -> still UPLOAD_CANCELLED', async () => {
            jest.useFakeTimers();
            const { controller, signal } = spiedSignal();
            const fetchImpl = jest.fn(() => new Promise(() => { }));
            const pending = uploadMessageMedia({ ...uploadArgs(), fetchImpl, signal, timeoutMs: 100 });
            const assertion = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });

            await jest.advanceTimersByTimeAsync(50);
            controller.abort();
            await jest.advanceTimersByTimeAsync(100);
            await assertion;
        });
    });

    describe('uploadMessageMedia cleanup', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        async function settle(promise, ms = MEDIA_CLIENT_UPLOAD_TIMEOUT_MS) {
            const outcome = promise.then(() => null, (error) => error);
            await jest.advanceTimersByTimeAsync(ms);
            return outcome;
        }

        test.each([
            ['success', () => jest.fn(async () => jsonResponse(200, { attachment: ATTACHMENT })), null, null],
            ['HTTP error', () => jest.fn(async () => jsonResponse(500, { code: 'INTERNAL' })), null, 'INTERNAL'],
            ['session change', () => jest.fn(async () => { setWritableScope(null); return jsonResponse(200, {}); }), null, 'SESSION_CHANGED'],
            ['timeout', () => jest.fn(() => new Promise(() => { })), null, 'UPLOAD_TIMEOUT'],
            ['cancellation', () => jest.fn(() => new Promise(() => { })), 'abort', 'UPLOAD_CANCELLED'],
        ])('after %s: no timers left and the abort listener removed', async (_label, makeFetch, action, code) => {
            const spied = spiedSignal();
            const pending = uploadMessageMedia({ ...uploadArgs(), fetchImpl: makeFetch(), signal: spied.signal });
            if (action === 'abort') {
                await jest.advanceTimersByTimeAsync(5);
                spied.controller.abort();
            }
            const error = await settle(pending);

            if (code) {
                expect(error).toMatchObject({ code });
            } else {
                expect(error).toBeNull();
            }
            expect(jest.getTimerCount()).toBe(0);
            expectListenerRemoved(spied);
        });
    });

    describe('getMediaStatus', () => {
        test('no request without a matching uid', async () => {
            const fetchImpl = jest.fn();
            expect(await getMediaStatus({ ownerUid: 'uid-other', fetchImpl })).toBe(false);
            expect(await getMediaStatus({ ownerUid: null, fetchImpl })).toBe(false);
            mockAuth.currentUser = null;
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(false);
            expect(fetchImpl).not.toHaveBeenCalled();
        });

        test('true only for ok + enabled; successes are cached per uid', async () => {
            const fetchImpl = jest.fn(async () => jsonResponse(200, { enabled: true, sandbox: false }));
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(true);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(true);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(fetchImpl.mock.calls[0][0]).toBe('/api/messages/media');
            expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
        });

        test('disabled or failing responses are false and not cached', async () => {
            const fetchImpl = jest.fn()
                .mockResolvedValueOnce(jsonResponse(200, { enabled: false }))
                .mockResolvedValueOnce(jsonResponse(503, { enabled: true }))
                .mockResolvedValueOnce(jsonResponse(200, { enabled: true }));
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(false);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(false);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(true);
            expect(fetchImpl).toHaveBeenCalledTimes(3);
        });

        test('a uid change during the token await -> false, nothing cached', async () => {
            const token = deferred();
            mockAuth.currentUser.getIdToken.mockReturnValueOnce(token.promise);
            const fetchImpl = jest.fn(async () => jsonResponse(200, { enabled: true }));
            const pending = getMediaStatus({ ownerUid: UID, fetchImpl });

            mockAuth.currentUser = makeUser('uid-other');
            token.resolve('token');
            expect(await pending).toBe(false);
            expect(fetchImpl).not.toHaveBeenCalled();

            mockAuth.currentUser = makeUser(UID);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(true);
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        });

        test('a uid change during the fetch await -> false, nothing cached', async () => {
            const fetchImpl = jest.fn()
                .mockImplementationOnce(async () => {
                    mockAuth.currentUser = makeUser('uid-other');
                    return jsonResponse(200, { enabled: true });
                })
                .mockImplementation(async () => jsonResponse(200, { enabled: true }));

            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(false);
            mockAuth.currentUser = makeUser(UID);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl })).toBe(true);
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        });

        test('never throws', async () => {
            mockAuth.currentUser.getIdToken.mockRejectedValueOnce(new Error('token failure'));
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl: jest.fn() })).toBe(false);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl: jest.fn(async () => { throw new TypeError('x'); }) })).toBe(false);
            expect(await getMediaStatus({ ownerUid: UID, fetchImpl: jest.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })) })).toBe(false);
        });
    });

    describe('prepareImageForUpload preflight (before any decode)', () => {
        let createObjectURL;

        beforeEach(() => {
            createObjectURL = jest.fn(() => 'blob:never');
            URL.createObjectURL = createObjectURL;
            URL.revokeObjectURL = jest.fn();
        });

        test.each([
            ['wrong file.type', duckFile(pngHeaderBytes(10, 10), 'image/webp'), 'UNSUPPORTED_MEDIA_TYPE'],
            ['unknown signature', duckFile(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'), 'UNSUPPORTED_MEDIA_TYPE'],
            ['type/signature mismatch', duckFile(gifHeaderBytes(10, 10), 'image/png'), 'UNSUPPORTED_MEDIA_TYPE'],
            ['header pixels over the limit', duckFile(pngHeaderBytes(10000, 6000), 'image/png'), 'MEDIA_DIMENSIONS'],
            ['a header side over 16384', duckFile(jpegHeaderBytes(20000, 10), 'image/jpeg'), 'MEDIA_DIMENSIONS'],
            ['oversize bytes', duckFile(pngHeaderBytes(10, 10), 'image/png', { size: 25 * 1024 * 1024 + 1 }), 'MEDIA_TOO_LARGE'],
        ])('%s -> %s without loadImage or an object URL', async (_label, file, code) => {
            const loadImage = jest.fn();
            const { createCanvas } = canvasFactory([]);

            await expect(prepareImageForUpload(file, { loadImage, createCanvas })).rejects.toMatchObject({ code });
            expect(loadImage).not.toHaveBeenCalled();
            expect(createCanvas).not.toHaveBeenCalled();
            expect(createObjectURL).not.toHaveBeenCalled();
        });

        test('only the first MiB is read for the header', async () => {
            const file = duckFile(pngHeaderBytes(10, 10), 'image/png', { size: 5 * 1024 * 1024 });
            const loadImage = jest.fn(async () => ({ naturalWidth: 10, naturalHeight: 10 }));
            const { createCanvas } = canvasFactory([{ size: 100 }]);

            await prepareImageForUpload(file, { loadImage, createCanvas });
            expect(file.slice).toHaveBeenCalledWith(0, 1024 * 1024);
        });
    });

    describe('prepareImageForUpload GIF branch', () => {
        test('returns the same bytes, never decoded', async () => {
            const bytes = gifHeaderBytes(64, 64, { padding: 500 });
            const file = duckFile(bytes, 'image/gif');
            const loadImage = jest.fn();
            const { createCanvas } = canvasFactory([]);

            const result = await prepareImageForUpload(file, { loadImage, createCanvas });

            expect(result).toMatchObject({ mimeType: 'image/gif', width: 64, height: 64, bytes: bytes.length });
            expect(file.slice).toHaveBeenLastCalledWith(0, bytes.length, 'image/gif');
            expect(result.blob.type).toBe('image/gif');
            expect(Array.from(result.blob.bytes)).toEqual(Array.from(bytes));
            expect(loadImage).not.toHaveBeenCalled();
            expect(createCanvas).not.toHaveBeenCalled();
        });

        test('a GIF over 3 MiB -> MEDIA_TOO_LARGE', async () => {
            const file = duckFile(gifHeaderBytes(64, 64), 'image/gif', { size: 3 * 1024 * 1024 + 1 });
            await expect(prepareImageForUpload(file, { loadImage: jest.fn() })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
        });

        test('a GIF side over 4096 -> MEDIA_DIMENSIONS', async () => {
            const file = duckFile(gifHeaderBytes(5000, 10), 'image/gif');
            await expect(prepareImageForUpload(file, { loadImage: jest.fn() })).rejects.toMatchObject({ code: 'MEDIA_DIMENSIONS' });
        });
    });

    describe('prepareImageForUpload still branch (control flow only)', () => {
        const LIMIT = 1024 * 1024;

        function pngFile(width, height) {
            return duckFile(pngHeaderBytes(width, height), 'image/png');
        }

        function jpegFile(width, height) {
            return duckFile(jpegHeaderBytes(width, height), 'image/jpeg');
        }

        function loader(width, height) {
            return jest.fn(async () => ({ naturalWidth: width, naturalHeight: height }));
        }

        test('a small PNG stays image/png with no white fill', async () => {
            const { createCanvas, canvases } = canvasFactory([{ size: 2000 }]);

            const result = await prepareImageForUpload(pngFile(800, 600), { loadImage: loader(800, 600), createCanvas });

            expect(result).toMatchObject({ mimeType: 'image/png', width: 800, height: 600, bytes: 2000 });
            expect(createCanvas).toHaveBeenCalledTimes(1);
            expect(canvases[0].requested.type).toBe('image/png');
            expect(canvases[0].context.fillRect).not.toHaveBeenCalled();
            expect(canvases[0].context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
        });

        test('an oversized PNG falls to JPEG at 1600 with a white fill', async () => {
            const { createCanvas, canvases } = canvasFactory([{ size: LIMIT + 1 }, { size: 500000 }]);

            const result = await prepareImageForUpload(pngFile(2400, 1800), { loadImage: loader(2400, 1800), createCanvas });

            expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 1600, height: 1200, bytes: 500000 });
            expect(createCanvas.mock.calls).toEqual([[1600, 1200], [1600, 1200]]);
            expect(canvases[1].requested).toEqual({ type: 'image/jpeg', quality: 0.82 });
            expect(canvases[1].context.fillStyle).toBe('#ffffff');
            expect(canvases[1].context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
        });

        test('an oversized first JPEG falls to 1280 at 0.7', async () => {
            const { createCanvas, canvases } = canvasFactory([{ size: LIMIT + 1 }, { size: 700000 }]);

            const result = await prepareImageForUpload(jpegFile(3000, 2000), { loadImage: loader(3000, 2000), createCanvas });

            expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 1280, height: 853, bytes: 700000 });
            expect(createCanvas.mock.calls).toEqual([[1600, 1067], [1280, 853]]);
            expect(canvases[1].requested).toEqual({ type: 'image/jpeg', quality: 0.7 });
        });

        test('every step oversized -> MEDIA_TOO_LARGE', async () => {
            const { createCanvas } = canvasFactory([{ size: LIMIT + 1 }, { size: LIMIT + 1 }, { size: LIMIT + 1 }]);

            await expect(prepareImageForUpload(pngFile(2400, 1800), { loadImage: loader(2400, 1800), createCanvas }))
                .rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
            expect(createCanvas).toHaveBeenCalledTimes(3);
        });

        test('null or wrongly typed blobs at every step -> MEDIA_ENCODE_FAILED', async () => {
            const { createCanvas } = canvasFactory([null, { size: 10, type: 'image/webp' }, null]);

            await expect(prepareImageForUpload(pngFile(800, 600), { loadImage: loader(800, 600), createCanvas }))
                .rejects.toMatchObject({ code: 'MEDIA_ENCODE_FAILED' });
        });

        test('a null first step then a valid second step succeeds', async () => {
            const { createCanvas } = canvasFactory([null, { size: 1000 }]);

            const result = await prepareImageForUpload(pngFile(800, 600), { loadImage: loader(800, 600), createCanvas });
            expect(result).toMatchObject({ mimeType: 'image/jpeg', bytes: 1000 });
        });

        test('a JPEG source never attempts PNG and outputs image/jpeg', async () => {
            const { createCanvas, canvases } = canvasFactory([{ size: 1000 }]);

            const result = await prepareImageForUpload(jpegFile(800, 600), { loadImage: loader(800, 600), createCanvas });

            expect(result.mimeType).toBe('image/jpeg');
            expect(canvases.map((canvas) => canvas.requested.type)).toEqual(['image/jpeg']);
        });

        test('the post-decode pixel limit is enforced', async () => {
            const { createCanvas } = canvasFactory([{ size: 10 }]);

            await expect(prepareImageForUpload(pngFile(100, 100), { loadImage: loader(10000, 6000), createCanvas }))
                .rejects.toMatchObject({ code: 'MEDIA_DIMENSIONS' });
            expect(createCanvas).not.toHaveBeenCalled();
        });

        test('a zero-size decode or a failed load -> MEDIA_ENCODE_FAILED', async () => {
            await expect(prepareImageForUpload(pngFile(100, 100), { loadImage: loader(0, 0), createCanvas: jest.fn() }))
                .rejects.toMatchObject({ code: 'MEDIA_ENCODE_FAILED' });
            await expect(prepareImageForUpload(pngFile(100, 100), {
                loadImage: jest.fn(async () => { throw new Error('decode failed'); }),
                createCanvas: jest.fn(),
            })).rejects.toMatchObject({ code: 'MEDIA_ENCODE_FAILED' });
        });

        test('output dimensions equal the accepted canvas', async () => {
            const { createCanvas } = canvasFactory([{ size: LIMIT + 5 }, { size: LIMIT + 5 }, { size: 900000 }]);

            const result = await prepareImageForUpload(pngFile(1000, 4000), { loadImage: loader(1000, 4000), createCanvas });

            const [width, height] = createCanvas.mock.calls[2];
            expect(result).toMatchObject({ width, height, mimeType: 'image/jpeg' });
            expect({ width, height }).toEqual({ width: 320, height: 1280 });
        });
    });
});
