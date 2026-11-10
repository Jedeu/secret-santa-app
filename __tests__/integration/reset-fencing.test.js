/**
 * Reset fencing against the Firestore emulator (Admin SDK).
 * Barriers are the reset test hooks, resolved by the test.
 * Push dispatch stays off (NODE_ENV=development without PUSH_DISPATCH_ENABLED=true).
 */

import { auth as adminAuth, firestore } from '@/lib/firebase';
import {
    assignUsersInTransaction,
    ensureAllParticipants,
    resetAndReseedParticipants,
    resetDatabase,
} from '@/lib/firestore';
import { admitParticipant } from '@/lib/participant-admission';
import { getPushRegistrationStatus, registerPushToken } from '@/lib/push-server';
import { PARTICIPANTS } from '@/lib/participants';
import { POST as sendMessage } from '@/app/api/messages/send/route';

const DEVICE_TOKEN = 'it-device-token-reset-0000001';

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function decodedFor(index) {
    return { uid: `it-reset-uid-${index}`, email: PARTICIPANTS[index].email, email_verified: true };
}

async function lifecycle() {
    const snap = await firestore.collection('system').doc('lifecycle').get();
    return snap.exists ? snap.data() : null;
}

async function expectOneProfilePerParticipant() {
    const all = await firestore.collection('users').get();
    expect(all.size).toBe(PARTICIPANTS.length);
    expect(new Set(all.docs.map((doc) => doc.data().email)).size).toBe(PARTICIPANTS.length);
}

function circular(users) {
    if (users.length < 2) return null;
    return users.map((user, i) => ({
        id: user.id,
        recipientId: users[(i + 1) % users.length].id,
        gifterId: users[(i - 1 + users.length) % users.length].id,
    }));
}

function request(body) {
    return {
        headers: {
            get: (name) => {
                if (name === 'Authorization') return 'Bearer synthetic-token';
                if (name === 'user-agent') return 'jest';
                return null;
            }
        },
        json: async () => body,
    };
}

describe('reset fencing (emulator)', () => {
    beforeEach(async () => {
        await resetDatabase();
        await ensureAllParticipants(PARTICIPANTS);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('1. A held at afterBegin, B completes, release A -> RESET_SUPERSEDED; B wins', async () => {
        const reachedA = deferred();
        const gateA = deferred();
        const resetA = resetAndReseedParticipants(PARTICIPANTS, {
            afterBegin: async () => {
                reachedA.resolve();
                await gateA.promise;
            },
        });
        await reachedA.promise;

        await resetAndReseedParticipants(PARTICIPANTS);
        const afterB = await lifecycle();
        expect(afterB.state).toBe('active');

        gateA.resolve();
        await expect(resetA).rejects.toMatchObject({ code: 'RESET_SUPERSEDED' });

        const final = await lifecycle();
        expect(final).toMatchObject({ state: 'active', epoch: afterB.epoch, resetId: null });
        await expectOneProfilePerParticipant();
    });

    test('2. A held at afterDelete, B completes, release A -> RESET_SUPERSEDED; B wins', async () => {
        const reachedA = deferred();
        const gateA = deferred();
        const resetA = resetAndReseedParticipants(PARTICIPANTS, {
            afterDelete: async () => {
                reachedA.resolve();
                await gateA.promise;
            },
        });
        await reachedA.promise;

        await resetAndReseedParticipants(PARTICIPANTS);
        const afterB = await lifecycle();

        gateA.resolve();
        await expect(resetA).rejects.toMatchObject({ code: 'RESET_SUPERSEDED' });

        expect(await lifecycle()).toMatchObject({ state: 'active', epoch: afterB.epoch });
        await expectOneProfilePerParticipant();
    });

    test('3. a failure after delete leaves the lifecycle resetting; a second reset completes', async () => {
        await expect(resetAndReseedParticipants(PARTICIPANTS, {
            afterDelete: async () => {
                throw new Error('simulated crash');
            },
        })).rejects.toThrow('simulated crash');

        expect((await lifecycle()).state).toBe('resetting');
        await expect(admitParticipant(decodedFor(0))).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS' });

        await resetAndReseedParticipants(PARTICIPANTS);

        expect((await lifecycle()).state).toBe('active');
        await expectOneProfilePerParticipant();
    });

    test('4. assignment while held at afterReseed -> RESET_IN_PROGRESS; no assignments afterwards', async () => {
        const reached = deferred();
        const gate = deferred();
        const reset = resetAndReseedParticipants(PARTICIPANTS, {
            afterReseed: async () => {
                reached.resolve();
                await gate.promise;
            },
        });
        await reached.promise;

        await expect(assignUsersInTransaction(circular)).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS' });

        gate.resolve();
        await reset;

        const all = await firestore.collection('users').get();
        all.docs.forEach((doc) => {
            expect(doc.data().recipientId).toBeNull();
            expect(doc.data().gifterId).toBeNull();
        });
    });

    test('5. a delayed send from before a reset is rejected and writes nothing', async () => {
        const santaDecoded = decodedFor(0);
        const recipientDecoded = decodedFor(1);
        const { user: santa } = await admitParticipant(santaDecoded);
        const { user: recipient } = await admitParticipant(recipientDecoded);
        await firestore.collection('users').doc(santa.id).update({ recipientId: recipient.id });
        await firestore.collection('users').doc(recipient.id).update({ gifterId: santa.id });

        await resetAndReseedParticipants(PARTICIPANTS);

        jest.spyOn(adminAuth, 'verifyIdToken').mockResolvedValue(santaDecoded);

        // New client: carries the old senderUserId.
        const withSender = await sendMessage(request({
            toId: recipient.id,
            content: 'sent before the reset',
            senderUserId: santa.id,
        }));
        expect(withSender.status).toBe(403);
        expect((await withSender.json()).code).toBe('SENDER_MISMATCH');

        // Old client: no senderUserId; the old recipient no longer exists.
        const withoutSender = await sendMessage(request({
            toId: recipient.id,
            content: 'sent before the reset',
        }));
        expect(withoutSender.status).toBe(400);

        const messages = await firestore.collection('messages').get();
        expect(messages.size).toBe(0);
    });

    test('6. status, full reset, then register with the old epoch -> 409; no token rows', async () => {
        const decoded = decodedFor(2);
        const status = await getPushRegistrationStatus({ decodedToken: decoded, token: DEVICE_TOKEN });

        await resetAndReseedParticipants(PARTICIPANTS);

        await expect(registerPushToken({
            decodedToken: decoded,
            token: DEVICE_TOKEN,
            expectedEpoch: status.epoch,
            expectedRevision: status.revision,
            enabled: true,
        })).rejects.toMatchObject({ code: 'STALE_REGISTRATION' });

        const tokens = await firestore.collection('pushTokens').get();
        expect(tokens.size).toBe(0);
    });

    test('7. admission while a reset is held at afterBegin -> RESET_IN_PROGRESS (503)', async () => {
        const reached = deferred();
        const gate = deferred();
        const reset = resetAndReseedParticipants(PARTICIPANTS, {
            afterBegin: async () => {
                reached.resolve();
                await gate.promise;
            },
        });
        await reached.promise;

        await expect(admitParticipant(decodedFor(3))).rejects.toMatchObject({
            code: 'RESET_IN_PROGRESS',
            status: 503,
        });

        gate.resolve();
        await reset;
        expect((await lifecycle()).state).toBe('active');
    });
});
