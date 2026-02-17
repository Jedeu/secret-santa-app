/** @jest-environment node */

jest.unmock('firebase/firestore');

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    assertFirestoreEmulatorReachable,
    authedDb,
    createRulesTestEnv,
    seedDoc,
    seedUser,
} from './helpers/firestore-rules-test-utils';

const { doc, getDoc, Timestamp } = jest.requireActual('firebase/firestore');

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
});
