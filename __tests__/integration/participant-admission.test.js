/**
 * Participant admission against the Firestore emulator (Admin SDK).
 * Tokens are synthetic decoded-token objects; emails come from the participant list.
 */

import { firestore } from '@/lib/firebase';
import { ensureAllParticipants } from '@/lib/firestore';
import {
    AdmissionError,
    admitParticipant,
    closeYear,
    resolveParticipant,
    startNewYear,
} from '@/lib/participant-admission';
import { PARTICIPANTS, getRoster } from '@/lib/participants';
import { clearEmulatorFirestore, deferred } from './helpers/emulator-admin';

function decodedFor(index, uid = `it-uid-${index}`) {
    return { uid, email: PARTICIPANTS[index].email, email_verified: true, picture: null };
}

async function usersWithEmail(email, path = 'users') {
    const snapshot = await firestore.collection(path).where('email', '==', email).get();
    return snapshot.docs;
}

// Shape written by the first-admission bootstrap (applyProfileWrites), fixed timestamp.
const ACTIVE_LEGACY_LIFECYCLE = {
    epoch: 1, state: 'active', year: 2025, closedYears: [],
    startedAt: null, closedAt: null, updatedAt: '2025-01-01T00:00:00.000Z',
};

/**
 * Await every already-started promise. When one rejects, warn at once with only its
 * input index and numeric error code (else 'non-numeric'), never its message, stack or
 * data, so the failure stays visible even if a sibling later runs into the Jest timeout.
 * All fulfilled -> values in input order. Otherwise, after every promise has settled,
 * rethrow the first rejection in input order, unchanged. Never starts, retries or
 * reorders work.
 * @param {Promise[]} promises
 * @returns {Promise<Array>}
 */
async function settleAllOrThrow(promises) {
    const observed = promises.map((promise, index) => Promise.resolve(promise).catch((reason) => {
        const code = Number.isInteger(reason?.code) ? reason.code : 'non-numeric';
        console.warn(`settleAllOrThrow: operation ${index} rejected (code ${code}); waiting for the rest`);
        throw reason;
    }));
    const outcomes = await Promise.allSettled(observed);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected) {
        throw rejected.reason;
    }
    return outcomes.map((outcome) => outcome.value);
}

// Emulator compatibility only, not a root-cause fix. The Firestore emulator can reject a
// transactional read with this error once it treats the transaction as closed. Firestore
// SDK 8.6.0 (firebase-admin 14.1.0) retries code 3 only for "transaction has expired", so
// the rejection escapes db.runTransaction. Why the emulator closes the transaction is unproven.
const CLOSED_TRANSACTION_CODE = 3;
const CLOSED_TRANSACTION_MESSAGE = '3 INVALID_ARGUMENT: Transaction is invalid or closed.';
const LOOPBACK_EMULATOR_HOST = /^(127\.0\.0\.1|localhost):\d+$/;

function isClosedEmulatorTransaction(error) {
    return error?.code === CLOSED_TRANSACTION_CODE && error?.message === CLOSED_TRANSACTION_MESSAGE;
}

function closedTransactionError() {
    return Object.assign(new Error(CLOSED_TRANSACTION_MESSAGE), { code: CLOSED_TRANSACTION_CODE });
}

/**
 * Emulator only. Replaces db.runTransaction until restore(). A call rejected with exactly
 * the closed-transaction error above is started once more with the same arguments and no
 * delay; that second outcome is final. Every other rejection propagates unchanged after one
 * call. Each re-run warns with its source and a running count only (no message, stack or
 * data): "natural" when wrapping db's own runner, "injected" when a test supplies one.
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ runTransaction?: Function }} [options] runner to wrap instead of db's own
 * @returns {{ stats: { recoveries: number, exhausted: number }, restore: () => void }}
 */
function recoverClosedEmulatorTransactions(db, { runTransaction } = {}) {
    const host = (process.env.FIRESTORE_EMULATOR_HOST || '').trim();
    if (!LOOPBACK_EMULATOR_HOST.test(host)) {
        throw new Error('recoverClosedEmulatorTransactions: FIRESTORE_EMULATOR_HOST must be a loopback emulator host.');
    }
    const source = runTransaction ? 'injected' : 'natural';
    const run = runTransaction ?? db.runTransaction.bind(db);
    const stats = { recoveries: 0, exhausted: 0 };
    const spy = jest.spyOn(db, 'runTransaction').mockImplementation(async (...args) => {
        try {
            return await run(...args);
        } catch (error) {
            if (!isClosedEmulatorTransaction(error)) {
                throw error;
            }
        }
        stats.recoveries += 1;
        console.warn(`closed-transaction recovery [${source}] ${stats.recoveries} (code ${CLOSED_TRANSACTION_CODE})`);
        try {
            return await run(...args);
        } catch (error) {
            if (isClosedEmulatorTransaction(error)) {
                stats.exhausted += 1;
            }
            throw error;
        }
    });
    return { stats, restore: () => spy.mockRestore() };
}

describe('settleAllOrThrow (no emulator)', () => {
    const nextMacrotask = () => new Promise((resolve) => setImmediate(resolve));

    test('resolves values in input order without warning', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const first = deferred();
        const second = deferred();
        try {
            const pending = settleAllOrThrow([first.promise, second.promise]);

            second.resolve('second');
            first.resolve('first');

            await expect(pending).resolves.toEqual(['first', 'second']);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            first.resolve();
            second.resolve();
            warn.mockRestore();
        }
    });

    test('warns per rejection at once, rejects with the first input-order reason only after all settle', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const first = deferred();
        const second = deferred();
        const third = deferred();
        try {
            const firstError = Object.assign(new Error('first private detail'), { code: 3 });
            const secondError = Object.assign(new Error('second private detail'), { code: 'PROFILE_CONFLICT' });

            const settled = settleAllOrThrow([first.promise, second.promise, third.promise]);
            let finished = false;
            settled.then(() => { finished = true; }, () => { finished = true; });

            second.reject(secondError);
            await nextMacrotask();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenLastCalledWith(
                'settleAllOrThrow: operation 1 rejected (code non-numeric); waiting for the rest',
            );

            first.reject(firstError);
            await nextMacrotask();
            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn).toHaveBeenLastCalledWith(
                'settleAllOrThrow: operation 0 rejected (code 3); waiting for the rest',
            );
            expect(finished).toBe(false);

            third.resolve('third');
            await expect(settled).rejects.toBe(firstError);
            expect(finished).toBe(true);
            expect(warn).toHaveBeenCalledTimes(2);

            expect(warn.mock.calls.flat().join(' ')).not.toContain('private detail');
        } finally {
            first.resolve();
            second.resolve();
            third.resolve();
            warn.mockRestore();
        }
    });
});

describe('recoverClosedEmulatorTransactions (no emulator)', () => {
    // A plain function, not a jest mock, so jest.spyOn replaces it instead of reusing it.
    const fakeDb = () => ({
        runTransaction: async () => {
            throw new Error('unwrapped runner called');
        },
    });

    test('passes results and every other rejection through after one call', async () => {
        const db = fakeDb();
        const inner = jest.fn();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const recovery = recoverClosedEmulatorTransactions(db, { runTransaction: inner });
        const work = async () => {};
        try {
            inner.mockResolvedValueOnce('value');
            await expect(db.runTransaction(work, { maxAttempts: 1 })).resolves.toBe('value');
            expect(inner).toHaveBeenLastCalledWith(work, { maxAttempts: 1 });

            const passedThrough = [
                Object.assign(new Error(CLOSED_TRANSACTION_MESSAGE), { code: '3' }),
                Object.assign(new Error(CLOSED_TRANSACTION_MESSAGE), { code: 10 }),
                Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed'), { code: 3 }),
                Object.assign(new Error(`${CLOSED_TRANSACTION_MESSAGE} More detail`), { code: 3 }),
                Object.assign(new Error(`Error: ${CLOSED_TRANSACTION_MESSAGE}`), { code: 3 }),
                Object.assign(new Error('3 INVALID_ARGUMENT: another argument problem'), { code: 3 }),
                new AdmissionError('PROFILE_CONFLICT'),
                new Error('no code'),
            ];
            for (const error of passedThrough) {
                inner.mockClear();
                inner.mockRejectedValueOnce(error);
                await expect(db.runTransaction(work)).rejects.toBe(error);
                expect(inner).toHaveBeenCalledTimes(1);
            }

            expect(recovery.stats).toEqual({ recoveries: 0, exhausted: 0 });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            recovery.restore();
            warn.mockRestore();
        }
    });

    test('re-runs the exact closed-transaction rejection once, and only once', async () => {
        const db = fakeDb();
        const inner = jest.fn();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const recovery = recoverClosedEmulatorTransactions(db, { runTransaction: inner });
        const work = async () => {};
        try {
            inner.mockRejectedValueOnce(closedTransactionError()).mockResolvedValueOnce('second run');
            await expect(db.runTransaction(work, { maxAttempts: 1 })).resolves.toBe('second run');
            expect(inner.mock.calls).toEqual([[work, { maxAttempts: 1 }], [work, { maxAttempts: 1 }]]);
            expect(recovery.stats).toEqual({ recoveries: 1, exhausted: 0 });

            inner.mockClear();
            const last = closedTransactionError();
            inner.mockRejectedValueOnce(closedTransactionError()).mockRejectedValueOnce(last);
            await expect(db.runTransaction(work)).rejects.toBe(last);
            expect(inner).toHaveBeenCalledTimes(2);
            expect(recovery.stats).toEqual({ recoveries: 2, exhausted: 1 });

            inner.mockClear();
            const fatal = new AdmissionError('PROFILE_CONFLICT');
            inner.mockRejectedValueOnce(closedTransactionError()).mockRejectedValueOnce(fatal);
            await expect(db.runTransaction(work)).rejects.toBe(fatal);
            expect(inner).toHaveBeenCalledTimes(2);
            expect(recovery.stats).toEqual({ recoveries: 3, exhausted: 1 });

            expect(warn.mock.calls).toEqual([
                ['closed-transaction recovery [injected] 1 (code 3)'],
                ['closed-transaction recovery [injected] 2 (code 3)'],
                ['closed-transaction recovery [injected] 3 (code 3)'],
            ]);
        } finally {
            recovery.restore();
            warn.mockRestore();
        }
    });

    test('refuses to install unless FIRESTORE_EMULATOR_HOST is a loopback emulator host', () => {
        const db = fakeDb();
        const unwrapped = db.runTransaction;
        const saved = process.env.FIRESTORE_EMULATOR_HOST;
        try {
            process.env.FIRESTORE_EMULATOR_HOST = 'firestore.example.test:443';
            expect(() => recoverClosedEmulatorTransactions(db)).toThrow('loopback emulator host');

            delete process.env.FIRESTORE_EMULATOR_HOST;
            expect(() => recoverClosedEmulatorTransactions(db)).toThrow('loopback emulator host');

            expect(db.runTransaction).toBe(unwrapped);
        } finally {
            if (saved === undefined) {
                delete process.env.FIRESTORE_EMULATOR_HOST;
            } else {
                process.env.FIRESTORE_EMULATOR_HOST = saved;
            }
        }
    });
});

describe('participant admission (emulator)', () => {
    let recovery;

    beforeEach(async () => {
        recovery = undefined;
        await clearEmulatorFirestore();
    });

    afterEach(() => {
        recovery?.restore();
        recovery = undefined;
    });

    test('five concurrent admissions for one token create one profile and one index entry', async () => {
        recovery = recoverClosedEmulatorTransactions(firestore);
        const decoded = decodedFor(0);

        const results = await settleAllOrThrow(Array.from({ length: 5 }, () => admitParticipant(decoded)));

        const ids = new Set(results.map((result) => result.user.id));
        expect(ids.size).toBe(1);
        const [userId] = [...ids];

        const users = await usersWithEmail(decoded.email);
        expect(users).toHaveLength(1);
        expect(users[0].id).toBe(userId);

        const index = await firestore.collection('participantIndex').doc(decoded.email).get();
        expect(index.exists).toBe(true);
        expect(index.data().userId).toBe(userId);

        const identity = await firestore.collection('authIdentities').doc(decoded.uid).get();
        expect(identity.data()).toMatchObject({ uid: decoded.uid, email: decoded.email, userId });
        expect((await firestore.collection('system').doc('lifecycle').get()).data()).toEqual({ ...ACTIVE_LEGACY_LIFECYCLE, updatedAt: expect.any(String) });
    });

    test('concurrent seed and admission produce exactly one profile for the participant', async () => {
        recovery = recoverClosedEmulatorTransactions(firestore);
        // Profile race only; the lifecycle bootstrap race is covered by the first test.
        await firestore.collection('system').doc('lifecycle').set(ACTIVE_LEGACY_LIFECYCLE);
        const decoded = decodedFor(1);

        const [, admitted] = await settleAllOrThrow([ensureAllParticipants(), admitParticipant(decoded)]);

        const users = await usersWithEmail(decoded.email);
        expect(users).toHaveLength(1);
        expect(users[0].id).toBe(admitted.user.id);

        const all = await firestore.collection('users').get();
        expect(all.size).toBe(getRoster(2025).length);
        expect((await firestore.collection('system').doc('lifecycle').get()).data()).toEqual(ACTIVE_LEGACY_LIFECYCLE);
    });

    test('concurrent ensureAllParticipants calls create one profile per participant', async () => {
        recovery = recoverClosedEmulatorTransactions(firestore);
        // Profile race only; the lifecycle bootstrap race is covered by the first test.
        await firestore.collection('system').doc('lifecycle').set(ACTIVE_LEGACY_LIFECYCLE);

        await settleAllOrThrow([ensureAllParticipants(), ensureAllParticipants(), ensureAllParticipants()]);

        const all = await firestore.collection('users').get();
        expect(all.size).toBe(getRoster(2025).length);
        const emails = all.docs.map((doc) => doc.data().email);
        expect(new Set(emails).size).toBe(getRoster(2025).length);
        expect((await firestore.collection('system').doc('lifecycle').get()).data()).toEqual(ACTIVE_LEGACY_LIFECYCLE);
    });

    test('an existing profile is linked with its UUID and left unmodified', async () => {
        const decoded = decodedFor(2);
        const legacyId = 'legacy-profile-uuid';
        const legacy = {
            id: legacyId,
            name: PARTICIPANTS[2].name,
            email: decoded.email,
            oauthId: null,
            image: null,
            recipientId: null,
            gifterId: null,
        };
        await firestore.collection('users').doc(legacyId).set(legacy);

        const { user, created } = await admitParticipant(decoded);

        expect(created).toBe(false);
        expect(user.id).toBe(legacyId);
        expect((await firestore.collection('users').doc(legacyId).get()).data()).toEqual(legacy);
    });

    test('resolveParticipant re-admits after Start with a new profile', async () => {
        const member = getRoster(2026)[1];
        const decoded = { uid: 'it-uid-rollover', email: member.email, email_verified: true, picture: null };
        const before = await resolveParticipant(decoded, { verifyIndex: true });

        await closeYear({ year: 2025 });
        await startNewYear({ fromYear: 2025, targetYear: 2026 });
        const after = await resolveParticipant(decoded, { verifyIndex: true });

        expect(before.year).toBe(2025);
        expect(after.year).toBe(2026);
        expect(after.state).toBe('active');
        expect(after.epoch).toBe(before.epoch + 1);
        expect(after.user.id).not.toBe(before.user.id);
        expect(await usersWithEmail(decoded.email, 'years/2026/users')).toHaveLength(1);
        // The 2025 profile is untouched.
        expect(await usersWithEmail(decoded.email)).toHaveLength(1);
    });

    test('a closed-transaction rejection after the commit landed re-resolves the same profile and index', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const decoded = decodedFor(0, 'it-uid-recovery');
        const read = async (collection, id) => (await firestore.collection(collection).doc(id).get()).data();
        const commit = firestore.runTransaction.bind(firestore);
        let landed = null;
        recovery = recoverClosedEmulatorTransactions(firestore, {
            runTransaction: async (...args) => {
                const result = await commit(...args);
                if (!landed) {
                    // The first run committed for real; report it as closed anyway.
                    landed = {
                        user: await read('users', result.user.id),
                        index: await read('participantIndex', decoded.email),
                        lifecycle: await read('system', 'lifecycle'),
                    };
                    throw closedTransactionError();
                }
                return result;
            },
        });
        try {
            const admitted = await admitParticipant(decoded);

            expect(recovery.stats).toEqual({ recoveries: 1, exhausted: 0 });
            expect(landed.user).toMatchObject({ email: decoded.email });
            expect(landed.index).toMatchObject({ email: decoded.email, userId: landed.user.id });
            // The re-run resolves the landed profile through participantIndex and rewrites neither.
            expect(admitted.created).toBe(false);
            expect(admitted.user).toEqual(landed.user);
            const all = await firestore.collection('users').get();
            expect(all.size).toBe(1);
            expect(all.docs[0].id).toBe(landed.user.id);
            expect(all.docs[0].data()).toEqual(landed.user);
            expect(await read('participantIndex', decoded.email)).toEqual(landed.index);
            const { epoch, state, year } = landed.lifecycle;
            expect({ epoch, state, year }).toEqual({ epoch: 1, state: 'active', year: 2025 });
            expect(await read('system', 'lifecycle')).toMatchObject({ epoch, state, year });
            expect(await read('authIdentities', decoded.uid)).toMatchObject({
                uid: decoded.uid, email: decoded.email, userId: landed.user.id, epoch,
            });
            expect(warn.mock.calls).toEqual([['closed-transaction recovery [injected] 1 (code 3)']]);
        } finally {
            warn.mockRestore();
        }
    });
});
