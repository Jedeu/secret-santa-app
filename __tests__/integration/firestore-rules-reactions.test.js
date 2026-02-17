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

const { doc, deleteDoc, setDoc, updateDoc } = jest.requireActual('firebase/firestore');

describe('firestore rules: reactions', () => {
    let testEnv;

    beforeAll(async () => {
        await assertFirestoreEmulatorReachable();
        testEnv = await createRulesTestEnv('reactions');
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

        await seedDoc(testEnv, 'messages', 'msg-1', {
            id: 'msg-1',
            fromId: 'user-a',
            toId: 'user-b',
            content: 'hello',
            timestamp: new Date().toISOString(),
            conversationId: 'santa_user-a_recipient_user-b',
            isSantaMsg: false,
            fromName: 'User A',
            toName: 'User B',
        });
    });

    test('create succeeds with valid message ref and deterministic reactionId', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        await assertSucceeds(
            setDoc(doc(db, 'reactions', 'msg-1_user-a_👍'), {
                messageId: 'msg-1',
                userId: 'user-a',
                emoji: '👍',
                createdAt: new Date().toISOString(),
            })
        );
    });

    test('create is rejected when reactionId does not match payload', async () => {
        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        await assertFails(
            setDoc(doc(db, 'reactions', 'wrong-id'), {
                messageId: 'msg-1',
                userId: 'user-a',
                emoji: '👍',
                createdAt: new Date().toISOString(),
            })
        );
    });

    test('owner can delete own reaction', async () => {
        await seedDoc(testEnv, 'reactions', 'msg-1_user-a_🎄', {
            messageId: 'msg-1',
            userId: 'user-a',
            emoji: '🎄',
            createdAt: new Date().toISOString(),
        });

        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        await assertSucceeds(deleteDoc(doc(db, 'reactions', 'msg-1_user-a_🎄')));
    });

    test('cross-user delete is rejected', async () => {
        await seedDoc(testEnv, 'reactions', 'msg-1_user-a_😂', {
            messageId: 'msg-1',
            userId: 'user-a',
            emoji: '😂',
            createdAt: new Date().toISOString(),
        });

        const db = authedDb(testEnv, 'user-b', 'user-b@example.com');
        await assertFails(deleteDoc(doc(db, 'reactions', 'msg-1_user-a_😂')));
    });

    test('update is always rejected', async () => {
        await seedDoc(testEnv, 'reactions', 'msg-1_user-a_❤️', {
            messageId: 'msg-1',
            userId: 'user-a',
            emoji: '❤️',
            createdAt: new Date().toISOString(),
        });

        const db = authedDb(testEnv, 'user-a', 'user-a@example.com');
        await assertFails(updateDoc(doc(db, 'reactions', 'msg-1_user-a_❤️'), { emoji: '😮' }));
    });
});
