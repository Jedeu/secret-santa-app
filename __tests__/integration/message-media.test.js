/**
 * Image upload reservation/finalize fences, byte-digest idempotency, attachment binding
 * on send, and Close/Start races during an upload, against the Firestore emulator with
 * the real media and send routes (Admin SDK).
 *
 * Synthetic rosters only (see helpers/emulator-admin.js):
 *   2025 = Alpha, Bravo, Charlie, Delta; 2026 = Alpha, Bravo, Charlie.
 * The provider is a jest.spyOn(global, 'fetch') that answers from the submitted
 * FormData; any other URL is rejected and recorded, so nothing leaves the process.
 * The image bytes are header-only synthetic PNG data (never decoded by anything here).
 * Races use the held-transaction pattern or a gate inside the provider spy. No sleeps.
 */

jest.mock('@/lib/participants', () => require('./helpers/emulator-admin').syntheticParticipantsModule());

import { auth as adminAuth, firestore } from '@/lib/firebase';
import { getRoster } from '@/lib/participants';
import { assignUsersInTransaction, ensureAllParticipants } from '@/lib/firestore';
import { admitParticipant, closeYear, startNewYear } from '@/lib/participant-admission';
import { POST as mediaRoute } from '@/app/api/messages/media/route';
import { POST as sendRoute } from '@/app/api/messages/send/route';
import { isRenderableAttachment, sniffImage } from '@/lib/message-media';
import {
    clearEmulatorFirestore,
    deferred,
    interceptNextTransaction,
    snapshotCollections,
} from './helpers/emulator-admin';
import { pngHeaderBytes } from '../helpers/synthetic-images';

const API_BASE = 'http://127.0.0.1:9';
const CLOUD = 'it-sandbox';
const PROVIDER_URL = `${API_BASE}/v1_1/${CLOUD}/image/upload`;
const ENV = {
    CLOUDINARY_CLOUD_NAME: CLOUD,
    CLOUDINARY_API_KEY: 'it-key',
    CLOUDINARY_API_SECRET: 'it-secret',
    MEDIA_UPLOAD_API_BASE: API_BASE,
};

const [ALPHA, BRAVO] = getRoster(2025);
const YEAR_2026_PATHS = ['users', 'messages', 'lastRead', 'typing', 'reactions'].map((name) => `years/2026/${name}`);
const H_PATHS = ['users', 'messages', 'reactions', 'mediaUploads'];

const ID_1 = '9b2f6c1e-4d3a-4b8e-9f1a-2c3d4e5f6a7b';
const ID_2 = '1c3e5a7b-9d2f-4b6a-8c1e-3f5a7b9d2e4c';
const ID_3 = '5e7a9c1b-3d5f-4a7c-9e1b-5d7f9a1c3e5b';

const PNG = pngHeaderBytes(640, 480, { padding: 256 });

let provider;

function decoded(person) {
    return { uid: `it-media-${person.name.toLowerCase()}`, email: person.email, email_verified: true, picture: null };
}

function asCaller(decodedToken) {
    jest.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue(decodedToken);
}

function jsonResponse(status, body) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function providerOk(call) {
    const parsed = sniffImage(call.bytes);
    return jsonResponse(200, {
        public_id: call.publicId,
        version: 1700000000 + provider.calls.length,
        resource_type: 'image',
        type: 'upload',
        format: parsed.format,
        width: parsed.width,
        height: parsed.height,
        bytes: call.bytes.length,
    });
}

function installProvider() {
    provider = { calls: [], unexpected: [], behavior: null };
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
        if (typeof url !== 'string' || url !== PROVIDER_URL) {
            provider.unexpected.push(String(url));
            throw new Error('Unexpected network request in the media integration test');
        }
        const form = init.body;
        const file = form.get('file');
        const call = {
            publicId: form.get('public_id'),
            fileName: file.name,
            mimeType: file.type,
            authorization: init.headers.Authorization,
            bytes: new Uint8Array(await file.arrayBuffer()),
        };
        provider.calls.push(call);
        return provider.behavior ? provider.behavior(call) : providerOk(call);
    });
}

function mediaRequest({ bytes, contentType, toId, senderUserId, conversationId, clientMessageId }) {
    const headers = {
        authorization: 'Bearer synthetic-token',
        'content-type': contentType,
        'content-length': String(bytes.length),
        'x-media-to-id': toId,
        'x-media-sender-user-id': senderUserId,
        'x-media-conversation-id': conversationId,
        'x-media-client-message-id': clientMessageId,
    };
    let done = false;
    const reader = {
        read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: bytes };
        },
        cancel: async () => { },
    };
    return {
        headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
        body: { getReader: () => reader },
    };
}

function jsonRequest(body) {
    const headers = { authorization: 'Bearer synthetic-token', 'user-agent': 'jest' };
    return {
        headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
        json: async () => body,
    };
}

function recipientConv(user) {
    return `santa_${user.id}_recipient_${user.recipientId}`;
}

function santaConv(user) {
    return `santa_${user.gifterId}_recipient_${user.id}`;
}

async function upload(user, {
    clientMessageId,
    bytes = PNG,
    contentType = 'image/png',
    toId = user.recipientId,
    conversationId = recipientConv(user),
} = {}) {
    const res = await mediaRoute(mediaRequest({
        bytes,
        contentType,
        toId,
        senderUserId: user.id,
        conversationId,
        clientMessageId,
    }));
    return { status: res.status, body: await res.json() };
}

async function send(user, {
    clientMessageId,
    attachmentId = null,
    content = 'A caption',
    toId = user.recipientId,
    conversationId = recipientConv(user),
} = {}) {
    const res = await sendRoute(jsonRequest({
        toId,
        content,
        conversationId,
        clientMessageId,
        senderUserId: user.id,
        ...(attachmentId ? { attachment: { id: attachmentId } } : {}),
    }));
    return { status: res.status, body: await res.json() };
}

async function docs(path) {
    const snapshot = await firestore.collection(path).get();
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.data().id ?? doc.id }));
}

async function mediaRecord(id) {
    const snap = await firestore.collection('mediaUploads').doc(id).get();
    return snap.exists ? snap.data() : null;
}

async function lifecycle() {
    return (await firestore.collection('system').doc('lifecycle').get()).data();
}

async function noMessagesAnywhere() {
    expect(await docs('messages')).toEqual([]);
    expect(await docs('years/2026/messages')).toEqual([]);
}

async function no2026MediaRecords() {
    expect((await docs('mediaUploads')).filter((record) => record.year === 2026)).toEqual([]);
}

function circular(users) {
    if (users.length < 2) return null;
    return users.map((user, i) => ({
        id: user.id,
        recipientId: users[(i + 1) % users.length].id,
        gifterId: users[(i - 1 + users.length) % users.length].id,
    }));
}

/**
 * 2025 profiles in one ring, Alpha and Bravo admitted, Alpha as the caller.
 */
async function seed() {
    await ensureAllParticipants();
    await assignUsersInTransaction(circular);
    const users = await docs('users');
    const byEmail = new Map(users.map((user) => [user.email, user]));
    await admitParticipant(decoded(ALPHA));
    await admitParticipant(decoded(BRAVO));
    asCaller(decoded(ALPHA));
    return { users, alpha: byEmail.get(ALPHA.email), bravo: byEmail.get(BRAVO.email) };
}

function holdNextTransaction() {
    const reached = deferred();
    const gate = deferred();
    interceptNextTransaction(firestore, {
        afterWork: async () => {
            reached.resolve();
            await gate.promise;
        },
    });
    return { reached, gate };
}

function gateProvider({ status = 200 } = {}) {
    const reached = deferred();
    const gate = deferred();
    provider.behavior = async (call) => {
        reached.resolve();
        await gate.promise;
        return status === 200 ? providerOk(call) : jsonResponse(status, { error: { message: 'synthetic' } });
    };
    return { reached, gate };
}

describe('message media (emulator)', () => {
    const saved = {};

    beforeEach(async () => {
        Object.keys(ENV).forEach((key) => {
            saved[key] = process.env[key];
            process.env[key] = ENV[key];
        });
        await clearEmulatorFirestore();
        installProvider();
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        expect(provider.unexpected).toEqual([]);
        jest.restoreAllMocks();
        Object.keys(ENV).forEach((key) => {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        });
    });

    test('1. upload then send: the message carries the server-built attachment; the record is attached', async () => {
        const { alpha } = await seed();

        const up = await upload(alpha, { clientMessageId: ID_1 });

        expect(up.status).toBe(200);
        expect(isRenderableAttachment(up.body.attachment)).toBe(true);
        expect(up.body.attachment).not.toHaveProperty('sha256');
        expect(up.body.attachment.publicId).toBe(`ss-2025-${up.body.attachment.id}`);
        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]).toMatchObject({
            publicId: up.body.attachment.publicId,
            fileName: 'upload',
            mimeType: 'image/png',
            authorization: `Basic ${Buffer.from('it-key:it-secret').toString('base64')}`,
        });
        expect(provider.calls[0].bytes).toEqual(PNG);

        const sent = await send(alpha, { clientMessageId: ID_1, attachmentId: up.body.attachment.id });

        expect(sent.status).toBe(200);
        const message = (await firestore.collection('messages').doc(ID_1).get()).data();
        expect(message.attachment).toEqual(up.body.attachment);
        expect(message.content).toBe('A caption');
        expect(JSON.stringify(message)).not.toContain('sha256');
        expect(await mediaRecord(ID_1)).toMatchObject({ status: 'attached', attachedAt: message.timestamp });
    });

    test('2. send replay -> replayed with one message; an upload after send -> 409; provider called once', async () => {
        const { alpha } = await seed();
        const up = await upload(alpha, { clientMessageId: ID_1 });
        await send(alpha, { clientMessageId: ID_1, attachmentId: up.body.attachment.id });

        const replay = await send(alpha, { clientMessageId: ID_1, attachmentId: up.body.attachment.id });
        expect(replay.status).toBe(200);
        expect(replay.body.replayed).toBe(true);
        expect((await docs('messages')).filter((message) => message.id === ID_1)).toHaveLength(1);

        const late = await upload(alpha, { clientMessageId: ID_1 });
        expect(late.status).toBe(409);
        expect(late.body.code).toBe('MESSAGE_ALREADY_SENT');
        expect(provider.calls).toHaveLength(1);
    });

    test('3. same id and bytes -> same attachment, one provider call; different bytes of equal length -> 409', async () => {
        const { alpha } = await seed();
        const first = await upload(alpha, { clientMessageId: ID_1 });
        const again = await upload(alpha, { clientMessageId: ID_1 });

        expect(again.status).toBe(200);
        expect(again.body.replayed).toBe(true);
        expect(again.body.attachment).toEqual(first.body.attachment);
        expect(provider.calls).toHaveLength(1);

        const changed = new Uint8Array(PNG);
        changed[changed.length - 1] = 0x7f;
        const before = await mediaRecord(ID_1);
        const conflict = await upload(alpha, { clientMessageId: ID_1, bytes: changed });

        expect(conflict.status).toBe(409);
        expect(conflict.body.code).toBe('MEDIA_ID_CONFLICT');
        expect(provider.calls).toHaveLength(1);
        expect(await mediaRecord(ID_1)).toEqual(before);
    });

    test('4. not assigned or the wrong conversation -> 400; no record; provider not called', async () => {
        const { users, alpha } = await seed();
        const stranger = users.find((user) => ![alpha.id, alpha.recipientId, alpha.gifterId].includes(user.id));

        const notAssigned = await upload(alpha, {
            clientMessageId: ID_1,
            toId: stranger.id,
            conversationId: `santa_${alpha.id}_recipient_${stranger.id}`,
        });
        expect(notAssigned.status).toBe(400);
        expect(notAssigned.body.code).toBe('NOT_ASSIGNED');

        const wrongConversation = await upload(alpha, {
            clientMessageId: ID_1,
            conversationId: `santa_${alpha.recipientId}_recipient_${alpha.id}`,
        });
        expect(wrongConversation.status).toBe(400);
        expect(wrongConversation.body.code).toBe('INVALID_CONVERSATION');

        expect(await docs('mediaUploads')).toEqual([]);
        expect(provider.calls).toHaveLength(0);
    });

    test('5. a send whose attachment is bound to another sender or conversation -> 400; no message', async () => {
        const { alpha, bravo } = await seed();
        const forAlpha = await upload(alpha, { clientMessageId: ID_1 });
        const forRecipient = await upload(alpha, { clientMessageId: ID_2 });

        asCaller(decoded(BRAVO));
        const otherSender = await send(bravo, { clientMessageId: ID_1, attachmentId: forAlpha.body.attachment.id });
        expect(otherSender.status).toBe(400);
        expect(otherSender.body.code).toBe('ATTACHMENT_MISMATCH');

        asCaller(decoded(ALPHA));
        const otherConversation = await send(alpha, {
            clientMessageId: ID_2,
            attachmentId: forRecipient.body.attachment.id,
            toId: alpha.gifterId,
            conversationId: santaConv(alpha),
        });
        expect(otherConversation.status).toBe(400);
        expect(otherConversation.body.code).toBe('ATTACHMENT_MISMATCH');

        await noMessagesAnywhere();
        expect((await mediaRecord(ID_1)).status).toBe('uploaded');
        expect((await mediaRecord(ID_2)).status).toBe('uploaded');
    });

    test('6. closed year: upload -> 409 with nothing written; an earlier upload cannot be sent after Close', async () => {
        const { alpha } = await seed();
        const up = await upload(alpha, { clientMessageId: ID_1 });
        await closeYear({ year: 2025 });
        const before = await snapshotCollections(firestore, H_PATHS);

        const refused = await upload(alpha, { clientMessageId: ID_2 });
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('YEAR_CLOSED');

        const sent = await send(alpha, { clientMessageId: ID_1, attachmentId: up.body.attachment.id });
        expect(sent.status).toBe(409);
        expect(sent.body.code).toBe('YEAR_CLOSED');

        expect(await snapshotCollections(firestore, H_PATHS)).toEqual(before);
        expect(provider.calls).toHaveLength(1);
    });

    test('7. after Start 2026 a 2025 record cannot be attached; the 2025 snapshot is unchanged', async () => {
        const { alpha } = await seed();
        const up = await upload(alpha, { clientMessageId: ID_1 });
        await closeYear({ year: 2025 });
        await startNewYear({ fromYear: 2025, targetYear: 2026 });
        const H = await snapshotCollections(firestore, H_PATHS);
        const alpha2026 = (await docs('years/2026/users')).find((user) => user.email === ALPHA.email);

        const sent = await send(alpha2026, { clientMessageId: ID_1, attachmentId: up.body.attachment.id });

        expect(sent.status).toBe(400);
        expect(sent.body.code).toBe('ATTACHMENT_MISMATCH');
        expect(await docs('years/2026/messages')).toEqual([]);
        expect(await snapshotCollections(firestore, H_PATHS)).toEqual(H);
    });

    test('8. provider failure then retry -> takeover with one stale provider id; the daily quota -> 429', async () => {
        const { alpha } = await seed();
        provider.behavior = () => {
            provider.behavior = null;
            return jsonResponse(500, { error: { message: 'synthetic' } });
        };

        const failed = await upload(alpha, { clientMessageId: ID_1 });
        expect(failed.status).toBe(502);
        expect(failed.body.code).toBe('MEDIA_UPLOAD_FAILED');
        expect(await mediaRecord(ID_1)).toMatchObject({ status: 'failed', attempts: 1 });

        const retried = await upload(alpha, { clientMessageId: ID_1 });
        expect(retried.status).toBe(200);
        const record = await mediaRecord(ID_1);
        expect(record).toMatchObject({ status: 'uploaded', attempts: 2 });
        expect(record.staleProviderIds).toHaveLength(1);
        expect(record.staleProviderIds[0]).toBe(provider.calls[0].publicId);
        expect(record.publicId).toBe(provider.calls[1].publicId);
        expect(provider.calls[1].publicId).not.toBe(provider.calls[0].publicId);

        const quotaKey = `${decoded(ALPHA).uid}|${new Date().toISOString().slice(0, 10)}`;
        const batch = firestore.batch();
        for (let i = 0; i < 20; i += 1) {
            batch.set(firestore.collection('mediaUploads').doc(`it-quota-${i}`), { quotaKey, status: 'attached' });
        }
        await batch.commit();

        const limited = await upload(alpha, { clientMessageId: ID_3 });
        expect(limited.status).toBe(429);
        expect(limited.body.code).toBe('MEDIA_QUOTA_EXCEEDED');
        expect(await mediaRecord(ID_3)).toBeNull();
        expect(provider.calls).toHaveLength(2);
    });

    test('9. Close during a succeeding provider call -> 409 YEAR_CLOSED; the record stays reserved', async () => {
        const { alpha } = await seed();
        const { reached, gate } = gateProvider();

        const pending = upload(alpha, { clientMessageId: ID_1 });
        await reached.promise;
        await closeYear({ year: 2025 });
        gate.resolve();
        const result = await pending;

        expect(result.status).toBe(409);
        expect(result.body.code).toBe('YEAR_CLOSED');
        expect(result.body.attachment).toBeUndefined();
        expect(await mediaRecord(ID_1)).toMatchObject({ status: 'reserved', version: null });
        await noMessagesAnywhere();
        expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025 });
    });

    test('10. Close and Start during a succeeding provider call -> 409 UPLOAD_STALE; nothing written for 2026', async () => {
        const { alpha } = await seed();
        const { reached, gate } = gateProvider();

        const pending = upload(alpha, { clientMessageId: ID_1 });
        await reached.promise;
        await closeYear({ year: 2025 });
        await startNewYear({ fromYear: 2025, targetYear: 2026 });
        const held2026 = await snapshotCollections(firestore, YEAR_2026_PATHS);
        gate.resolve();
        const result = await pending;

        expect(result.status).toBe(409);
        expect(result.body.code).toBe('UPLOAD_STALE');
        expect(result.body.attachment).toBeUndefined();
        expect(await mediaRecord(ID_1)).toMatchObject({ status: 'reserved', year: 2025, version: null });
        expect(await snapshotCollections(firestore, YEAR_2026_PATHS)).toEqual(held2026);
        await no2026MediaRecords();
        await noMessagesAnywhere();
    });

    test('11. Close and Start during a failing provider call -> 502; the 2025 record and 2026 data are unchanged', async () => {
        const { alpha } = await seed();
        const { reached, gate } = gateProvider({ status: 500 });

        const pending = upload(alpha, { clientMessageId: ID_1 });
        await reached.promise;
        await closeYear({ year: 2025 });
        await startNewYear({ fromYear: 2025, targetYear: 2026 });
        const heldRecord = await mediaRecord(ID_1);
        const held2026 = await snapshotCollections(firestore, YEAR_2026_PATHS);
        gate.resolve();
        const result = await pending;

        expect(result.status).toBe(502);
        expect(result.body.code).toBe('MEDIA_UPLOAD_FAILED');
        expect(heldRecord).toMatchObject({ status: 'reserved', attempts: 1 });
        expect(await mediaRecord(ID_1)).toEqual(heldRecord);
        expect(await snapshotCollections(firestore, YEAR_2026_PATHS)).toEqual(held2026);
        await no2026MediaRecords();
        await noMessagesAnywhere();
    });

    test('12. Close during a failing provider call -> 502; the record equals its snapshot from while the gate was held', async () => {
        const { alpha } = await seed();
        const { reached, gate } = gateProvider({ status: 500 });

        const pending = upload(alpha, { clientMessageId: ID_1 });
        await reached.promise;
        await closeYear({ year: 2025 });
        const heldRecord = await mediaRecord(ID_1);
        gate.resolve();
        const result = await pending;

        expect(result.status).toBe(502);
        expect(result.body.code).toBe('MEDIA_UPLOAD_FAILED');
        expect(await mediaRecord(ID_1)).toEqual(heldRecord);
        expect(heldRecord.status).toBe('reserved');
    });

    test('13. held reservation vs Close -> 409 YEAR_CLOSED; the provider was called exactly when a record exists', async () => {
        const { alpha } = await seed();
        const closeDone = deferred();
        provider.behavior = async (call) => {
            await closeDone.promise;
            return providerOk(call);
        };
        const { reached, gate } = holdNextTransaction();

        const pending = upload(alpha, { clientMessageId: ID_1 });
        await reached.promise;
        const closing = closeYear({ year: 2025 }).finally(() => closeDone.resolve());
        gate.resolve();
        const [uploaded, closed] = await Promise.allSettled([pending, closing]);

        expect(uploaded.status).toBe('fulfilled');
        expect(closed.status).toBe('fulfilled');
        expect(uploaded.value.status).toBe(409);
        expect(uploaded.value.body.code).toBe('YEAR_CLOSED');
        const record = await mediaRecord(ID_1);
        expect(provider.calls.length === 1).toBe(record !== null);
        expect(provider.calls.length).toBeLessThanOrEqual(1);
        if (record) {
            expect(record.status).toBe('reserved');
        }
        await noMessagesAnywhere();
        expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025 });
    });

    test('14. held finalize vs Close -> 200 exactly when uploaded, else 409 and reserved; a following send writes nothing', async () => {
        const { alpha } = await seed();
        const reached = deferred();
        const gate = deferred();
        provider.behavior = (call) => {
            interceptNextTransaction(firestore, {
                afterWork: async () => {
                    reached.resolve();
                    await gate.promise;
                },
            });
            return providerOk(call);
        };

        const pending = upload(alpha, { clientMessageId: ID_1 });
        await reached.promise;
        const closing = closeYear({ year: 2025 });
        gate.resolve();
        const [uploaded, closed] = await Promise.allSettled([pending, closing]);

        expect(uploaded.status).toBe('fulfilled');
        expect(closed.status).toBe('fulfilled');
        const record = await mediaRecord(ID_1);
        expect(uploaded.value.status === 200).toBe(record.status === 'uploaded');
        if (uploaded.value.status !== 200) {
            expect(uploaded.value.status).toBe(409);
            expect(record.status).toBe('reserved');
        }
        expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025 });

        const followUp = await send(alpha, { clientMessageId: ID_1, attachmentId: record.mediaId });
        expect(followUp.status).toBe(409);
        await noMessagesAnywhere();
    });

    test('15. held send-with-attachment vs Close -> 200 exactly when the message exists and the record is attached', async () => {
        const { alpha } = await seed();
        const up = await upload(alpha, { clientMessageId: ID_1 });
        expect(up.status).toBe(200);
        const { reached, gate } = holdNextTransaction();

        const sending = send(alpha, { clientMessageId: ID_1, attachmentId: up.body.attachment.id });
        await reached.promise;
        const closing = closeYear({ year: 2025 });
        gate.resolve();
        const [sent, closed] = await Promise.allSettled([sending, closing]);

        expect(sent.status).toBe('fulfilled');
        expect(closed.status).toBe('fulfilled');
        const messageExists = (await firestore.collection('messages').doc(ID_1).get()).exists;
        const record = await mediaRecord(ID_1);
        expect(sent.value.status === 200).toBe(messageExists && record.status === 'attached');
        if (!messageExists) {
            expect(sent.value.status).toBe(409);
            expect(record.status).toBe('uploaded');
        }
        expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025 });
    });
});
