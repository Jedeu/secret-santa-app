/** @jest-environment node */

jest.unmock('firebase/firestore');

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    assertFirestoreEmulatorReachable,
    authedDb,
    createRulesTestEnv,
    seedDoc,
    seedIdentity,
    seedUser,
} from './helpers/firestore-rules-test-utils';

const {
    collection,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    setDoc,
    Timestamp,
    writeBatch,
} = jest.requireActual('firebase/firestore');

const MESSAGE = {
    id: 'msg-1',
    fromId: 'user-a',
    toId: 'user-b',
    content: 'hello',
    timestamp: '2026-01-01T00:00:00.000Z',
    conversationId: 'santa_user-a_recipient_user-b',
};

function userDoc(id, email) {
    return { id, name: id, email, oauthId: null, image: null, recipientId: null, gifterId: null };
}

async function expectAllAccessDenied(db, uidForWrites) {
    await assertFails(getDoc(doc(db, 'users', 'user-a')));
    await assertFails(getDocs(collection(db, 'messages')));
    await assertFails(getDoc(doc(db, 'lastRead', 'user-a_santa_user-a_recipient_user-b')));
    await assertFails(setDoc(doc(db, 'users', uidForWrites), userDoc(uidForWrites, `${uidForWrites}@example.test`)));
    await assertFails(setDoc(doc(db, 'lastRead', `${uidForWrites}_santa_${uidForWrites}_recipient_user-b`), {
        userId: uidForWrites,
        conversationId: `santa_${uidForWrites}_recipient_user-b`,
        lastReadAt: Timestamp.fromDate(new Date()),
    }));
    await assertFails(setDoc(doc(db, 'typing', `santa_${uidForWrites}_recipient_user-b_${uidForWrites}`), {
        userId: uidForWrites,
        conversationId: `santa_${uidForWrites}_recipient_user-b`,
        typingAt: new Date().toISOString(),
    }));
    await assertFails(setDoc(doc(db, 'reactions', `msg-1_${uidForWrites}_👍`), {
        messageId: 'msg-1',
        userId: uidForWrites,
        emoji: '👍',
        createdAt: new Date().toISOString(),
    }));
}

describe('firestore rules: admission, lifecycle and reciprocal claims', () => {
    let testEnv;

    beforeAll(async () => {
        await assertFirestoreEmulatorReachable();
        testEnv = await createRulesTestEnv('admission');
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await seedUser(testEnv, 'user-a', 'user-a@example.test', 'User A');
        await seedUser(testEnv, 'user-b', 'user-b@example.test', 'User B');
        await seedUser(testEnv, 'user-c', 'user-c@example.test', 'User C');
        await seedDoc(testEnv, 'messages', 'msg-1', MESSAGE);
    });

    test('an admitted participant can read users and messages', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
        await assertSucceeds(getDoc(doc(db, 'users', 'user-b')));
        await assertSucceeds(getDocs(collection(db, 'messages')));
    });

    test('an outsider (no admission record) is denied every read and write', async () => {
        const db = authedDb(testEnv, 'outsider', 'outsider@example.test');
        await expectAllAccessDenied(db, 'outsider');
    });

    test('an identity from a previous epoch is denied every read and write', async () => {
        await seedDoc(testEnv, 'system', 'lifecycle', { epoch: 2, state: 'active' });
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
        await expectAllAccessDenied(db, 'user-a');
    });

    test('everyone is denied while the lifecycle state is unknown', async () => {
        await seedDoc(testEnv, 'system', 'lifecycle', { epoch: 1, state: 'unknown-state' });
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
        await expectAllAccessDenied(db, 'user-a');
    });

    test('server-only collections are never readable by clients', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
        await assertFails(getDoc(doc(db, 'authIdentities', 'user-a')));
        await assertFails(getDoc(doc(db, 'participantIndex', 'user-a@example.test')));
    });

    test('an admitted participant can get system/lifecycle but never write it', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
        await assertSucceeds(getDoc(doc(db, 'system', 'lifecycle')));
        await assertFails(setDoc(doc(db, 'system', 'lifecycle'), { epoch: 2, state: 'active' }));
    });

    test('users create and messages create fail even for admitted participants', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
        await assertFails(setDoc(doc(db, 'users', 'user-new'), userDoc('user-new', 'user-a@example.test')));
        await assertFails(setDoc(doc(db, 'messages', 'msg-2'), { ...MESSAGE, id: 'msg-2' }));
    });

    test('a remapped identity acts as its new profile only', async () => {
        await seedIdentity(testEnv, 'user-a', 'user-c', 'user-a@example.test');
        const db = authedDb(testEnv, 'user-a', 'user-a@example.test');

        await assertFails(setDoc(doc(db, 'typing', 'santa_user-a_recipient_user-b_user-a'), {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            typingAt: new Date().toISOString(),
        }));
        await assertSucceeds(setDoc(doc(db, 'typing', 'santa_user-c_recipient_user-b_user-c'), {
            userId: 'user-c',
            conversationId: 'santa_user-c_recipient_user-b',
            typingAt: new Date().toISOString(),
        }));
    });

    describe('reciprocal recipient claims', () => {
        test('a one-sided self selection fails', async () => {
            const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const batch = writeBatch(db);
            batch.update(doc(db, 'users', 'user-a'), { recipientId: 'user-b' });
            await assertFails(batch.commit());
        });

        test('a one-sided gifter claim fails', async () => {
            const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const batch = writeBatch(db);
            batch.update(doc(db, 'users', 'user-b'), { gifterId: 'user-a' });
            await assertFails(batch.commit());
        });

        test('the reciprocal batch succeeds', async () => {
            const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const batch = writeBatch(db);
            batch.update(doc(db, 'users', 'user-a'), { recipientId: 'user-b' });
            batch.update(doc(db, 'users', 'user-b'), { gifterId: 'user-a' });
            await assertSucceeds(batch.commit());
        });

        test('the RecipientSelector-style transaction succeeds', async () => {
            const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const meRef = doc(db, 'users', 'user-a');
            const recipientRef = doc(db, 'users', 'user-b');
            await assertSucceeds(runTransaction(db, async (tx) => {
                await tx.get(meRef);
                await tx.get(recipientRef);
                tx.update(meRef, { recipientId: 'user-b' });
                tx.update(recipientRef, { gifterId: 'user-a' });
            }));
        });

        test('the reciprocal batch plus a name change fails', async () => {
            const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const batch = writeBatch(db);
            batch.update(doc(db, 'users', 'user-a'), { recipientId: 'user-b', name: 'Renamed' });
            batch.update(doc(db, 'users', 'user-b'), { gifterId: 'user-a' });
            await assertFails(batch.commit());
        });

        test('the reciprocal batch plus an extra field fails', async () => {
            const db = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const batch = writeBatch(db);
            batch.update(doc(db, 'users', 'user-a'), { recipientId: 'user-b' });
            batch.update(doc(db, 'users', 'user-b'), { gifterId: 'user-a', extra: true });
            await assertFails(batch.commit());
        });

        test('a second claim and a claim on an already-claimed user fail', async () => {
            const dbA = authedDb(testEnv, 'user-a', 'user-a@example.test');
            const first = writeBatch(dbA);
            first.update(doc(dbA, 'users', 'user-a'), { recipientId: 'user-b' });
            first.update(doc(dbA, 'users', 'user-b'), { gifterId: 'user-a' });
            await assertSucceeds(first.commit());

            // user-a cannot choose again.
            const second = writeBatch(dbA);
            second.update(doc(dbA, 'users', 'user-a'), { recipientId: 'user-c' });
            second.update(doc(dbA, 'users', 'user-c'), { gifterId: 'user-a' });
            await assertFails(second.commit());

            // user-c cannot claim user-b, who already has a gifter.
            const dbC = authedDb(testEnv, 'user-c', 'user-c@example.test');
            const third = writeBatch(dbC);
            third.update(doc(dbC, 'users', 'user-c'), { recipientId: 'user-b' });
            third.update(doc(dbC, 'users', 'user-b'), { gifterId: 'user-c' });
            await assertFails(third.commit());
        });
    });
});
