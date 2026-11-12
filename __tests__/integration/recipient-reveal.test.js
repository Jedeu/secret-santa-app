/**
 * Automatic recipient draw at Start and the one-time reveal acknowledgment, against the
 * Firestore emulator (Admin SDK).
 *
 * Synthetic rosters only (see helpers/emulator-admin.js):
 *   2025 = Alpha, Bravo, Charlie, Delta; 2026 = Alpha, Bravo, Charlie; 2027 = Alpha, Bravo, Echo.
 * Races use the held-transaction pattern of year-lifecycle.test.js: A is held after its
 * work through interceptNextTransaction, B starts, the gate opens, and only invariants
 * that hold under either serialization are asserted. No sleeps.
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
import { isCompletePairing } from '@/lib/recipient-draw';
import { getRevealState } from '@/lib/recipient-reveal';
import { POST as bootstrapRoute } from '@/app/api/auth/bootstrap/route';
import { POST as startRoute } from '@/app/api/admin/year/start/route';
import { POST as acknowledgeRoute } from '@/app/api/reveal/acknowledge/route';
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

const USERS_2026 = 'years/2026/users';
const USERS_2027 = 'years/2027/users';
const ADMIN_DECODED = { uid: 'it-reveal-admin', email: ADMIN_EMAILS[0], email_verified: true };
const YEAR_AWARE = { 'x-secret-santa-client': '2' };
const START_RESPONSE_KEYS = ['success', 'year', 'state', 'epoch', 'closedYears', 'changed', 'participants'];

function decoded(person) {
    return { uid: `it-reveal-${person.name.toLowerCase()}`, email: person.email, email_verified: true, picture: null };
}

function request(body, { token = 'synthetic-token', headers: extraHeaders = {} } = {}) {
    const headers = { 'user-agent': 'jest' };
    if (token) {
        headers.authorization = `Bearer ${token}`;
    }
    Object.entries(extraHeaders).forEach(([name, value]) => {
        headers[name.toLowerCase()] = value;
    });
    return {
        headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
        json: async () => body,
    };
}

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

async function profileOf(person, path = USERS_2026) {
    return (await docs(path)).find((user) => user.email === person.email);
}

function scopeOf(profile, year, epoch) {
    return { year, epoch, userId: profile.id, recipientId: profile.recipientId };
}

async function acknowledgeAs(person, body) {
    asCaller(decoded(person));
    const response = await acknowledgeRoute(request(body));
    return { status: response.status, body: await response.json() };
}

function circular(users) {
    if (users.length < 2) return null;
    return users.map((user, i) => ({
        id: user.id,
        recipientId: users[(i + 1) % users.length].id,
        gifterId: users[(i - 1 + users.length) % users.length].id,
    }));
}

function reversed(users) {
    return users.map((user) => ({ id: user.id, recipientId: user.gifterId, gifterId: user.recipientId }));
}

/** Following recipientId from the first profile visits every profile exactly once. */
function expectSingleRing(users) {
    const byId = new Map(users.map((user) => [user.id, user]));
    const start = users[0].id;
    const seen = new Set([start]);
    let current = byId.get(start).recipientId;
    while (current !== start) {
        expect(byId.has(current)).toBe(true);
        expect(seen.has(current)).toBe(false);
        seen.add(current);
        current = byId.get(current).recipientId;
    }
    expect(seen.size).toBe(users.length);
}

function expectAutomaticDraw(users, roster) {
    expect(users.map((user) => user.email).sort()).toEqual(roster.map((p) => p.email).sort());
    expect(isCompletePairing(users)).toBe(true);
    expectSingleRing(users);
    users.forEach((user) => {
        expect(user.drawMode).toBe('auto');
        expect(user.revealAckRecipientId).toBeNull();
        expect(user.revealAckAt).toBeNull();
    });
}

async function start2026() {
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

describe('automatic draw and recipient reveal (emulator)', () => {
    beforeEach(async () => {
        await clearEmulatorFirestore();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('draw at Start', () => {
        test('Start draws one complete ring for exactly the 2026 roster; the route response has no pairing data', async () => {
            await closeYear({ year: 2025 });
            asCaller(ADMIN_DECODED);

            const response = await startRoute(request({ fromYear: 2025, targetYear: 2026 }));
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body).toMatchObject({ success: true, year: 2026, state: 'active', changed: true, participants: ROSTER_2026.length });
            expect(Object.keys(body).sort()).toEqual([...START_RESPONSE_KEYS].sort());

            const users = await docs(USERS_2026);
            expectAutomaticDraw(users, ROSTER_2026);
            const text = JSON.stringify(body);
            users.forEach((user) => expect(text).not.toContain(user.id));
        });

        test('no redraw: a second Start returns changed false and the users are deep-equal', async () => {
            await start2026();
            const before = await snapshotCollections(firestore, [USERS_2026]);

            const again = await startNewYear({ fromYear: 2025, targetYear: 2026 });

            expect(again).toMatchObject({ changed: false, participants: null, year: 2026 });
            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before);
        });

        test('Start vs Start (held): exactly one changes; the stored pairing is complete; a later Start changes nothing', async () => {
            await closeYear({ year: 2025 });
            const { reached, gate } = holdNextTransaction();

            const a = startNewYear({ fromYear: 2025, targetYear: 2026 });
            await reached.promise;
            const b = startNewYear({ fromYear: 2025, targetYear: 2026 });
            gate.resolve();
            const results = await Promise.allSettled([a, b]);

            expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
            expect(results.filter((result) => result.value.changed === true)).toHaveLength(1);
            expectAutomaticDraw(await docs(USERS_2026), ROSTER_2026);

            const stored = await snapshotCollections(firestore, [USERS_2026]);
            const later = await startNewYear({ fromYear: 2025, targetYear: 2026 });
            expect(later.changed).toBe(false);
            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(stored);
        });

        test('atomic failure: a Start failed after its work leaves no 2026 users; the plain retry stores a complete pairing', async () => {
            await closeYear({ year: 2025 });

            interceptNextTransaction(firestore, { failAfterWork: new Error('simulated failure after work') });
            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 })).rejects.toThrow('simulated failure after work');
            expect(await docs(USERS_2026)).toEqual([]);

            const retried = await startNewYear({ fromYear: 2025, targetYear: 2026 });
            expect(retried).toMatchObject({ changed: true, participants: ROSTER_2026.length });
            expectAutomaticDraw(await docs(USERS_2026), ROSTER_2026);
        });
    });

    test('bootstrap never acknowledges: three bootstraps leave both ack fields null', async () => {
        await start2026();
        const before = await snapshotCollections(firestore, [USERS_2026]);
        asCaller(decoded(ALPHA));

        for (let i = 0; i < 3; i += 1) {
            const response = await bootstrapRoute(request({}, { headers: YEAR_AWARE }));
            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.user).toMatchObject({ drawMode: 'auto', revealAckRecipientId: null, revealAckAt: null });
        }

        const alpha = await profileOf(ALPHA);
        expect(alpha.revealAckRecipientId).toBeNull();
        expect(alpha.revealAckAt).toBeNull();
        expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before);
    });

    describe('acknowledge', () => {
        test('200 changed true writes only the caller profile; a replay returns the same time and changes nothing', async () => {
            const started = await start2026();
            const alpha = await profileOf(ALPHA);
            const others = (await docs(USERS_2026)).filter((user) => user.id !== alpha.id);

            const first = await acknowledgeAs(ALPHA, scopeOf(alpha, 2026, started.epoch));

            expect(first.status).toBe(200);
            expect(first.body).toEqual({
                success: true,
                changed: true,
                year: 2026,
                epoch: started.epoch,
                userId: alpha.id,
                recipientId: alpha.recipientId,
                acknowledgedAt: expect.any(String),
            });
            const stored = await profileOf(ALPHA);
            expect(stored).toEqual({
                ...alpha,
                revealAckRecipientId: alpha.recipientId,
                revealAckAt: first.body.acknowledgedAt,
            });
            expect(getRevealState(stored)).toBe('acknowledged');
            const othersAfter = (await docs(USERS_2026)).filter((user) => user.id !== alpha.id);
            expect(othersAfter).toEqual(others);

            const afterFirst = await snapshotCollections(firestore, [USERS_2026]);
            const replay = await acknowledgeAs(ALPHA, scopeOf(alpha, 2026, started.epoch));

            expect(replay.status).toBe(200);
            expect(replay.body).toMatchObject({ changed: false, acknowledgedAt: first.body.acknowledgedAt });
            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(afterFirst);
        });

        test('concurrent acknowledgments (held): both 200, exactly one changes, both report the stored time', async () => {
            const started = await start2026();
            await admitParticipant(decoded(ALPHA));
            const alpha = await profileOf(ALPHA);
            const body = scopeOf(alpha, 2026, started.epoch);
            asCaller(decoded(ALPHA));
            const { reached, gate } = holdNextTransaction();

            const a = acknowledgeRoute(request(body));
            await reached.promise;
            const b = acknowledgeRoute(request(body));
            gate.resolve();
            const responses = await Promise.all([a, b]);
            const bodies = await Promise.all(responses.map((response) => response.json()));

            responses.forEach((response) => expect(response.status).toBe(200));
            expect(bodies.filter((data) => data.changed === true)).toHaveLength(1);
            const stored = await profileOf(ALPHA);
            expect(stored.revealAckRecipientId).toBe(alpha.recipientId);
            bodies.forEach((data) => expect(data.acknowledgedAt).toBe(stored.revealAckAt));
        });

        test('fences: a wrong epoch, year, profile or recipient -> 409 REVEAL_STALE with the users unchanged', async () => {
            const started = await start2026();
            const alpha = await profileOf(ALPHA);
            const bravo = await profileOf(BRAVO);
            const before = await snapshotCollections(firestore, [USERS_2026]);

            const cases = [
                { ...scopeOf(alpha, 2026, started.epoch), epoch: started.epoch + 1 },
                { ...scopeOf(alpha, 2026, started.epoch), year: 2027 },
                // Another participant's userId together with that participant's recipientId.
                scopeOf(bravo, 2026, started.epoch),
                { ...scopeOf(alpha, 2026, started.epoch), recipientId: alpha.gifterId },
            ];
            for (const body of cases) {
                const result = await acknowledgeAs(ALPHA, body);
                expect(result.status).toBe(409);
                expect(result.body.code).toBe('REVEAL_STALE');
            }

            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before);
        });

        test('closed year: acknowledge -> 409 YEAR_CLOSED with the users unchanged', async () => {
            const started = await start2026();
            const alpha = await profileOf(ALPHA);
            await closeYear({ year: 2026 });
            const before = await snapshotCollections(firestore, [USERS_2026]);

            const result = await acknowledgeAs(ALPHA, scopeOf(alpha, 2026, started.epoch));

            expect(result.status).toBe(409);
            expect(result.body.code).toBe('YEAR_CLOSED');
            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before);
        });

        test('acknowledge vs Close (held): 200 exactly when the profile carries the acknowledgment; the year ends closed', async () => {
            const started = await start2026();
            await admitParticipant(decoded(ALPHA));
            const alpha = await profileOf(ALPHA);
            asCaller(decoded(ALPHA));
            const { reached, gate } = holdNextTransaction();

            const a = acknowledgeRoute(request(scopeOf(alpha, 2026, started.epoch)));
            await reached.promise;
            const b = closeYear({ year: 2026 });
            gate.resolve();
            const [ackResult, closeResult] = await Promise.allSettled([a, b]);

            expect(ackResult.status).toBe('fulfilled');
            expect(closeResult.status).toBe('fulfilled');
            const stored = await profileOf(ALPHA);
            const acknowledged = stored.revealAckRecipientId === alpha.recipientId;
            expect(ackResult.value.status === 200).toBe(acknowledged);
            if (!acknowledged) {
                expect(ackResult.value.status).toBe(409);
                expect(stored.revealAckAt).toBeNull();
            }
            expect(await lifecycle()).toMatchObject({ state: 'closed', year: 2026 });
        });

        test('after the next Start: a 2026-scoped request during 2027 -> 409 REVEAL_STALE; 2026 unchanged; 2027 ack fields null', async () => {
            const started = await start2026();
            const alpha = await profileOf(ALPHA);
            const body2026 = scopeOf(alpha, 2026, started.epoch);
            await closeYear({ year: 2026 });
            await startNewYear({ fromYear: 2026, targetYear: 2027 });
            const before2026 = await snapshotCollections(firestore, [USERS_2026]);

            const result = await acknowledgeAs(ALPHA, body2026);

            expect(result.status).toBe(409);
            expect(result.body.code).toBe('REVEAL_STALE');
            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before2026);
            const users2027 = await docs(USERS_2027);
            expectAutomaticDraw(users2027, ROSTER_2027);
        });

        test('manual year: in seeded 2025 acknowledge -> 409 REVEAL_NOT_APPLICABLE with the users unchanged', async () => {
            await ensureAllParticipants();
            await assignUsersInTransaction(circular);
            await admitParticipant(decoded(ALPHA));
            const alpha = await profileOf(ALPHA, 'users');
            const before = await snapshotCollections(firestore, ['users']);

            const result = await acknowledgeAs(ALPHA, { year: 2025, epoch: 1, userId: alpha.id, recipientId: alpha.recipientId });

            expect(result.status).toBe(409);
            expect(result.body.code).toBe('REVEAL_NOT_APPLICABLE');
            expect(await snapshotCollections(firestore, ['users'])).toEqual(before);
        });

        test('access: no token -> 401; a 2025-only member during 2026 -> 403', async () => {
            const started = await start2026();
            const alpha = await profileOf(ALPHA);
            const before = await snapshotCollections(firestore, [USERS_2026]);

            const anonymous = await acknowledgeRoute(request(scopeOf(alpha, 2026, started.epoch), { token: null }));
            expect(anonymous.status).toBe(401);

            const outsider = await acknowledgeAs(DELTA, scopeOf(alpha, 2026, started.epoch));
            expect(outsider.status).toBe(403);
            expect(outsider.body.code).toBe('ACCESS_DENIED');

            expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before);
        });
    });

    test('a missing member while other automatic profiles remain: admission and seeding refuse; the users are unchanged', async () => {
        await start2026();
        const charlie = await profileOf(CHARLIE);
        await firestore.collection(USERS_2026).doc(charlie.id).delete();
        await firestore.collection('participantIndex').doc(CHARLIE.email).delete();
        const before = await snapshotCollections(firestore, [USERS_2026]);

        await expect(admitParticipant(decoded(CHARLIE))).rejects.toMatchObject({ code: 'PROFILE_CONFLICT', status: 409 });
        await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'PROFILE_CONFLICT', conflicts: 1 });

        expect(await snapshotCollections(firestore, [USERS_2026])).toEqual(before);
    });

    test('dev reassign after everyone acknowledges: ack fields untouched, every profile pending again, the new recipient acknowledges', async () => {
        const started = await start2026();
        for (const person of ROSTER_2026) {
            const profile = await profileOf(person);
            const result = await acknowledgeAs(person, scopeOf(profile, 2026, started.epoch));
            expect(result.status).toBe(200);
            expect(result.body.changed).toBe(true);
        }
        const acknowledged = await docs(USERS_2026);
        acknowledged.forEach((user) => expect(getRevealState(user)).toBe('acknowledged'));

        await assignUsersInTransaction(reversed);

        const reassigned = await docs(USERS_2026);
        expect(isCompletePairing(reassigned)).toBe(true);
        reassigned.forEach((user) => {
            const previous = acknowledged.find((row) => row.id === user.id);
            expect(user.revealAckRecipientId).toBe(previous.revealAckRecipientId);
            expect(user.revealAckAt).toBe(previous.revealAckAt);
            expect(user.recipientId).toBe(previous.gifterId);
            expect(getRevealState(user)).toBe('pending');
        });

        const alpha = await profileOf(ALPHA);
        const result = await acknowledgeAs(ALPHA, scopeOf(alpha, 2026, started.epoch));
        expect(result.status).toBe(200);
        expect(result.body.changed).toBe(true);
        expect(getRevealState(await profileOf(ALPHA))).toBe('acknowledged');
    });
});
