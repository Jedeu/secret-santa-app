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

const { doc, getDoc, setDoc, Timestamp } = jest.requireActual('firebase/firestore');

const DM_ID = 'user-a_santa_user-a_recipient_user-b';
const DM_CONV = 'santa_user-a_recipient_user-b';
const SEEDED_AT = new Date('2026-02-13T00:00:00.000Z');

describe('firestore rules: lastRead', () => {
    let testEnv;

    beforeAll(async () => {
        await assertFirestoreEmulatorReachable();
        testEnv = await createRulesTestEnv('lastread');
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();

        await seedUser(testEnv, 'user-a', 'user-a@example.com', 'User A');
        await seedUser(testEnv, 'user-b', 'user-b@example.com', 'User B');

        await seedDoc(testEnv, 'lastRead', 'user-a_santa_user-a_recipient_user-b', {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            lastReadAt: Timestamp.fromDate(new Date('2026-02-13T00:00:00.000Z')),
        });

        await seedDoc(testEnv, 'lastRead', 'user-a_publicFeed_santa_user-a_recipient_user-b', {
            userId: 'user-a',
            conversationId: 'publicFeed_santa_user-a_recipient_user-b',
            lastReadAt: Timestamp.fromDate(new Date('2026-02-13T00:00:00.000Z')),
        });
    });

    test('owner can read own lastRead doc', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        await assertSucceeds(getDoc(doc(db, 'lastRead', 'user-a_santa_user-a_recipient_user-b')));
    });

    test('other signed-in users can read DM lastRead docs', async () => {
        const db = authedDb(testEnv, 'user-b', 'user-b@example.com');
        await assertSucceeds(getDoc(doc(db, 'lastRead', 'user-a_santa_user-a_recipient_user-b')));
    });

    test('other signed-in users cannot read publicFeed_* lastRead docs', async () => {
        const db = authedDb(testEnv, 'user-b', 'user-b@example.com');
        await assertFails(getDoc(doc(db, 'lastRead', 'user-a_publicFeed_santa_user-a_recipient_user-b')));
    });

    test('DM lastRead read works even when target document does not yet exist', async () => {
        const db = authedDb(testEnv, 'user-b', 'user-b@example.com');
        await assertSucceeds(getDoc(doc(db, 'lastRead', 'user-a_santa_user-a_recipient_user-c')));
    });

    test('owner can read a missing own publicFeed_* doc; another user cannot', async () => {
        const missingId = 'user-a_publicFeed_santa_user-x_recipient_user-y';
        await assertSucceeds(getDoc(doc(authedDb(testEnv, 'user-a', 'user-a@example.com'), 'lastRead', missingId)));
        await assertFails(getDoc(doc(authedDb(testEnv, 'user-b', 'user-b@example.com'), 'lastRead', missingId)));
    });

    test('markers are monotonic: an older update fails, a newer one succeeds', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        const ref = doc(db, 'lastRead', DM_ID);

        await assertFails(setDoc(ref, {
            userId: 'user-a',
            conversationId: DM_CONV,
            lastReadAt: Timestamp.fromDate(new Date(SEEDED_AT.getTime() - 60_000)),
        }));
        await assertSucceeds(setDoc(ref, {
            userId: 'user-a',
            conversationId: DM_CONV,
            lastReadAt: Timestamp.fromDate(new Date(SEEDED_AT.getTime() + 60_000)),
        }));
    });

    test('a marker more than 5 minutes in the future is rejected', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');

        await assertFails(setDoc(doc(db, 'lastRead', DM_ID), {
            userId: 'user-a',
            conversationId: DM_CONV,
            lastReadAt: Timestamp.fromDate(new Date(Date.now() + 10 * 60_000)),
        }));
    });

    test('the doc id must equal userId + "_" + conversationId', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');

        await assertFails(setDoc(doc(db, 'lastRead', 'user-a_some-other-conversation'), {
            userId: 'user-a',
            conversationId: DM_CONV,
            lastReadAt: Timestamp.fromDate(new Date()),
        }));
        await assertSucceeds(setDoc(doc(db, 'lastRead', 'user-a_santa_user-b_recipient_user-a'), {
            userId: 'user-a',
            conversationId: 'santa_user-b_recipient_user-a',
            lastReadAt: Timestamp.fromDate(new Date()),
        }));
    });

    test('a remapped identity cannot write the old profile path', async () => {
        await seedUser(testEnv, 'user-c', 'user-a@example.com', 'User A (new profile)', { admitted: false });
        await seedIdentity(testEnv, 'user-a', 'user-c', 'user-a@example.com');
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');

        await assertFails(setDoc(doc(db, 'lastRead', DM_ID), {
            userId: 'user-a',
            conversationId: DM_CONV,
            lastReadAt: Timestamp.fromDate(new Date()),
        }));
        await assertSucceeds(setDoc(doc(db, 'lastRead', 'user-c_santa_user-c_recipient_user-b'), {
            userId: 'user-c',
            conversationId: 'santa_user-c_recipient_user-b',
            lastReadAt: Timestamp.fromDate(new Date()),
        }));
    });
});
