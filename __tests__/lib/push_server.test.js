import { createHash } from 'node:crypto';
import {
    cleanupInvalidTokens,
    sendIncomingMessagePush,
    isPushDispatchEnabled,
    registerPushToken,
    unregisterPushToken,
    getPushRegistrationStatus,
} from '@/lib/push-server';
import { firestore, messaging } from '@/lib/firebase';
import { resolveParticipant, runFencedTransaction } from '@/lib/participant-admission';

jest.mock('@/lib/firebase', () => ({
    firestore: {
        collection: jest.fn(),
        getAll: jest.fn(),
        runTransaction: jest.fn(),
    },
    messaging: {
        sendEachForMulticast: jest.fn(),
    },
}));

jest.mock('@/lib/participant-admission', () => ({
    resolveParticipant: jest.fn(),
    runFencedTransaction: jest.fn(),
}));

const ENV_KEYS = ['PUSH_DISPATCH_ENABLED', 'NODE_ENV', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
const INVALID = { success: false, error: { code: 'messaging/registration-token-not-registered' } };

let savedEnv;

function setEnv(values) {
    ENV_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            if (values[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = values[key];
            }
        }
    });
}

/**
 * Fake collections. `lifecycle` is what a plain get() returns; `txLifecycle` and `rows`
 * are what the cleanup transaction's getAll() returns.
 */
function useFakeFirestore({
    lifecycle = { epoch: 7, state: 'active' },
    tokens = [{ token: 'push-token-1', revision: 'rev-1' }],
    txLifecycle = undefined,
    rows = {},
    lastRead = {},
    unreadCounts = {},
    countError = null,
} = {}) {
    const queryChain = {
        where: jest.fn(),
        get: jest.fn().mockResolvedValue({
            empty: tokens.length === 0,
            docs: tokens.map((row) => ({ data: () => row })),
        }),
    };
    queryChain.where.mockReturnValue(queryChain);

    const lifecycleRef = {
        __key: 'lifecycle',
        get: jest.fn().mockResolvedValue({ exists: !!lifecycle, data: () => lifecycle }),
    };

    firestore.collection.mockImplementation((name) => {
        if (name === 'system') {
            return { doc: () => lifecycleRef };
        }
        if (name === 'pushTokens') {
            return {
                where: queryChain.where,
                doc: (id) => ({ __key: id }),
            };
        }
        if (name === 'years/2026/lastRead') {
            return { doc: (id) => ({ __lastRead: id }) };
        }
        if (name === 'years/2026/messages') {
            // count() of the unread query: unreadCounts[conversationId], recorded with its filters.
            const countQuery = (filters) => ({
                where: (field, op, value) => countQuery([...filters, [field, op, value]]),
                count: () => ({
                    get: async () => {
                        countQueries.push(filters);
                        if (countError) throw countError;
                        const conversationId = filters.find(([field]) => field === 'conversationId')?.[2];
                        return { data: () => ({ count: unreadCounts[conversationId] ?? 0 }) };
                    },
                }),
            });
            return { where: (field, op, value) => countQuery([[field, op, value]]) };
        }
        throw new Error(`Unexpected collection: ${name}`);
    });
    const countQueries = [];
    firestore.getAll.mockImplementation(async (...refs) => refs.map((ref) => {
        const row = lastRead[ref.__lastRead];
        return { exists: !!row, data: () => row };
    }));

    const tx = {
        getAll: jest.fn(async (...refs) => refs.map((ref) => {
            if (ref.__key === 'lifecycle') {
                const value = txLifecycle === undefined ? lifecycle : txLifecycle;
                return { exists: !!value, data: () => value };
            }
            const row = rows[ref.__key];
            return { exists: !!row, data: () => row };
        })),
        update: jest.fn(),
        set: jest.fn(),
    };
    firestore.runTransaction.mockImplementation(async (fn) => fn(tx));

    return { tx, queryChain, lifecycleRef, countQueries };
}

const SANTA_ID = 'santa-123';
const RECIPIENT_ID = 'recipient-123';
const CONVERSATION_ID = `santa_${SANTA_ID}_recipient_${RECIPIENT_ID}`;

function fromSanta(fields = {}) {
    return {
        id: 'message-1',
        fromId: SANTA_ID,
        toId: RECIPIENT_ID,
        conversationId: CONVERSATION_ID,
        timestamp: '2026-12-09T09:41:00.000Z',
        content: 'Did you get my hint? 👀',
        ...fields,
    };
}

function fromRecipient(fields = {}) {
    return fromSanta({ fromId: RECIPIENT_ID, toId: SANTA_ID, content: 'Thanks! Love, Blake', ...fields });
}

function sentPayload() {
    return messaging.sendEachForMulticast.mock.calls[0][0];
}

// Rows are keyed by sha256(token); compute the keys the module will use.
function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

describe('push-server', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
        setEnv({
            PUSH_DISPATCH_ENABLED: 'true',
            FIRESTORE_EMULATOR_HOST: undefined,
            FIREBASE_AUTH_EMULATOR_HOST: undefined,
        });
        messaging.sendEachForMulticast.mockResolvedValue({
            successCount: 1,
            failureCount: 0,
            responses: [{ success: true }],
        });
    });

    afterEach(() => {
        setEnv(savedEnv);
    });

    describe('dispatch gate', () => {
        test("'false' disables dispatch even in production: zero Firestore/FCM calls", async () => {
            setEnv({ PUSH_DISPATCH_ENABLED: 'false', NODE_ENV: 'production' });
            useFakeFirestore();

            const result = await sendIncomingMessagePush({ year: 2026, message: { toId: 'u1' } });

            expect(result).toMatchObject({ totalTokens: 0, skipped: 'disabled' });
            expect(firestore.collection).not.toHaveBeenCalled();
            expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
        });

        test('unset with an emulator host in production: disabled', async () => {
            setEnv({ PUSH_DISPATCH_ENABLED: undefined, NODE_ENV: 'production', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
            useFakeFirestore();

            const result = await sendIncomingMessagePush({ year: 2026, message: { toId: 'u1' } });

            expect(result.skipped).toBe('disabled');
            expect(firestore.collection).not.toHaveBeenCalled();
            expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
        });

        test('unset with an auth emulator host in production: disabled', () => {
            setEnv({ PUSH_DISPATCH_ENABLED: undefined, NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
            expect(isPushDispatchEnabled()).toBe(false);
        });

        test('unset in the test environment: disabled', async () => {
            setEnv({ PUSH_DISPATCH_ENABLED: undefined, NODE_ENV: 'test' });
            useFakeFirestore();

            const result = await sendIncomingMessagePush({ year: 2026, message: { toId: 'u1' } });

            expect(result.skipped).toBe('disabled');
            expect(firestore.collection).not.toHaveBeenCalled();
            expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
        });

        test('unset in production without emulator hosts: enabled', () => {
            setEnv({ PUSH_DISPATCH_ENABLED: undefined, NODE_ENV: 'production' });
            expect(isPushDispatchEnabled()).toBe(true);
        });

        test("'true' enables dispatch everywhere", () => {
            setEnv({ PUSH_DISPATCH_ENABLED: 'true', NODE_ENV: 'development', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
            expect(isPushDispatchEnabled()).toBe(true);
        });
    });

    describe('sendIncomingMessagePush (dispatch enabled)', () => {
        test('a message from your Santa: previewed, grouped per chat, opens the Santa tab, no ids', async () => {
            useFakeFirestore({
                tokens: [
                    { token: 'push-token-1', revision: 'rev-1' },
                    { token: 'push-token-1', revision: 'rev-1' },
                ],
                unreadCounts: { [CONVERSATION_ID]: 1 },
            });

            const result = await sendIncomingMessagePush({
                year: 2026,
                message: fromSanta(),
                receiver: { recipientId: 'someone-else', gifterId: SANTA_ID },
            });

            expect(sentPayload()).toEqual({
                tokens: ['push-token-1'],
                notification: { title: '🎅 Your Santa', body: 'Did you get my hint? 👀' },
                data: {
                    type: 'incoming_message',
                    chat: 'santa',
                    kind: 'text',
                    title: '🎅 Your Santa',
                    body: 'Did you get my hint? 👀',
                    unreadTotal: '1',
                },
                webpush: {
                    fcmOptions: { link: '/?chat=santa' },
                    notification: {
                        tag: 'chat-santa',
                        renotify: true,
                        icon: '/icons/icon-192x192.png',
                        badge: '/icons/badge-96x96.png',
                    },
                },
            });
            // Anonymity: no user id or conversation id anywhere in what reaches FCM.
            const serialized = JSON.stringify({ ...sentPayload(), tokens: [] });
            expect(serialized).not.toContain(SANTA_ID);
            expect(serialized).not.toContain(RECIPIENT_ID);

            expect(result).toMatchObject({
                totalTokens: 1,
                successCount: 1,
                failureCount: 0,
                cleanedTokenCount: 0,
            });
        });

        test('a message from your recipient never previews its text', async () => {
            useFakeFirestore({ unreadCounts: { [CONVERSATION_ID]: 1 } });

            await sendIncomingMessagePush({
                year: 2026,
                message: fromRecipient(),
                receiver: { recipientId: RECIPIENT_ID, gifterId: 'someone-else' },
            });

            const payload = sentPayload();
            expect(payload.notification).toEqual({ title: '🎁 Your recipient', body: 'Sent you a message' });
            expect(payload.data).toMatchObject({ chat: 'recipient', kind: 'text', body: 'Sent you a message' });
            expect(payload.webpush.fcmOptions.link).toBe('/?chat=recipient');
            expect(payload.webpush.notification.tag).toBe('chat-recipient');
            expect(JSON.stringify(payload)).not.toContain('Blake');
        });

        test('counts unread since lastRead in this chat and across both chats', async () => {
            const otherConversationId = `santa_${RECIPIENT_ID}_recipient_their-recipient`;
            const { countQueries } = useFakeFirestore({
                lastRead: {
                    [`${RECIPIENT_ID}_${CONVERSATION_ID}`]: {
                        lastReadAt: { toDate: () => new Date('2026-12-09T09:00:00.000Z') },
                    },
                },
                unreadCounts: { [CONVERSATION_ID]: 3, [otherConversationId]: 2 },
            });

            await sendIncomingMessagePush({
                year: 2026,
                message: fromSanta(),
                receiver: { recipientId: 'their-recipient', gifterId: SANTA_ID },
            });

            expect(countQueries).toEqual([
                [
                    ['conversationId', '==', CONVERSATION_ID],
                    ['toId', '==', RECIPIENT_ID],
                    ['timestamp', '>', '2026-12-09T09:00:00.000Z'],
                ],
                [
                    ['conversationId', '==', otherConversationId],
                    ['toId', '==', RECIPIENT_ID],
                ],
            ]);
            expect(sentPayload().notification.title).toBe('🎅 Your Santa · 3 new');
            expect(sentPayload().data.unreadTotal).toBe('5');
        });

        test('a failing count (index not deployed yet) still sends, without a count', async () => {
            jest.spyOn(console, 'warn').mockImplementation(() => {});
            useFakeFirestore({ countError: Object.assign(new Error('needs index'), { code: 9 }) });

            await sendIncomingMessagePush({ year: 2026, message: fromSanta(), receiver: null });

            expect(sentPayload().notification).toEqual({ title: '🎅 Your Santa', body: 'Did you get my hint? 👀' });
            expect(sentPayload().data.unreadTotal).toBe('');
            expect(console.warn).toHaveBeenCalledWith('Push unread count unavailable:', 9);
            console.warn.mockRestore();
        });

        test('falls back to generic copy when the chat is unknown', async () => {
            const { countQueries } = useFakeFirestore();

            await sendIncomingMessagePush({
                year: 2026,
                message: fromSanta({ conversationId: 'invalid-conversation-id' }),
            });

            expect(sentPayload().notification).toEqual({ title: 'Secret Santa', body: 'Sent you a message' });
            expect(sentPayload().data).toMatchObject({ chat: '', unreadTotal: '' });
            expect(sentPayload().webpush.fcmOptions.link).toBe('/');
            expect(sentPayload().webpush.notification.tag).toBe('chat');
            expect(countQueries).toEqual([]);
        });

        test.each([
            ['resetting', { epoch: 7, state: 'resetting' }],
            ['missing', null],
        ])('lifecycle %s -> skipped inactive, no FCM', async (_label, lifecycle) => {
            const { queryChain } = useFakeFirestore({ lifecycle });

            const result = await sendIncomingMessagePush({ year: 2026, message: { toId: 'u1' } });

            expect(result).toMatchObject({ totalTokens: 0, skipped: 'inactive' });
            expect(queryChain.get).not.toHaveBeenCalled();
            expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
        });

        test('cleanup uses the captured epoch and per-row revision (null for legacy rows)', async () => {
            const tokens = [
                { token: 'push-token-new', revision: 'rev-1' },
                { token: 'push-token-legacy' },
            ];
            const rows = {
                [hashToken('push-token-new')]: { token: 'push-token-new', revision: 'rev-1', enabled: true },
                [hashToken('push-token-legacy')]: { token: 'push-token-legacy', enabled: true },
            };
            const { tx } = useFakeFirestore({ tokens, rows });
            messaging.sendEachForMulticast.mockResolvedValue({
                successCount: 0,
                failureCount: 2,
                responses: [INVALID, INVALID],
            });

            const result = await sendIncomingMessagePush({ year: 2026, message: { toId: 'u1' } });

            expect(result.cleanedTokenCount).toBe(2);
            expect(tx.update).toHaveBeenCalledTimes(2);
            expect(tx.set).not.toHaveBeenCalled();
        });

        test('cleanup writes nothing when the epoch changed after dispatch', async () => {
            const rows = { [hashToken('push-token-1')]: { token: 'push-token-1', revision: 'rev-1' } };
            const { tx } = useFakeFirestore({ rows, txLifecycle: { epoch: 8, state: 'active' } });
            messaging.sendEachForMulticast.mockResolvedValue({
                successCount: 0,
                failureCount: 1,
                responses: [INVALID],
            });

            const result = await sendIncomingMessagePush({ year: 2026, message: { toId: 'u1' } });

            expect(result.cleanedTokenCount).toBe(0);
            expect(tx.update).not.toHaveBeenCalled();
        });
    });

    describe('cleanupInvalidTokens', () => {
        const sent = [{ token: 'token-a', revision: 'rev-a' }];
        const invalidResponse = { responses: [INVALID] };

        test.each([
            ['epoch differs', { epoch: 2, state: 'active' }, { 'token-a': { revision: 'rev-a' } }],
            ['resetting', { epoch: 1, state: 'resetting' }, { 'token-a': { revision: 'rev-a' } }],
            ['missing lifecycle', null, { 'token-a': { revision: 'rev-a' } }],
            ['missing row', { epoch: 1, state: 'active' }, {}],
            ['revision differs', { epoch: 1, state: 'active' }, { 'token-a': { revision: 'rev-newer' } }],
        ])('%s -> zero writes, never set', async (_label, txLifecycle, rowsByToken) => {
            const rows = Object.fromEntries(
                Object.entries(rowsByToken).map(([token, row]) => [hashToken(token), row])
            );
            const { tx } = useFakeFirestore({ txLifecycle, rows });

            const count = await cleanupInvalidTokens({ epoch: 1, sent, fcmResponse: invalidResponse });

            expect(count).toBe(0);
            expect(tx.update).not.toHaveBeenCalled();
            expect(tx.set).not.toHaveBeenCalled();
        });

        test('matching row -> one update disabling it as invalid with a new revision', async () => {
            const { tx } = useFakeFirestore({
                txLifecycle: { epoch: 1, state: 'active' },
                rows: { [hashToken('token-a')]: { revision: 'rev-a', enabled: true } },
            });

            const count = await cleanupInvalidTokens({ epoch: 1, sent, fcmResponse: invalidResponse });

            expect(count).toBe(1);
            expect(tx.update).toHaveBeenCalledTimes(1);
            const [, data] = tx.update.mock.calls[0];
            expect(data).toEqual(expect.objectContaining({ enabled: false, invalid: true }));
            expect(typeof data.revision).toBe('string');
            expect(data.revision).not.toBe('rev-a');
            expect(tx.set).not.toHaveBeenCalled();
        });

        test('a non-invalid error code is ignored and no transaction runs', async () => {
            useFakeFirestore();

            const count = await cleanupInvalidTokens({
                epoch: 1,
                sent,
                fcmResponse: { responses: [{ success: false, error: { code: 'messaging/internal-error' } }] },
            });

            expect(count).toBe(0);
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('no invalid responses -> no transaction', async () => {
            useFakeFirestore();

            const count = await cleanupInvalidTokens({ epoch: 1, sent, fcmResponse: { responses: [{ success: true }] } });

            expect(count).toBe(0);
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });
    });

    describe('registration mutations', () => {
        const decodedToken = { uid: 'auth-uid-1', email: 'member@example.test' };
        const ctx = { uid: 'auth-uid-1', email: 'member@example.test', epoch: 3, user: { id: 'user-1' } };

        function useFencedRow(row) {
            const tx = {
                get: jest.fn(async () => ({ exists: !!row, data: () => row })),
                set: jest.fn(),
                update: jest.fn(),
            };
            firestore.collection.mockImplementation(() => ({ doc: (id) => ({ __key: id }) }));
            runFencedTransaction.mockImplementation(async (decoded, work) => work(tx, ctx));
            return tx;
        }

        test('register and unregister run in a fenced transaction that allows a closed year', async () => {
            useFencedRow({ userId: 'user-1', enabled: true, revision: 'rev-1' });

            const registered = await registerPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch: 3,
                expectedRevision: 'rev-1',
                enabled: true,
            });
            expect(runFencedTransaction).toHaveBeenLastCalledWith(decodedToken, expect.any(Function), { allowClosed: true });

            useFencedRow({ userId: 'user-1', enabled: true, revision: registered.revision });
            await unregisterPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch: 3,
                expectedRevision: registered.revision,
            });
            expect(runFencedTransaction).toHaveBeenLastCalledWith(decodedToken, expect.any(Function), { allowClosed: true });
            expect(runFencedTransaction).toHaveBeenCalledTimes(2);
        });

        test('register on an unchanged owner and enabled state still writes a new revision', async () => {
            const tx = useFencedRow({ userId: 'user-1', enabled: true, revision: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' });

            const result = await registerPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch: 3,
                expectedRevision: 'rev-1',
                enabled: true,
            });

            expect(tx.set).toHaveBeenCalledTimes(1);
            const [, data] = tx.set.mock.calls[0];
            expect(data).toEqual(expect.objectContaining({
                userId: 'user-1',
                authUid: 'auth-uid-1',
                enabled: true,
                epoch: 3,
                createdAt: '2026-01-01T00:00:00.000Z',
            }));
            expect(data.revision).not.toBe('rev-1');
            expect(result).toEqual({ epoch: 3, revision: data.revision, enabled: true });
        });

        test('register creates a missing row in the requested (disabled) state', async () => {
            const tx = useFencedRow(null);

            const result = await registerPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch: 3,
                expectedRevision: null,
                enabled: false,
            });

            expect(tx.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
            expect(result.enabled).toBe(false);
        });

        test.each([
            ['revision mismatch', 3, 'rev-0'],
            ['epoch mismatch', 2, 'rev-1'],
            ['null against an existing revision', 3, null],
        ])('register with %s -> STALE_REGISTRATION and no write', async (_label, expectedEpoch, expectedRevision) => {
            const tx = useFencedRow({ userId: 'user-1', enabled: true, revision: 'rev-1' });

            await expect(registerPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch,
                expectedRevision,
            })).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
            expect(tx.set).not.toHaveBeenCalled();
        });

        test("unregister of another user's row -> changed false, no write", async () => {
            const tx = useFencedRow({ userId: 'user-2', enabled: true, revision: 'rev-1' });

            const result = await unregisterPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch: 3,
                expectedRevision: 'rev-1',
            });

            expect(result).toEqual({ epoch: 3, revision: 'rev-1', changed: false });
            expect(tx.update).not.toHaveBeenCalled();
        });

        test('unregister of own row disables it with a new revision', async () => {
            const tx = useFencedRow({ userId: 'user-1', enabled: true, revision: 'rev-1' });

            const result = await unregisterPushToken({
                decodedToken,
                token: 'push-token-1234567890',
                expectedEpoch: 3,
                expectedRevision: 'rev-1',
            });

            expect(result.changed).toBe(true);
            expect(result.revision).not.toBe('rev-1');
            expect(tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                enabled: false,
                revision: result.revision,
            }));
        });

        test('status reports epoch, revision, ownership and enabled', async () => {
            resolveParticipant.mockResolvedValue({ uid: 'auth-uid-1', email: 'member@example.test', user: { id: 'user-1' }, epoch: 5 });
            firestore.collection.mockImplementation(() => ({
                doc: () => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ userId: 'user-1', enabled: true, revision: 'rev-7' })
                    })
                })
            }));

            const status = await getPushRegistrationStatus({ decodedToken, token: 'push-token-1234567890' });

            expect(status).toEqual({ epoch: 5, revision: 'rev-7', mine: true, enabled: true });
        });
    });
});
