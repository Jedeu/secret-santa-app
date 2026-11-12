/**
 * Year lifecycle (Close year / Start new year) against the Firestore emulator (Admin SDK).
 *
 * Synthetic rosters only (see helpers/emulator-admin.js):
 *   2025 = Alpha, Bravo, Charlie, Delta; 2026 = Alpha, Bravo, Charlie; 2027 = Alpha, Bravo, Echo.
 * H = deep snapshot of the root (2025) users, messages and reactions.
 * Races use the held-transaction pattern: A is held after its work through
 * interceptNextTransaction, B starts, the gate opens, and only invariants that hold
 * under either serialization are asserted. No sleeps.
 * Push dispatch stays off (NODE_ENV=development without PUSH_DISPATCH_ENABLED=true).
 */

jest.mock('@/lib/participants', () => require('./helpers/emulator-admin').syntheticParticipantsModule());

import { auth as adminAuth, firestore } from '@/lib/firebase';
import { ADMIN_EMAILS } from '@/lib/config';
import { getRoster } from '@/lib/participants';
import { assignUsersInTransaction, ensureAllParticipants } from '@/lib/firestore';
import {
    admitParticipant,
    closeYear,
    ensureParticipantProfiles,
    startNewYear,
} from '@/lib/participant-admission';
import { getPushRegistrationStatus, registerPushToken, unregisterPushToken } from '@/lib/push-server';
import { isCompletePairing } from '@/lib/recipient-draw';
import { POST as sendRoute } from '@/app/api/messages/send/route';
import { POST as bootstrapRoute } from '@/app/api/auth/bootstrap/route';
import { POST as closeRoute } from '@/app/api/admin/year/close/route';
import { POST as startRoute } from '@/app/api/admin/year/start/route';
import { POST as resetRoute } from '@/app/api/admin/reset/route';
import { POST as devAssignRoute } from '@/app/api/dev/assign/route';
import { POST as devInjectRoute } from '@/app/api/dev/inject-message/route';
import {
    clearEmulatorFirestore,
    deferred,
    interceptNextTransaction,
    snapshotCollections,
} from './helpers/emulator-admin';

const ROSTER_2025 = getRoster(2025);
const ROSTER_2026 = getRoster(2026);
const ROSTER_2027 = getRoster(2027);
const [ALPHA, BRAVO, CHARLIE, DELTA] = ROSTER_2025;

const H_PATHS = ['users', 'messages', 'reactions'];
const GLOBAL_PATHS = ['system', 'participantIndex', 'authIdentities'];
const YEAR_2026_PATHS = ['users', 'messages', 'reactions', 'lastRead', 'typing'].map((name) => `years/2026/${name}`);

const DEVICE_TOKEN = 'it-device-token-year-0000001';
const RACE_MESSAGE_ID = '9b2f6c1e-4d3a-4b8e-9f1a-2c3d4e5f6a7b';
const ADMIN_DECODED = { uid: 'it-year-admin', email: ADMIN_EMAILS[0], email_verified: true };

function decoded(person) {
    return { uid: `it-year-${person.name.toLowerCase()}`, email: person.email, email_verified: true, picture: null };
}

function request(body, extraHeaders = {}) {
    const headers = { authorization: 'Bearer synthetic-token', 'user-agent': 'jest' };
    Object.entries(extraHeaders).forEach(([name, value]) => {
        headers[name.toLowerCase()] = value;
    });
    return {
        headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
        json: async () => body,
    };
}

const YEAR_AWARE = { 'x-secret-santa-client': '2' };

function asCaller(decodedToken) {
    jest.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue(decodedToken);
}

async function lifecycle() {
    const snap = await firestore.collection('system').doc('lifecycle').get();
    return snap.exists ? snap.data() : null;
}

async function docs(path) {
    const snapshot = await firestore.collection(path).get();
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.data().id ?? doc.id }));
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
 * 2025 history: roster profiles with circular pairings, one message and one reaction.
 */
async function seedHistory() {
    await ensureAllParticipants();
    await assignUsersInTransaction(circular);
    const users = await docs('users');
    const byEmail = new Map(users.map((user) => [user.email, user]));
    const santa = byEmail.get(ALPHA.email);
    const recipientId = santa.recipientId;
    await firestore.collection('messages').doc('it-history-message-1').set({
        id: 'it-history-message-1',
        fromId: santa.id,
        toId: recipientId,
        content: 'Synthetic 2025 message',
        timestamp: '2025-12-01T10:00:00.000Z',
        conversationId: `santa_${santa.id}_recipient_${recipientId}`,
    });
    await firestore.collection('reactions').doc(`it-history-message-1_${recipientId}_👍`).set({
        messageId: 'it-history-message-1',
        userId: recipientId,
        emoji: '👍',
        createdAt: '2025-12-01T10:05:00.000Z',
    });
    return { byEmail };
}

async function history() {
    return snapshotCollections(firestore, H_PATHS);
}

async function closeAndStart2026() {
    await closeYear({ year: 2025 });
    return startNewYear({ fromYear: 2025, targetYear: 2026 });
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

async function expectIndexResolvesFor(roster, year, epoch) {
    const users = await docs(year === 2025 ? 'users' : `years/${year}/users`);
    const ids = new Set(users.map((user) => user.id));
    for (const participant of roster) {
        const index = (await firestore.collection('participantIndex').doc(participant.email).get()).data();
        expect(index).toMatchObject({ email: participant.email, epoch });
        expect(ids.has(index.userId)).toBe(true);
    }
}

const MALFORMED = [
    ['resetting without a year', { epoch: 1, state: 'resetting' }],
    ['a null year', { epoch: 1, state: 'active', year: null }],
    ['a missing epoch', { state: 'active' }],
    ['out-of-order closedYears', { epoch: 2, state: 'active', year: 2027, closedYears: [2026, 2025] }],
    ['duplicate closedYears entries', { epoch: 2, state: 'closed', year: 2026, closedYears: [2025, 2025, 2026] }],
    ['a string closedYears element', { epoch: 2, state: 'active', year: 2026, closedYears: ['2025'] }],
    ['a listed year above year', { epoch: 1, state: 'active', year: 2025, closedYears: [2026] }],
];

const LEGACY_FLAG_VALUES = [['unset', undefined], ['"false"', 'false'], ['"true"', 'true']];

function setEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

describe('year lifecycle (emulator)', () => {
    let savedNodeEnv;
    let savedFlag;

    beforeEach(async () => {
        savedNodeEnv = process.env.NODE_ENV;
        savedFlag = process.env.YEAR_TRANSITIONS_ENABLED;
        await clearEmulatorFirestore();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        process.env.NODE_ENV = savedNodeEnv;
        if (savedFlag === undefined) {
            delete process.env.YEAR_TRANSITIONS_ENABLED;
        } else {
            process.env.YEAR_TRANSITIONS_ENABLED = savedFlag;
        }
    });

    describe('server interpretation of an unavailable lifecycle', () => {
        test.each(MALFORMED)('%s -> 503 everywhere with zero writes', async (_label, malformed) => {
            await seedHistory();
            await firestore.collection('system').doc('lifecycle').set(malformed);
            const before = await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS]);

            await expect(closeYear({ year: 2025 })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 }))
                .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            await expect(admitParticipant(decoded(ALPHA))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
            await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

            asCaller(decoded(ALPHA));
            const send = await sendRoute(request({ toId: 'synthetic-recipient', content: 'unavailable' }));
            expect(send.status).toBe(503);
            expect((await send.json()).code).toBe('SERVICE_UNAVAILABLE');

            expect(await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS])).toEqual(before);
            expect(await snapshotCollections(firestore, YEAR_2026_PATHS)).toEqual([]);
        });
    });

    test('missing lifecycle: Start before Close is refused; Close creates the closed document at epoch 1', async () => {
        await expect(startNewYear({ fromYear: 2025, targetYear: 2026 }))
            .rejects.toMatchObject({ code: 'YEAR_NOT_CLOSED', status: 409 });
        expect(await lifecycle()).toBeNull();

        const result = await closeYear({ year: 2025 });

        expect(result).toEqual({ year: 2025, state: 'closed', epoch: 1, closedYears: [2025], changed: true });
        expect(await lifecycle()).toMatchObject({
            epoch: 1,
            state: 'closed',
            year: 2025,
            closedYears: [2025],
            startedAt: null,
            closedAt: expect.any(String),
        });
    });

    test('Close changes once, then is idempotent; the epoch and H are unchanged', async () => {
        await seedHistory();
        const H = await history();
        const epochBefore = (await lifecycle()).epoch;

        const first = await closeYear({ year: 2025 });
        const second = await closeYear({ year: 2025 });

        expect(first).toMatchObject({ changed: true, state: 'closed', epoch: epochBefore });
        expect(second).toMatchObject({ changed: false, state: 'closed', epoch: epochBefore });
        expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025, closedYears: [2025], epoch: epochBefore });
        expect(await history()).toEqual(H);
    });

    test('after Close: sends, dev writers and seeding are refused; push and bootstrap still work', async () => {
        const { byEmail } = await seedHistory();
        const alpha = byEmail.get(ALPHA.email);
        const alphaDecoded = decoded(ALPHA);
        await admitParticipant(alphaDecoded);
        await closeYear({ year: 2025 });
        const H = await history();
        const identitiesBefore = await snapshotCollections(firestore, ['authIdentities']);

        asCaller(alphaDecoded);
        const send = await sendRoute(request({ toId: alpha.recipientId, content: 'after close' }));
        expect(send.status).toBe(409);
        expect((await send.json()).code).toBe('YEAR_CLOSED');

        // A participant who was never admitted gets no identity either.
        jest.restoreAllMocks();
        asCaller(decoded(BRAVO));
        const sendWithoutIdentity = await sendRoute(request({ toId: alpha.id, content: 'after close' }));
        expect(sendWithoutIdentity.status).toBe(409);
        expect(await snapshotCollections(firestore, ['authIdentities'])).toEqual(identitiesBefore);

        const assign = await devAssignRoute();
        expect(assign.status).toBe(409);
        expect((await assign.json()).code).toBe('YEAR_CLOSED');

        const inject = await devInjectRoute(request({ fromId: alpha.id, toId: alpha.recipientId, content: 'injected' }));
        expect(inject.status).toBe(409);
        expect((await inject.json()).code).toBe('YEAR_CLOSED');

        await expect(ensureAllParticipants()).rejects.toMatchObject({ code: 'YEAR_CLOSED', status: 409 });

        const status = await getPushRegistrationStatus({ decodedToken: alphaDecoded, token: DEVICE_TOKEN });
        const registered = await registerPushToken({
            decodedToken: alphaDecoded,
            token: DEVICE_TOKEN,
            expectedEpoch: status.epoch,
            expectedRevision: status.revision,
            enabled: true,
        });
        expect(registered.enabled).toBe(true);
        const unregistered = await unregisterPushToken({
            decodedToken: alphaDecoded,
            token: DEVICE_TOKEN,
            expectedEpoch: registered.epoch,
            expectedRevision: registered.revision,
        });
        expect(unregistered.changed).toBe(true);

        jest.restoreAllMocks();
        asCaller(alphaDecoded);
        const boot = await bootstrapRoute(request({}, YEAR_AWARE));
        expect(boot.status).toBe(200);
        expect(await boot.json()).toMatchObject({
            success: true,
            year: 2025,
            yearState: 'closed',
            closedYears: [2025],
            user: { id: alpha.id },
        });

        expect(await snapshotCollections(firestore, ['messages'])).toEqual(H.filter((row) => row.path === 'messages'));
        expect(await history()).toEqual(H);
    });

    test('in a closed year a roster member without a profile is denied and no profile is created', async () => {
        const { byEmail } = await seedHistory();
        await closeYear({ year: 2025 });
        const charlie = byEmail.get(CHARLIE.email);
        await firestore.collection('users').doc(charlie.id).delete();
        await firestore.collection('participantIndex').doc(CHARLIE.email).delete();
        const usersBefore = await snapshotCollections(firestore, ['users']);

        await expect(admitParticipant(decoded(CHARLIE))).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });

        expect(await snapshotCollections(firestore, ['users'])).toEqual(usersBefore);
    });

    describe('atomic failure', () => {
        test('a Start that fails after its work leaves nothing behind; a plain retry succeeds', async () => {
            await seedHistory();
            await closeYear({ year: 2025 });
            const before = await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS]);

            interceptNextTransaction(firestore, { failAfterWork: new Error('simulated failure after work') });
            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 })).rejects.toThrow('simulated failure after work');

            expect(await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS])).toEqual(before);
            expect(await snapshotCollections(firestore, YEAR_2026_PATHS)).toEqual([]);

            const retried = await startNewYear({ fromYear: 2025, targetYear: 2026 });
            expect(retried).toMatchObject({ changed: true, participants: ROSTER_2026.length });
            expect(await docs('years/2026/users')).toHaveLength(ROSTER_2026.length);
        });

        test('a Close that fails after its work leaves nothing behind; a plain retry succeeds', async () => {
            await seedHistory();
            const before = await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS]);

            interceptNextTransaction(firestore, { failAfterWork: new Error('simulated failure after work') });
            await expect(closeYear({ year: 2025 })).rejects.toThrow('simulated failure after work');

            expect(await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS])).toEqual(before);
            expect(await snapshotCollections(firestore, YEAR_2026_PATHS)).toEqual([]);

            const retried = await closeYear({ year: 2025 });
            expect(retried).toMatchObject({ changed: true, state: 'closed' });
        });
    });

    test('Start creates exactly the 2026 roster with a complete automatic draw, points the index at it and leaves H untouched', async () => {
        await seedHistory();
        const H = await history();
        const closed = await closeYear({ year: 2025 });

        const started = await startNewYear({ fromYear: 2025, targetYear: 2026 });

        const epoch = closed.epoch + 1;
        expect(started).toEqual({
            year: 2026,
            state: 'active',
            epoch,
            closedYears: [2025],
            changed: true,
            participants: ROSTER_2026.length,
        });
        expect(await lifecycle()).toMatchObject({
            epoch,
            state: 'active',
            year: 2026,
            closedYears: [2025],
            startedAt: expect.any(String),
            closedAt: null,
        });

        const users2026 = await docs('years/2026/users');
        expect(users2026.map((user) => user.email).sort()).toEqual(ROSTER_2026.map((p) => p.email).sort());
        users2026.forEach((user) => {
            expect(user).toMatchObject({
                oauthId: null,
                image: null,
                drawMode: 'auto',
                revealAckRecipientId: null,
                revealAckAt: null,
            });
            expect(typeof user.id).toBe('string');
        });
        expect(isCompletePairing(users2026)).toBe(true);
        await expectIndexResolvesFor(ROSTER_2026, 2026, epoch);
        expect(await history()).toEqual(H);

        // The excluded member is denied while their 2025 rows remain.
        asCaller(decoded(DELTA));
        const boot = await bootstrapRoute(request({}, YEAR_AWARE));
        expect(boot.status).toBe(403);
        expect((await boot.json()).code).toBe('ACCESS_DENIED');
        expect((await docs('users')).some((user) => user.email === DELTA.email)).toBe(true);
        expect(users2026.some((user) => user.email === DELTA.email)).toBe(false);
        expect(await history()).toEqual(H);
    });

    test.each(['users', 'messages', 'reactions', 'lastRead', 'typing'])(
        'Start into a non-empty years/2026/%s is refused with YEAR_NOT_EMPTY and writes nothing',
        async (name) => {
            await seedHistory();
            await closeYear({ year: 2025 });
            await firestore.collection(`years/2026/${name}`).doc('it-preexisting').set({ marker: true });
            const paths = [...GLOBAL_PATHS, ...H_PATHS, ...YEAR_2026_PATHS];
            const before = await snapshotCollections(firestore, paths);

            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 }))
                .rejects.toMatchObject({ code: 'YEAR_NOT_EMPTY', status: 409 });

            expect(await snapshotCollections(firestore, paths)).toEqual(before);
        }
    );

    describe('transition tables', () => {
        const CLOSE_ROWS = [
            ['Y > L.year', { epoch: 1, state: 'active', year: 2025, closedYears: [] }, 2026, { error: 'YEAR_MISMATCH' }],
            ['Y < L.year and listed', { epoch: 2, state: 'active', year: 2026, closedYears: [2025] }, 2025, { changed: false }],
            ['Y < L.year and never closed (gap year)', { epoch: 3, state: 'active', year: 2028, closedYears: [2025, 2026] }, 2027, { error: 'YEAR_MISMATCH' }],
            ['Y = L.year, closed', { epoch: 1, state: 'closed', year: 2025, closedYears: [2025] }, 2025, { changed: false }],
            ['Y = L.year, active', { epoch: 2, state: 'active', year: 2026, closedYears: [2025] }, 2026, { changed: true }],
        ];

        test.each(CLOSE_ROWS)('Close: %s', async (_label, seed, year, expected) => {
            await firestore.collection('system').doc('lifecycle').set(seed);
            const before = await lifecycle();

            if (expected.error) {
                await expect(closeYear({ year })).rejects.toMatchObject({ code: expected.error, status: 409 });
                expect(await lifecycle()).toEqual(before);
                return;
            }

            const result = await closeYear({ year });
            expect(result.changed).toBe(expected.changed);
            if (expected.changed) {
                expect(await lifecycle()).toMatchObject({
                    epoch: seed.epoch,
                    state: 'closed',
                    year,
                    closedYears: [...seed.closedYears, year].sort((a, b) => a - b),
                });
            } else {
                expect(await lifecycle()).toEqual(before);
            }
        });

        test.each([
            ['F not a valid year', 2024, 2026],
            ['F not an integer', '2025', 2026],
            ['T equal to F', 2026, 2026],
            ['T before F', 2026, 2025],
        ])('Start: %s -> INVALID_YEAR', async (_label, fromYear, targetYear) => {
            await expect(startNewYear({ fromYear, targetYear })).rejects.toMatchObject({ code: 'INVALID_YEAR', status: 400 });
            expect(await lifecycle()).toBeNull();
        });

        test('Start: no roster for the target year -> ROSTER_NOT_CONFIGURED', async () => {
            await firestore.collection('system').doc('lifecycle')
                .set({ epoch: 3, state: 'closed', year: 2027, closedYears: [2025, 2026, 2027] });
            const before = await lifecycle();

            await expect(startNewYear({ fromYear: 2027, targetYear: 2028 }))
                .rejects.toMatchObject({ code: 'ROSTER_NOT_CONFIGURED', status: 409 });
            expect(await lifecycle()).toEqual(before);
        });

        const START_ROWS = [
            ['L.year = T', { epoch: 2, state: 'active', year: 2026, closedYears: [2025] }, 2025, 2026, { changed: false }],
            ['L.year > T', { epoch: 3, state: 'active', year: 2027, closedYears: [2025, 2026] }, 2025, 2026, { error: 'STALE_REQUEST' }],
            ['gap year (L.year != F)', { epoch: 1, state: 'closed', year: 2025, closedYears: [2025] }, 2026, 2027, { error: 'YEAR_MISMATCH' }],
            ['never-closed year (L.year != F)', { epoch: 2, state: 'active', year: 2026, closedYears: [2025] }, 2025, 2027, { error: 'YEAR_MISMATCH' }],
            ['L.year = F, active', { epoch: 1, state: 'active', year: 2025, closedYears: [] }, 2025, 2026, { error: 'YEAR_NOT_CLOSED' }],
        ];

        test.each(START_ROWS)('Start: %s', async (_label, seed, fromYear, targetYear, expected) => {
            await firestore.collection('system').doc('lifecycle').set(seed);
            const paths = [...GLOBAL_PATHS, ...YEAR_2026_PATHS];
            const before = await snapshotCollections(firestore, paths);

            if (expected.error) {
                await expect(startNewYear({ fromYear, targetYear }))
                    .rejects.toMatchObject({ code: expected.error, status: 409 });
            } else {
                const result = await startNewYear({ fromYear, targetYear });
                expect(result).toMatchObject({ changed: false, participants: null, year: seed.year });
            }

            expect(await snapshotCollections(firestore, paths)).toEqual(before);
        });
    });

    describe('held races', () => {
        test('Start vs Start: exactly one changes, one profile per roster entry, every index row resolves', async () => {
            await seedHistory();
            const closed = await closeYear({ year: 2025 });
            const { reached, gate } = holdNextTransaction();

            const a = startNewYear({ fromYear: 2025, targetYear: 2026 });
            await reached.promise;
            const b = startNewYear({ fromYear: 2025, targetYear: 2026 });
            gate.resolve();
            const results = await Promise.allSettled([a, b]);

            expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
            expect(results.filter((result) => result.value.changed === true)).toHaveLength(1);
            expect(await docs('years/2026/users')).toHaveLength(ROSTER_2026.length);
            await expectIndexResolvesFor(ROSTER_2026, 2026, closed.epoch + 1);
        });

        test('Close vs Close: exactly one changes', async () => {
            await seedHistory();
            const epochBefore = (await lifecycle()).epoch;
            const { reached, gate } = holdNextTransaction();

            const a = closeYear({ year: 2025 });
            await reached.promise;
            const b = closeYear({ year: 2025 });
            gate.resolve();
            const results = await Promise.allSettled([a, b]);

            expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
            expect(results.filter((result) => result.value.changed === true)).toHaveLength(1);
            expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025, closedYears: [2025], epoch: epochBefore });
        });

        test('Close vs send: the send returns 200 exactly when the message exists; the year ends closed', async () => {
            const { byEmail } = await seedHistory();
            const alpha = byEmail.get(ALPHA.email);
            const alphaDecoded = decoded(ALPHA);
            await admitParticipant(alphaDecoded);
            asCaller(alphaDecoded);
            const { reached, gate } = holdNextTransaction();

            const a = sendRoute(request({
                toId: alpha.recipientId,
                content: 'racing the close',
                clientMessageId: RACE_MESSAGE_ID,
            }));
            await reached.promise;
            const b = closeYear({ year: 2025 });
            gate.resolve();
            const [sendResult, closeResult] = await Promise.allSettled([a, b]);

            expect(sendResult.status).toBe('fulfilled');
            expect(closeResult.status).toBe('fulfilled');
            const exists = (await firestore.collection('messages').doc(RACE_MESSAGE_ID).get()).exists;
            expect(sendResult.value.status === 200).toBe(exists);
            if (!exists) {
                expect(sendResult.value.status).toBe(409);
            }
            expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025 });
        });

        test('Admission vs Start: one 2026 profile per roster email; the held identity is stale or points at 2026', async () => {
            await seedHistory();
            await closeYear({ year: 2025 });
            const alphaDecoded = decoded(ALPHA);
            const { reached, gate } = holdNextTransaction();

            const a = admitParticipant(alphaDecoded);
            await reached.promise;
            const b = startNewYear({ fromYear: 2025, targetYear: 2026 });
            gate.resolve();
            const [admitted, started] = await Promise.allSettled([a, b]);

            expect(admitted.status).toBe('fulfilled');
            expect(started.status).toBe('fulfilled');

            const users2026 = await docs('years/2026/users');
            const emails = users2026.map((user) => user.email);
            expect(emails.sort()).toEqual(ROSTER_2026.map((p) => p.email).sort());
            expect(emails).not.toContain(DELTA.email);

            const current = await lifecycle();
            const identity = (await firestore.collection('authIdentities').doc(alphaDecoded.uid).get()).data();
            if (identity.epoch === current.epoch) {
                expect(users2026.some((user) => user.id === identity.userId)).toBe(true);
            } else {
                expect(identity.epoch).toBeLessThan(current.epoch);
            }
        });

        test('seeding one missing profile vs Close: the profile exists exactly when seeding did not throw YEAR_CLOSED', async () => {
            const { byEmail } = await seedHistory();
            // The last roster entry, so earlier entries cannot fail after it is written.
            const last = ROSTER_2025[ROSTER_2025.length - 1];
            const removed = byEmail.get(last.email);
            await firestore.collection('users').doc(removed.id).delete();
            await firestore.collection('participantIndex').doc(last.email).delete();
            const { reached, gate } = holdNextTransaction();

            const a = ensureParticipantProfiles();
            await reached.promise;
            const b = closeYear({ year: 2025 });
            gate.resolve();
            const [seeded, closed] = await Promise.allSettled([a, b]);

            expect(closed.status).toBe('fulfilled');
            if (seeded.status === 'rejected') {
                expect(seeded.reason).toMatchObject({ code: 'YEAR_CLOSED' });
            }
            const profiles = (await docs('users')).filter((user) => user.email === last.email);
            expect(profiles.length === 1).toBe(seeded.status === 'fulfilled');
            expect(profiles.length).toBeLessThanOrEqual(1);
            expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2025 });
        });
    });

    describe('old clients', () => {
        test('bootstrap without the header works in 2025 and is refused in 2026 without an identity write', async () => {
            await seedHistory();
            asCaller(decoded(ALPHA));
            const legacy = await bootstrapRoute(request({}));
            expect(legacy.status).toBe(200);
            expect(await legacy.json()).toMatchObject({ success: true, year: 2025, yearState: 'active' });

            await closeAndStart2026();
            jest.restoreAllMocks();
            asCaller(decoded(BRAVO));
            const identitiesBefore = await snapshotCollections(firestore, ['authIdentities']);

            const refused = await bootstrapRoute(request({}));

            expect(refused.status).toBe(409);
            expect((await refused.json()).code).toBe('CLIENT_UPDATE_REQUIRED');
            expect(await snapshotCollections(firestore, ['authIdentities'])).toEqual(identitiesBefore);
        });

        test('a delayed send from 2025 is rejected in 2026 and writes nothing', async () => {
            const { byEmail } = await seedHistory();
            const alpha2025 = byEmail.get(ALPHA.email);
            const alphaDecoded = decoded(ALPHA);
            await admitParticipant(alphaDecoded);
            await closeAndStart2026();
            const H = await history();
            asCaller(alphaDecoded);

            const withSender = await sendRoute(request({
                toId: alpha2025.recipientId,
                content: 'sent before the rollover',
                senderUserId: alpha2025.id,
            }));
            expect(withSender.status).toBe(403);
            expect((await withSender.json()).code).toBe('SENDER_MISMATCH');

            const withoutSender = await sendRoute(request({
                toId: alpha2025.recipientId,
                content: 'sent before the rollover',
            }));
            expect(withoutSender.status).toBe(400);

            expect(await docs('years/2026/messages')).toHaveLength(0);
            expect(await history()).toEqual(H);
        });

        test('push status before Start, then register after Start -> STALE_REGISTRATION', async () => {
            await seedHistory();
            const bravoDecoded = decoded(BRAVO);
            const status = await getPushRegistrationStatus({ decodedToken: bravoDecoded, token: DEVICE_TOKEN });

            await closeAndStart2026();

            await expect(registerPushToken({
                decodedToken: bravoDecoded,
                token: DEVICE_TOKEN,
                expectedEpoch: status.epoch,
                expectedRevision: status.revision,
                enabled: true,
            })).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });
            expect(await docs('pushTokens')).toHaveLength(0);
        });
    });

    describe('production admin routes ignore the retired YEAR_TRANSITIONS_ENABLED flag', () => {
        test.each(LEGACY_FLAG_VALUES)(
            'flag %s: Close then Start succeed through the routes and H is unchanged',
            async (_label, value) => {
                await seedHistory();
                const H = await history();
                const epochBefore = (await lifecycle()).epoch;
                asCaller(ADMIN_DECODED);

                setEnv('YEAR_TRANSITIONS_ENABLED', value);
                process.env.NODE_ENV = 'production';
                let close;
                let start;
                try {
                    close = await closeRoute(request({ year: 2025 }));
                    start = await startRoute(request({ fromYear: 2025, targetYear: 2026 }));
                } finally {
                    process.env.NODE_ENV = savedNodeEnv;
                }

                expect(close.status).toBe(200);
                expect(await close.json()).toEqual({
                    success: true,
                    year: 2025,
                    state: 'closed',
                    epoch: epochBefore,
                    closedYears: [2025],
                    changed: true,
                });
                expect(start.status).toBe(200);
                expect(await start.json()).toEqual({
                    success: true,
                    year: 2026,
                    state: 'active',
                    epoch: epochBefore + 1,
                    closedYears: [2025],
                    changed: true,
                    participants: ROSTER_2026.length,
                });
                expect(await lifecycle()).toMatchObject({
                    epoch: epochBefore + 1,
                    state: 'active',
                    year: 2026,
                    closedYears: [2025],
                    startedAt: expect.any(String),
                    closedAt: null,
                });

                const users2026 = await docs('years/2026/users');
                expect(users2026.map((user) => user.email).sort()).toEqual(ROSTER_2026.map((p) => p.email).sort());
                await expectIndexResolvesFor(ROSTER_2026, 2026, epochBefore + 1);
                expect(await history()).toEqual(H);
            }
        );

        test('flag "true" grants nothing: a non-admin and an unverified admin get 403 from both routes and nothing is written', async () => {
            await seedHistory();
            const paths = [...GLOBAL_PATHS, ...H_PATHS, ...YEAR_2026_PATHS];
            const before = await snapshotCollections(firestore, paths);
            const callers = [
                [decoded(ALPHA), 'ADMIN_REQUIRED'],
                [{ ...ADMIN_DECODED, email_verified: false }, 'EMAIL_NOT_VERIFIED'],
            ];

            setEnv('YEAR_TRANSITIONS_ENABLED', 'true');
            process.env.NODE_ENV = 'production';
            const responses = [];
            try {
                for (const [caller, code] of callers) {
                    jest.restoreAllMocks();
                    asCaller(caller);
                    responses.push([await closeRoute(request({ year: 2025 })), code]);
                    responses.push([await startRoute(request({ fromYear: 2025, targetYear: 2026 })), code]);
                }
            } finally {
                process.env.NODE_ENV = savedNodeEnv;
            }

            expect(responses).toHaveLength(4);
            for (const [res, code] of responses) {
                expect(res.status).toBe(403);
                expect((await res.json()).code).toBe(code);
            }
            expect(await snapshotCollections(firestore, paths)).toEqual(before);
        });
    });

    test('the retired reset route returns 410 and changes nothing', async () => {
        await seedHistory();
        const before = await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS]);
        asCaller(ADMIN_DECODED);

        const res = await resetRoute(request({}));

        expect(res.status).toBe(410);
        expect((await res.json()).code).toBe('RESET_RETIRED');
        expect(await snapshotCollections(firestore, [...GLOBAL_PATHS, ...H_PATHS])).toEqual(before);
    });

    test('second rollover: 2025 and 2026 stay frozen, old ids are rejected in 2027, a returning participant gets a new UUID', async () => {
        const { byEmail } = await seedHistory();
        const alpha2025 = byEmail.get(ALPHA.email);
        const alphaDecoded = decoded(ALPHA);
        await closeAndStart2026();

        // Activity in 2026.
        await assignUsersInTransaction(circular);
        const alpha2026 = (await docs('years/2026/users')).find((user) => user.email === ALPHA.email);
        asCaller(alphaDecoded);
        const sent = await sendRoute(request({
            toId: alpha2026.recipientId,
            content: 'Synthetic 2026 message',
            senderUserId: alpha2026.id,
        }));
        expect(sent.status).toBe(200);
        const message = (await sent.json()).message;
        await firestore.collection('years/2026/reactions').doc(`${message.id}_${alpha2026.recipientId}_🎄`).set({
            messageId: message.id,
            userId: alpha2026.recipientId,
            emoji: '🎄',
            createdAt: '2026-12-01T10:05:00.000Z',
        });

        const H = await history();
        const frozen2026Paths = ['years/2026/users', 'years/2026/messages', 'years/2026/reactions'];
        const frozen2026 = await snapshotCollections(firestore, frozen2026Paths);

        const closed2026 = await closeYear({ year: 2026 });
        expect(closed2026).toMatchObject({ changed: true, closedYears: [2025, 2026] });
        const started2027 = await startNewYear({ fromYear: 2026, targetYear: 2027 });
        expect(started2027).toMatchObject({ changed: true, year: 2027, closedYears: [2025, 2026], participants: ROSTER_2027.length });

        expect(await history()).toEqual(H);
        expect(await snapshotCollections(firestore, frozen2026Paths)).toEqual(frozen2026);

        jest.restoreAllMocks();
        asCaller(alphaDecoded);
        const with2025Ids = await sendRoute(request({
            toId: alpha2025.recipientId,
            content: 'old 2025 send',
            senderUserId: alpha2025.id,
        }));
        expect(with2025Ids.status).toBe(403);
        const with2026Ids = await sendRoute(request({
            toId: alpha2026.recipientId,
            content: 'old 2026 send',
            senderUserId: alpha2026.id,
        }));
        expect(with2026Ids.status).toBe(403);
        const with2026Recipient = await sendRoute(request({ toId: alpha2026.recipientId, content: 'old 2026 send' }));
        expect(with2026Recipient.status).toBe(400);
        expect(await docs('years/2027/messages')).toHaveLength(0);

        const returning = await admitParticipant(alphaDecoded);
        expect(returning.year).toBe(2027);
        expect(returning.user.id).not.toBe(alpha2025.id);
        expect(returning.user.id).not.toBe(alpha2026.id);
        const users2027 = await docs('years/2027/users');
        expect(users2027.map((user) => user.email).sort()).toEqual(ROSTER_2027.map((p) => p.email).sort());
        expect(users2027.some((user) => user.id === returning.user.id)).toBe(true);

        expect(await history()).toEqual(H);
        expect(await snapshotCollections(firestore, frozen2026Paths)).toEqual(frozen2026);
    });
});
