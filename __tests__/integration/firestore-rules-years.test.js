/** @jest-environment node */

jest.unmock('firebase/firestore');

import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    assertFirestoreEmulatorReachable,
    authedDb,
    createRulesTestEnv,
    seedDoc,
    seedIdentity,
} from './helpers/firestore-rules-test-utils';

const {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    setDoc,
    Timestamp,
    writeBatch,
} = jest.requireActual('firebase/firestore');

/**
 * Year-scoped rules: 2025 = root collections, later years = years/{year}/…
 * All data is synthetic. Each year Y gets profiles `y{Y}-a`, `y{Y}-b`, `y{Y}-c`, a
 * message `y{Y}-msg` (a -> b), and a's own lastRead marker, typing doc and reaction.
 * The signed-in account is auth uid 'auth-a' (email a@example.test); its identity points
 * at the profile of whichever year a test needs.
 */

const AUTH_UID = 'auth-a';
const EMAIL = 'a@example.test';

function col(ys, name) {
    return ys === '2025' ? name : `years/${ys}/${name}`;
}

function ids(ys) {
    return {
        me: `y${ys}-a`,
        other: `y${ys}-b`,
        third: `y${ys}-c`,
        message: `y${ys}-msg`,
        conversation: `santa_y${ys}-a_recipient_y${ys}-b`,
    };
}

function profile(id, email) {
    return { id, name: id, email, oauthId: null, image: null, recipientId: null, gifterId: null };
}

async function seedYear(testEnv, ys) {
    const { me, other, third, message, conversation } = ids(ys);
    await seedDoc(testEnv, col(ys, 'users'), me, profile(me, EMAIL));
    await seedDoc(testEnv, col(ys, 'users'), other, profile(other, 'b@example.test'));
    await seedDoc(testEnv, col(ys, 'users'), third, profile(third, 'c@example.test'));
    await seedDoc(testEnv, col(ys, 'messages'), message, {
        id: message,
        fromId: me,
        toId: other,
        content: `synthetic ${ys}`,
        timestamp: `${ys}-12-01T10:00:00.000Z`,
        conversationId: conversation,
    });
    await seedDoc(testEnv, col(ys, 'lastRead'), `${me}_${conversation}`, {
        userId: me,
        conversationId: conversation,
        lastReadAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00.000Z')),
    });
    await seedDoc(testEnv, col(ys, 'typing'), `${conversation}_${me}`, {
        userId: me,
        conversationId: conversation,
        typingAt: new Date().toISOString(),
    });
    await seedDoc(testEnv, col(ys, 'reactions'), `${message}_${me}_🎄`, {
        messageId: message,
        userId: me,
        emoji: '🎄',
        createdAt: new Date().toISOString(),
    });
}

async function setLifecycle(testEnv, data) {
    await seedDoc(testEnv, 'system', 'lifecycle', data);
}

async function expectReadsDenied(db, ys) {
    const { me, message, conversation } = ids(ys);
    await assertFails(getDoc(doc(db, col(ys, 'users'), me)));
    await assertFails(getDocs(collection(db, col(ys, 'users'))));
    await assertFails(getDocs(collection(db, col(ys, 'messages'))));
    await assertFails(getDoc(doc(db, col(ys, 'messages'), message)));
    await assertFails(getDocs(collection(db, col(ys, 'reactions'))));
    await assertFails(getDoc(doc(db, col(ys, 'lastRead'), `${me}_${conversation}`)));
    await assertFails(getDoc(doc(db, col(ys, 'typing'), `${conversation}_${me}`)));
}

async function expectArchiveReadsAllowed(db, ys) {
    const { me, message } = ids(ys);
    await assertSucceeds(getDoc(doc(db, col(ys, 'users'), me)));
    await assertSucceeds(getDocs(collection(db, col(ys, 'users'))));
    await assertSucceeds(getDocs(collection(db, col(ys, 'messages'))));
    await assertSucceeds(getDoc(doc(db, col(ys, 'messages'), message)));
    await assertSucceeds(getDocs(collection(db, col(ys, 'reactions'))));
}

/**
 * Every writer type against year `ys`, acting as that year's profile `me`.
 */
async function expectWritesDenied(db, ys) {
    const { me, other, third, message, conversation } = ids(ys);

    const claim = writeBatch(db);
    claim.update(doc(db, col(ys, 'users'), me), { recipientId: third });
    claim.update(doc(db, col(ys, 'users'), third), { gifterId: me });
    await assertFails(claim.commit());

    await assertFails(setDoc(doc(db, col(ys, 'lastRead'), `${me}_santa_${me}_recipient_${third}`), {
        userId: me,
        conversationId: `santa_${me}_recipient_${third}`,
        lastReadAt: Timestamp.fromDate(new Date()),
    }));
    await assertFails(setDoc(doc(db, col(ys, 'lastRead'), `${me}_${conversation}`), {
        userId: me,
        conversationId: conversation,
        lastReadAt: Timestamp.fromDate(new Date()),
    }));

    await assertFails(setDoc(doc(db, col(ys, 'typing'), `santa_${me}_recipient_${other}_${me}`), {
        userId: me,
        conversationId: `santa_${me}_recipient_${other}`,
        typingAt: new Date().toISOString(),
    }));
    await assertFails(deleteDoc(doc(db, col(ys, 'typing'), `${conversation}_${me}`)));

    await assertFails(setDoc(doc(db, col(ys, 'reactions'), `${message}_${me}_👍`), {
        messageId: message,
        userId: me,
        emoji: '👍',
        createdAt: new Date().toISOString(),
    }));
    await assertFails(deleteDoc(doc(db, col(ys, 'reactions'), `${message}_${me}_🎄`)));
}

describe('firestore rules: year-scoped storage and lifecycle', () => {
    let testEnv;

    beforeAll(async () => {
        await assertFirestoreEmulatorReachable();
        testEnv = await createRulesTestEnv('years');
    });

    afterAll(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
        for (const ys of ['2025', '2026', '2027', '2028']) {
            await seedYear(testEnv, ys);
        }
    });

    function signedIn() {
        return authedDb(testEnv, AUTH_UID, EMAIL);
    }

    test('legacy active lifecycle without a year: root behaves as before; later years are denied', async () => {
        await setLifecycle(testEnv, { epoch: 1, state: 'active' });
        await seedIdentity(testEnv, AUTH_UID, ids('2025').me, EMAIL, 1);
        const db = signedIn();

        await expectArchiveReadsAllowed(db, '2025');
        const { me, conversation } = ids('2025');
        await assertSucceeds(getDoc(doc(db, 'lastRead', `${me}_${conversation}`)));
        await assertSucceeds(setDoc(doc(db, 'typing', `${conversation}_${me}`), {
            userId: me,
            conversationId: conversation,
            typingAt: new Date().toISOString(),
        }));
        await expectReadsDenied(db, '2026');
    });

    describe('rules-enforced malformed lifecycle', () => {
        test.each([
            ['resetting without a year', { epoch: 1, state: 'resetting' }],
            ['a null year', { epoch: 1, state: 'active', year: null }],
            ['a string year', { epoch: 1, state: 'active', year: '2026', closedYears: [2025] }],
            ['a missing epoch', { state: 'active' }],
            ['closedYears not a list', { epoch: 1, state: 'active', year: 2025, closedYears: 2025 }],
            ['closed without membership', { epoch: 1, state: 'closed', year: 2025, closedYears: [] }],
            ['active with the year listed', { epoch: 1, state: 'active', year: 2025, closedYears: [2025] }],
            ['year 2026 with an empty list', { epoch: 1, state: 'active', year: 2026, closedYears: [] }],
        ])('%s denies every read and write', async (_label, malformed) => {
            await setLifecycle(testEnv, malformed);
            await seedIdentity(testEnv, AUTH_UID, ids('2025').me, EMAIL, 1);
            const db = signedIn();

            await expectReadsDenied(db, '2025');
            await expectWritesDenied(db, '2025');

            await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 1);
            const db2026 = signedIn();
            await expectReadsDenied(db2026, '2026');
            await expectWritesDenied(db2026, '2026');
        });
    });

    test('a future-listed year is never readable', async () => {
        await setLifecycle(testEnv, { epoch: 1, state: 'active', year: 2026, closedYears: [2027] });
        await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 1);
        await expectReadsDenied(signedIn(), '2027');

        await setLifecycle(testEnv, { epoch: 1, state: 'active', year: 2026, closedYears: [2025, 2027] });
        const db = signedIn();
        await expectArchiveReadsAllowed(db, '2025');
        await expectReadsDenied(db, '2027');
    });

    describe('server-only list defects keep the hard bounds', () => {
        test.each([
            ['a duplicate entry', [2025, 2025, 2026]],
            ['descending order', [2026, 2025]],
            ['a string element', ['2025', 2026]],
        ])('%s: no future or unlisted year is readable and no non-current year is writable', async (_label, closedYears) => {
            await setLifecycle(testEnv, { epoch: 1, state: 'active', year: 2028, closedYears });
            await seedIdentity(testEnv, AUTH_UID, ids('2028').me, EMAIL, 1);
            await seedYear(testEnv, '2029');
            const db = signedIn();

            // 2027 was never listed; 2029 is in the future.
            await expectReadsDenied(db, '2027');
            await expectReadsDenied(db, '2029');

            for (const ys of ['2025', '2026', '2027']) {
                await seedIdentity(testEnv, AUTH_UID, ids(ys).me, EMAIL, 1);
                await expectWritesDenied(signedIn(), ys);
            }
        });
    });

    test('closed 2025: root reads allowed; every root writer and every 2026 access denied', async () => {
        await setLifecycle(testEnv, { epoch: 1, state: 'closed', year: 2025, closedYears: [2025] });
        await seedIdentity(testEnv, AUTH_UID, ids('2025').me, EMAIL, 1);
        const db = signedIn();

        await expectArchiveReadsAllowed(db, '2025');

        const { me, third } = ids('2025');
        await assertFails(writeBatch(db)
            .update(doc(db, 'users', me), { recipientId: third })
            .update(doc(db, 'users', third), { gifterId: me })
            .commit());
        await expectWritesDenied(db, '2025');

        await expectReadsDenied(db, '2026');
        await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 1);
        await expectWritesDenied(signedIn(), '2026');
    });

    test('active 2026 after a closed 2025: own writes in 2026 succeed; root is read-only; other year paths are denied', async () => {
        await setLifecycle(testEnv, { epoch: 2, state: 'active', year: 2026, closedYears: [2025] });
        await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 2);
        const db = signedIn();
        const { me, other, third, message, conversation } = ids('2026');

        const claim = writeBatch(db);
        claim.update(doc(db, 'years/2026/users', me), { recipientId: third });
        claim.update(doc(db, 'years/2026/users', third), { gifterId: me });
        await assertSucceeds(claim.commit());

        await assertSucceeds(setDoc(doc(db, 'years/2026/lastRead', `${me}_${conversation}`), {
            userId: me,
            conversationId: conversation,
            lastReadAt: Timestamp.fromDate(new Date()),
        }));
        await assertSucceeds(setDoc(doc(db, 'years/2026/typing', `santa_${me}_recipient_${other}_${me}`), {
            userId: me,
            conversationId: `santa_${me}_recipient_${other}`,
            typingAt: new Date().toISOString(),
        }));
        await assertSucceeds(deleteDoc(doc(db, 'years/2026/typing', `${conversation}_${me}`)));
        await assertSucceeds(setDoc(doc(db, 'years/2026/reactions', `${message}_${me}_👍`), {
            messageId: message,
            userId: me,
            emoji: '👍',
            createdAt: new Date().toISOString(),
        }));
        await assertSucceeds(deleteDoc(doc(db, 'years/2026/reactions', `${message}_${me}_🎄`)));

        // A 2026 reaction needs a 2026 message (the 2025 message id does not count).
        await assertFails(setDoc(doc(db, 'years/2026/reactions', `${ids('2025').message}_${me}_👍`), {
            messageId: ids('2025').message,
            userId: me,
            emoji: '👍',
            createdAt: new Date().toISOString(),
        }));

        await expectArchiveReadsAllowed(db, '2025');
        await seedIdentity(testEnv, AUTH_UID, ids('2025').me, EMAIL, 2);
        await expectWritesDenied(signedIn(), '2025');

        await seedIdentity(testEnv, AUTH_UID, me, EMAIL, 2);
        const again = signedIn();
        for (const segment of ['2025', '02026', '2027', 'abc']) {
            await assertFails(getDocs(collection(again, `years/${segment}/users`)));
            await assertFails(getDocs(collection(again, `years/${segment}/messages`)));
            await assertFails(setDoc(doc(again, `years/${segment}/typing`, `santa_${me}_recipient_${other}_${me}`), {
                userId: me,
                conversationId: `santa_${me}_recipient_${other}`,
                typingAt: new Date().toISOString(),
            }));
        }
    });

    test('a skipped year is never readable', async () => {
        await setLifecycle(testEnv, { epoch: 3, state: 'active', year: 2028, closedYears: [2025, 2026] });
        await seedIdentity(testEnv, AUTH_UID, ids('2028').me, EMAIL, 3);

        await expectReadsDenied(signedIn(), '2027');
    });

    test('second rollover: 2025 and 2026 are readable archives; every writer is denied against both', async () => {
        await setLifecycle(testEnv, { epoch: 3, state: 'active', year: 2027, closedYears: [2025, 2026] });
        await seedIdentity(testEnv, AUTH_UID, ids('2027').me, EMAIL, 3);
        const db = signedIn();

        await expectArchiveReadsAllowed(db, '2025');
        await expectArchiveReadsAllowed(db, '2026');

        for (const ys of ['2025', '2026']) {
            await seedIdentity(testEnv, AUTH_UID, ids(ys).me, EMAIL, 3);
            await expectWritesDenied(signedIn(), ys);
        }
    });

    test('a stale-epoch identity is denied everything, root included', async () => {
        await setLifecycle(testEnv, { epoch: 2, state: 'active', year: 2026, closedYears: [2025] });
        await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 1);
        const db = signedIn();

        await expectReadsDenied(db, '2025');
        await expectReadsDenied(db, '2026');
        await expectWritesDenied(db, '2026');

        await seedIdentity(testEnv, AUTH_UID, ids('2025').me, EMAIL, 1);
        await expectWritesDenied(signedIn(), '2025');
    });

    test('lastRead and typing of a non-current year are unreadable', async () => {
        await setLifecycle(testEnv, { epoch: 2, state: 'active', year: 2026, closedYears: [2025] });
        await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 2);
        const db = signedIn();

        const old = ids('2025');
        await assertFails(getDoc(doc(db, 'lastRead', `${old.me}_${old.conversation}`)));
        await assertFails(getDoc(doc(db, 'typing', `${old.conversation}_${old.me}`)));

        const current = ids('2026');
        await assertSucceeds(getDoc(doc(db, 'years/2026/lastRead', `${current.me}_${current.conversation}`)));
        await assertSucceeds(getDoc(doc(db, 'years/2026/typing', `${current.conversation}_${current.me}`)));
    });

    test('system/lifecycle: get for an identity holder only; list and write always denied', async () => {
        await setLifecycle(testEnv, { epoch: 2, state: 'active', year: 2026, closedYears: [2025] });
        // A stale identity still learns the lifecycle.
        await seedIdentity(testEnv, AUTH_UID, ids('2026').me, EMAIL, 1);
        const db = signedIn();

        await assertSucceeds(getDoc(doc(db, 'system', 'lifecycle')));
        await assertFails(getDocs(collection(db, 'system')));
        await assertFails(setDoc(doc(db, 'system', 'lifecycle'), { epoch: 9, state: 'active' }));

        const outsider = authedDb(testEnv, 'outsider', 'outsider@example.test');
        await assertFails(getDoc(doc(outsider, 'system', 'lifecycle')));
    });
});
