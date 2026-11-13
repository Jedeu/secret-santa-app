import { POST } from '@/app/api/messages/send/route';
import { sendIncomingMessagePush } from '@/lib/push-server';
import {
    verifyRequestToken,
    runFencedTransaction,
    AdmissionError,
} from '@/lib/participant-admission';

jest.mock('@/lib/firebase', () => ({
    auth: {
        verifyIdToken: jest.fn()
    },
    firestore: {
        collection: jest.fn((name) => ({
            doc: (id) => ({ __collection: name, id })
        }))
    }
}));

jest.mock('@/lib/push-server', () => ({
    sendIncomingMessagePush: jest.fn()
}));

jest.mock('@/lib/participant-admission', () => {
    const actual = jest.requireActual('@/lib/participant-admission');
    return {
        ...actual,
        verifyRequestToken: jest.fn(),
        runFencedTransaction: jest.fn(),
    };
});

const SANTA_ID = 'user-santa';
const RECIPIENT_ID = 'user-recipient';
const OTHER_ID = 'user-other';
const CONV_SANTA_TO_RECIPIENT = `santa_${SANTA_ID}_recipient_${RECIPIENT_ID}`;
const CONV_RECIPIENT_TO_SANTA = `santa_${RECIPIENT_ID}_recipient_${SANTA_ID}`;
const CLIENT_MESSAGE_ID = '4fa2bcc4-35df-4cd2-ac69-7632f6fd2472';
const CLIENT_CREATED_AT = '2026-02-12T20:00:00.000Z';

function createRequest({ token = 'token', body = {} } = {}) {
    return {
        headers: {
            get: (name) => {
                if (name === 'Authorization' && token) {
                    return `Bearer ${token}`;
                }
                return null;
            }
        },
        json: async () => body
    };
}

function yearPath(year, name) {
    return year === 2025 ? name : `years/${year}/${name}`;
}

// Every fake transaction's tx, newest last (for asserting the refs it read).
const txLog = [];

/**
 * In-memory store keyed by the joined collection path + fake fenced transaction for the
 * open `year`. `work` receives a tx with getAll/create/update and a ctx with year and
 * state. `extra` seeds other collections (for example root users while the year is
 * 2026); `mediaUploads` optionally seeds the global mediaUploads collection.
 */
function useStore({ users, messages = {}, sender, year = 2025, extra = {}, mediaUploads = null }) {
    const usersPath = yearPath(year, 'users');
    const messagesPath = yearPath(year, 'messages');
    const store = {
        ...extra,
        [usersPath]: { ...users },
        [messagesPath]: { ...messages },
        ...(mediaUploads ? { mediaUploads: { ...mediaUploads } } : {}),
    };
    txLog.length = 0;
    runFencedTransaction.mockImplementation(async (decoded, work) => {
        const creates = [];
        const updates = [];
        const tx = {
            getAll: jest.fn(async (...refs) => refs.map((ref) => {
                const data = store[ref.__collection]?.[ref.id];
                return { id: ref.id, exists: !!data, data: () => data };
            })),
            create: jest.fn((ref, data) => creates.push({ ref, data })),
            update: jest.fn((ref, data) => updates.push({ ref, data })),
        };
        txLog.push(tx);
        const result = await work(tx, {
            uid: 'auth-uid',
            email: 'sender@example.test',
            epoch: 1,
            year,
            state: 'active',
            user: store[usersPath][sender],
        });
        creates.forEach(({ ref, data }) => {
            store[ref.__collection] = store[ref.__collection] || {};
            store[ref.__collection][ref.id] = data;
        });
        updates.forEach(({ ref, data }) => {
            store[ref.__collection] = store[ref.__collection] || {};
            store[ref.__collection][ref.id] = { ...store[ref.__collection][ref.id], ...data };
        });
        return result;
    });
    return store;
}

const oneWayUsers = {
    [SANTA_ID]: { id: SANTA_ID, recipientId: RECIPIENT_ID, gifterId: OTHER_ID },
    [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: OTHER_ID, gifterId: SANTA_ID },
    [OTHER_ID]: { id: OTHER_ID, recipientId: SANTA_ID, gifterId: RECIPIENT_ID },
};

const mutualUsers = {
    [SANTA_ID]: { id: SANTA_ID, recipientId: RECIPIENT_ID, gifterId: RECIPIENT_ID },
    [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: SANTA_ID, gifterId: SANTA_ID },
};

describe('POST /api/messages/send', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyRequestToken.mockResolvedValue({ uid: 'auth-uid', email: 'sender@example.test' });
        sendIncomingMessagePush.mockResolvedValue({
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            cleanedTokenCount: 0
        });
    });

    test('returns 401 when auth header is missing', async () => {
        verifyRequestToken.mockRejectedValue(new AdmissionError('UNAUTHENTICATED', 'Unauthorized: No token provided'));

        const res = await POST(createRequest({ token: null }));
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toMatch(/No token provided/);
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test('returns 400 when content is empty', async () => {
        const res = await POST(createRequest({ body: { toId: RECIPIENT_ID, content: '   ' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Message cannot be empty');
    });

    test('returns 400 for invalid clientMessageId', async () => {
        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hello', clientMessageId: 'not-a-uuid' }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/clientMessageId/);
    });

    test('returns 400 for invalid clientCreatedAt', async () => {
        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello',
                clientMessageId: CLIENT_MESSAGE_ID,
                clientCreatedAt: 'not-a-date'
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toMatch(/clientCreatedAt/);
    });

    test('writes the message in the fenced transaction with the server-resolved sender', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello from server route',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID,
                clientCreatedAt: CLIENT_CREATED_AT,
                senderUserId: SANTA_ID,
                fromId: 'forged-id'
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.replayed).toBeUndefined();
        expect(store.messages[CLIENT_MESSAGE_ID]).toEqual(expect.objectContaining({
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Hello from server route',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT
        }));
        expect(sendIncomingMessagePush).toHaveBeenCalledWith({
            toUserId: RECIPIENT_ID,
            conversationId: CONV_SANTA_TO_RECIPIENT,
            fromUserId: SANTA_ID
        });
    });

    test('resolves the single authorized conversation when none is requested', async () => {
        const store = useStore({ users: oneWayUsers, sender: RECIPIENT_ID });

        const res = await POST(createRequest({
            body: { toId: SANTA_ID, content: 'Thanks Santa', clientMessageId: CLIENT_MESSAGE_ID }
        }));

        expect(res.status).toBe(200);
        expect(store.messages[CLIENT_MESSAGE_ID].conversationId).toBe(CONV_SANTA_TO_RECIPIENT);
    });

    test('wrong pair returns 400 NOT_ASSIGNED and writes nothing', async () => {
        const store = useStore({
            users: { ...oneWayUsers, 'user-stranger': { id: 'user-stranger', recipientId: null, gifterId: null } },
            sender: SANTA_ID
        });

        const res = await POST(createRequest({ body: { toId: 'user-stranger', content: 'Hi' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data).toEqual({ error: 'Invalid conversation for this recipient', code: 'NOT_ASSIGNED' });
        expect(Object.keys(store.messages)).toHaveLength(0);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('false role returns 400 INVALID_CONVERSATION', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_RECIPIENT_TO_SANTA }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.code).toBe('INVALID_CONVERSATION');
        expect(Object.keys(store.messages)).toHaveLength(0);
    });

    test('senderUserId mismatch returns 403 SENDER_MISMATCH', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hi',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                senderUserId: 'user-previous-account'
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.code).toBe('SENDER_MISMATCH');
        expect(Object.keys(store.messages)).toHaveLength(0);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('missing conversation on a mutual pair returns 400 AMBIGUOUS_CONVERSATION', async () => {
        useStore({ users: mutualUsers, sender: SANTA_ID });

        const res = await POST(createRequest({ body: { toId: RECIPIENT_ID, content: 'Hi' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.code).toBe('AMBIGUOUS_CONVERSATION');
    });

    test('recipient missing returns 400', async () => {
        useStore({ users: { [SANTA_ID]: oneWayUsers[SANTA_ID] }, sender: SANTA_ID });

        const res = await POST(createRequest({ body: { toId: RECIPIENT_ID, content: 'Hi' } }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Recipient not found');
    });

    test('replay with omitted conversationId returns replayed without push', async () => {
        const existing = {
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Hello again',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT,
            timestamp: '2026-02-12T20:00:05.000Z'
        };
        useStore({ users: oneWayUsers, sender: SANTA_ID, messages: { [CLIENT_MESSAGE_ID]: existing } });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello again',
                clientMessageId: CLIENT_MESSAGE_ID,
                clientCreatedAt: CLIENT_CREATED_AT
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.replayed).toBe(true);
        expect(data.message).toEqual(existing);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('replay after assignments changed still returns replayed without push', async () => {
        const existing = {
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Sent before the change',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            timestamp: '2026-02-12T20:00:05.000Z'
        };
        useStore({
            users: {
                [SANTA_ID]: { id: SANTA_ID, recipientId: null, gifterId: null },
                [RECIPIENT_ID]: { id: RECIPIENT_ID, recipientId: null, gifterId: null },
            },
            sender: SANTA_ID,
            messages: { [CLIENT_MESSAGE_ID]: existing }
        });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Sent before the change',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.replayed).toBe(true);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('second identical POST replays and pushes only once', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });
        const body = {
            toId: RECIPIENT_ID,
            content: 'Hello from server route',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT
        };

        const first = await POST(createRequest({ body }));
        expect((await first.json()).replayed).toBeUndefined();

        const replay = await POST(createRequest({ body }));
        expect((await replay.json()).replayed).toBe(true);

        expect(sendIncomingMessagePush).toHaveBeenCalledTimes(1);
    });

    test('differing content for an existing id returns 409', async () => {
        useStore({
            users: oneWayUsers,
            sender: SANTA_ID,
            messages: {
                [CLIENT_MESSAGE_ID]: {
                    id: CLIENT_MESSAGE_ID,
                    fromId: SANTA_ID,
                    toId: RECIPIENT_ID,
                    content: 'Different content',
                    conversationId: CONV_SANTA_TO_RECIPIENT,
                    clientMessageId: CLIENT_MESSAGE_ID
                }
            }
        });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello from server route',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID
            }
        }));
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.error).toBe('Message id conflict');
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('YEAR_CLOSED returns 409 without push', async () => {
        runFencedTransaction.mockRejectedValue(new AdmissionError('YEAR_CLOSED'));

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(409);
        expect(data.code).toBe('YEAR_CLOSED');
        expect(runFencedTransaction).toHaveBeenCalledTimes(1);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('SERVICE_UNAVAILABLE returns 503 without push', async () => {
        runFencedTransaction.mockRejectedValue(new AdmissionError('SERVICE_UNAVAILABLE'));

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));

        expect(res.status).toBe(503);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('the route runs the fenced transaction without allowClosed', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });

        await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));

        expect(runFencedTransaction).toHaveBeenCalledTimes(1);
        expect(runFencedTransaction.mock.calls[0]).toHaveLength(2);
        expect(runFencedTransaction).toHaveBeenCalledWith({ uid: 'auth-uid', email: 'sender@example.test' }, expect.any(Function));
    });

    test('in 2026 the recipient is read from years/2026/users and the message created under years/2026/messages', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID, year: 2026, extra: { users: {}, messages: {} } });

        const res = await POST(createRequest({
            body: {
                toId: RECIPIENT_ID,
                content: 'Hello 2026',
                conversationId: CONV_SANTA_TO_RECIPIENT,
                clientMessageId: CLIENT_MESSAGE_ID,
            }
        }));

        expect(res.status).toBe(200);
        expect(store['years/2026/messages'][CLIENT_MESSAGE_ID]).toEqual(expect.objectContaining({
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            conversationId: CONV_SANTA_TO_RECIPIENT,
        }));
        expect(store.messages).toEqual({});
        expect(store.users).toEqual({});
    });

    test('in 2026 a recipient that exists only at the root returns 400 and writes nothing', async () => {
        const store = useStore({
            users: { [SANTA_ID]: oneWayUsers[SANTA_ID] },
            sender: SANTA_ID,
            year: 2026,
            extra: { users: { [RECIPIENT_ID]: oneWayUsers[RECIPIENT_ID] }, messages: {} },
        });

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Recipient not found');
        expect(store['years/2026/messages']).toEqual({});
        expect(store.messages).toEqual({});
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('retries a transient transaction error then succeeds', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });
        const succeed = runFencedTransaction.getMockImplementation();
        runFencedTransaction
            .mockImplementationOnce(async () => {
                throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
            })
            .mockImplementation(succeed);

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));

        expect(res.status).toBe(200);
        expect(runFencedTransaction).toHaveBeenCalledTimes(2);
        expect(sendIncomingMessagePush).toHaveBeenCalledTimes(1);
    });

    test('returns 500 and does not push if the transaction keeps failing', async () => {
        runFencedTransaction.mockRejectedValue({ code: 'resource-exhausted' });

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Failed to send message');
        expect(runFencedTransaction).toHaveBeenCalledTimes(3);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('returns success when push dispatch fails (fail-open)', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });
        sendIncomingMessagePush.mockRejectedValue(new Error('FCM temporarily unavailable'));

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Hi', conversationId: CONV_SANTA_TO_RECIPIENT }
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
    });
});

describe('POST /api/messages/send with an attachment', () => {
    const MEDIA_ID = '0b6d2f4e-8a1c-4e3b-9d7f-5c2a1b0e9f8d';
    const OTHER_MEDIA_ID = '7e1c3a5b-2d4f-4a6c-8b9e-0f1d2c3b4a5e';
    const PUBLIC_ID = `ss-2025-${MEDIA_ID}`;
    const SHA = 'a'.repeat(64);

    // Synthetic server-owned record for CLIENT_MESSAGE_ID.
    function mediaRecord(overrides = {}) {
        return {
            id: CLIENT_MESSAGE_ID,
            mediaId: MEDIA_ID,
            status: 'uploaded',
            attempts: 1,
            authUid: 'auth-uid',
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            conversationId: CONV_SANTA_TO_RECIPIENT,
            year: 2025,
            epoch: 1,
            quotaKey: 'auth-uid|2026-02-12',
            sha256: SHA,
            provider: 'cloudinary',
            cloudName: 'unit-cloud',
            publicId: PUBLIC_ID,
            staleProviderIds: [],
            format: 'png',
            width: 640,
            height: 480,
            bytes: 4321,
            version: 1700000000,
            createdAt: '2026-02-12T19:59:00.000Z',
            updatedAt: '2026-02-12T19:59:01.000Z',
            uploadedAt: '2026-02-12T19:59:01.000Z',
            attachedAt: null,
            ...overrides,
        };
    }

    const EXPECTED_ATTACHMENT = {
        id: MEDIA_ID,
        kind: 'image',
        provider: 'cloudinary',
        cloudName: 'unit-cloud',
        publicId: PUBLIC_ID,
        version: 1700000000,
        format: 'png',
        width: 640,
        height: 480,
        bytes: 4321,
    };

    function body(overrides = {}) {
        return {
            toId: RECIPIENT_ID,
            content: 'Look at this',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT,
            senderUserId: SANTA_ID,
            attachment: { id: MEDIA_ID },
            ...overrides,
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        verifyRequestToken.mockResolvedValue({ uid: 'auth-uid', email: 'sender@example.test' });
        sendIncomingMessagePush.mockResolvedValue({
            totalTokens: 0,
            successCount: 0,
            failureCount: 0,
            cleanedTokenCount: 0
        });
    });

    test('captioned: the server copies the attachment from the record and marks it attached', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID, mediaUploads: { [CLIENT_MESSAGE_ID]: mediaRecord() } });

        const res = await POST(createRequest({
            body: body({ attachment: { id: MEDIA_ID, cloudName: 'evil', publicId: 'forged', url: 'https://evil.example/x.png' } }),
        }));
        const data = await res.json();

        expect(res.status).toBe(200);
        const stored = store.messages[CLIENT_MESSAGE_ID];
        expect(stored).toMatchObject({ content: 'Look at this', fromId: SANTA_ID, toId: RECIPIENT_ID });
        expect(stored.attachment).toEqual(EXPECTED_ATTACHMENT);
        expect(stored.attachment).not.toHaveProperty('sha256');
        expect(stored).not.toHaveProperty('sha256');
        expect(JSON.stringify(stored)).not.toContain(SHA);
        expect(data.message.attachment).toEqual(EXPECTED_ATTACHMENT);
        expect(store.mediaUploads[CLIENT_MESSAGE_ID]).toMatchObject({
            status: 'attached',
            attachedAt: stored.timestamp,
            updatedAt: stored.timestamp,
        });
        expect(txLog[0].getAll.mock.calls[0]).toHaveLength(3);
        expect(txLog[0].getAll.mock.calls[0][2]).toEqual({ __collection: 'mediaUploads', id: CLIENT_MESSAGE_ID });
        expect(sendIncomingMessagePush).toHaveBeenCalledTimes(1);
    });

    test('media-only: empty content is accepted with an attachment', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID, mediaUploads: { [CLIENT_MESSAGE_ID]: mediaRecord() } });

        const res = await POST(createRequest({ body: body({ content: '   ' }) }));

        expect(res.status).toBe(200);
        expect(store.messages[CLIENT_MESSAGE_ID]).toMatchObject({ content: '', attachment: EXPECTED_ATTACHMENT });
    });

    test('a text-only send still reads exactly two refs and writes no attachment key', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({
            body: { toId: RECIPIENT_ID, content: 'Just text', conversationId: CONV_SANTA_TO_RECIPIENT, clientMessageId: CLIENT_MESSAGE_ID },
        }));

        expect(res.status).toBe(200);
        expect(txLog[0].getAll.mock.calls[0]).toHaveLength(2);
        expect(txLog[0].update).not.toHaveBeenCalled();
        expect(store.messages[CLIENT_MESSAGE_ID]).not.toHaveProperty('attachment');
        expect(store.mediaUploads).toBeUndefined();
    });

    test('attachment: null is treated as absent', async () => {
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({ body: body({ attachment: null, content: 'Text' }) }));

        expect(res.status).toBe(200);
        expect(store.messages[CLIENT_MESSAGE_ID]).not.toHaveProperty('attachment');
    });

    test('an attachment without clientMessageId -> 400 ATTACHMENT_INVALID', async () => {
        useStore({ users: oneWayUsers, sender: SANTA_ID, mediaUploads: { [CLIENT_MESSAGE_ID]: mediaRecord() } });

        const res = await POST(createRequest({ body: body({ clientMessageId: undefined }) }));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid attachment', code: 'ATTACHMENT_INVALID' });
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test.each([
        ['a non-UUID id', { id: 'not-a-uuid' }],
        ['no id', {}],
        ['a numeric id', { id: 42 }],
        ['a string', 'attachment'],
        ['an array', [MEDIA_ID]],
    ])('a malformed attachment (%s) -> 400 ATTACHMENT_INVALID', async (_label, attachment) => {
        useStore({ users: oneWayUsers, sender: SANTA_ID });

        const res = await POST(createRequest({ body: body({ attachment }) }));

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('ATTACHMENT_INVALID');
        expect(runFencedTransaction).not.toHaveBeenCalled();
    });

    test.each([
        ['no record', null, 'ATTACHMENT_NOT_FOUND', {}],
        ['another attempt (mediaId)', mediaRecord({ mediaId: OTHER_MEDIA_ID }), 'ATTACHMENT_MISMATCH', {}],
        ['another account', mediaRecord({ authUid: 'auth-other' }), 'ATTACHMENT_MISMATCH', {}],
        ['another sender', mediaRecord({ fromId: OTHER_ID }), 'ATTACHMENT_MISMATCH', {}],
        ['another recipient', mediaRecord({ toId: OTHER_ID }), 'ATTACHMENT_MISMATCH', {}],
        ['another conversation', mediaRecord({ conversationId: CONV_RECIPIENT_TO_SANTA }), 'ATTACHMENT_MISMATCH', {}],
        ['another year', mediaRecord({ year: 2026 }), 'ATTACHMENT_MISMATCH', {}],
        ['another epoch', mediaRecord({ epoch: 2 }), 'ATTACHMENT_MISMATCH', {}],
        ['a reserved record', mediaRecord({ status: 'reserved', version: null }), 'ATTACHMENT_NOT_READY', {}],
        ['a failed record', mediaRecord({ status: 'failed', version: null }), 'ATTACHMENT_NOT_READY', {}],
        ['an attached record', mediaRecord({ status: 'attached' }), 'ATTACHMENT_NOT_READY', {}],
        ['an uploaded record without a renderable shape', mediaRecord({ cloudName: 'bad/name' }), 'ATTACHMENT_NOT_READY', {}],
    ])('%s -> 400 %s with no write and no push', async (_label, record, code, overrides) => {
        const seeded = record ? { [CLIENT_MESSAGE_ID]: record } : {};
        const store = useStore({ users: oneWayUsers, sender: SANTA_ID, mediaUploads: seeded });
        const before = JSON.stringify(store.mediaUploads);

        const res = await POST(createRequest({ body: body(overrides) }));
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data).toEqual({ error: 'Attachment is not available for this message', code });
        expect(store.messages).toEqual({});
        expect(JSON.stringify(store.mediaUploads)).toBe(before);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test('replay with the same attachment -> replayed without push', async () => {
        const existing = {
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Look at this',
            timestamp: '2026-02-12T20:00:05.000Z',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT,
            attachment: EXPECTED_ATTACHMENT,
        };
        useStore({
            users: oneWayUsers,
            sender: SANTA_ID,
            messages: { [CLIENT_MESSAGE_ID]: existing },
            mediaUploads: { [CLIENT_MESSAGE_ID]: mediaRecord({ status: 'attached' }) },
        });

        const res = await POST(createRequest({ body: body() }));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.replayed).toBe(true);
        expect(data.message).toEqual(existing);
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });

    test.each([
        ['a missing attachment in the request', { attachment: undefined }, EXPECTED_ATTACHMENT],
        ['a different attachment id', { attachment: { id: OTHER_MEDIA_ID } }, EXPECTED_ATTACHMENT],
        ['an attachment where the stored message has none', {}, undefined],
    ])('replay with %s -> 409', async (_label, overrides, storedAttachment) => {
        const existing = {
            id: CLIENT_MESSAGE_ID,
            fromId: SANTA_ID,
            toId: RECIPIENT_ID,
            content: 'Look at this',
            timestamp: '2026-02-12T20:00:05.000Z',
            conversationId: CONV_SANTA_TO_RECIPIENT,
            clientMessageId: CLIENT_MESSAGE_ID,
            clientCreatedAt: CLIENT_CREATED_AT,
            ...(storedAttachment ? { attachment: storedAttachment } : {}),
        };
        useStore({
            users: oneWayUsers,
            sender: SANTA_ID,
            messages: { [CLIENT_MESSAGE_ID]: existing },
            mediaUploads: { [CLIENT_MESSAGE_ID]: mediaRecord({ status: 'attached' }) },
        });

        const res = await POST(createRequest({ body: body(overrides) }));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('Message id conflict');
        expect(sendIncomingMessagePush).not.toHaveBeenCalled();
    });
});
