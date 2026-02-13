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

const { doc, deleteDoc, getDoc, setDoc } = jest.requireActual('firebase/firestore');

describe('firestore rules: typing', () => {
    let testEnv;

    beforeAll(async () => {
        await assertFirestoreEmulatorReachable();
        testEnv = await createRulesTestEnv('typing');
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
    });

    test('create succeeds when typingId matches conversationId_userId', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        const payload = {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            typingAt: new Date().toISOString(),
        };

        await assertSucceeds(setDoc(doc(db, 'typing', 'santa_user-a_recipient_user-b_user-a'), payload));
    });

    test('create is rejected when typingId does not match payload', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        const payload = {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            typingAt: new Date().toISOString(),
        };

        await assertFails(setDoc(doc(db, 'typing', 'wrong-id'), payload));
    });

    test('cross-user read is allowed for signed-in users', async () => {
        await seedDoc(testEnv, 'typing', 'santa_user-a_recipient_user-b_user-a', {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            typingAt: new Date().toISOString(),
        });

        const db = authedDb(testEnv, 'user-b', 'user-b@example.com');
        await assertSucceeds(getDoc(doc(db, 'typing', 'santa_user-a_recipient_user-b_user-a')));
    });

    test('cross-user write is rejected when auth does not match payload userId', async () => {
        const db = authedDb(testEnv, 'user-b', 'user-b@example.com');
        const payload = {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            typingAt: new Date().toISOString(),
        };

        await assertFails(setDoc(doc(db, 'typing', 'santa_user-a_recipient_user-b_user-a'), payload));
    });

    test('owner can delete own typing status', async () => {
        await seedDoc(testEnv, 'typing', 'santa_user-a_recipient_user-b_user-a', {
            userId: 'user-a',
            conversationId: 'santa_user-a_recipient_user-b',
            typingAt: new Date().toISOString(),
        });

        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        await assertSucceeds(deleteDoc(doc(db, 'typing', 'santa_user-a_recipient_user-b_user-a')));
    });
});
