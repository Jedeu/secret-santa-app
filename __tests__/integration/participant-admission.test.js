/**
 * Participant admission against the Firestore emulator (Admin SDK).
 * Tokens are synthetic decoded-token objects; emails come from the participant list.
 */

import { firestore } from '@/lib/firebase';
import { ensureAllParticipants } from '@/lib/firestore';
import {
    admitParticipant,
    closeYear,
    resolveParticipant,
    startNewYear,
} from '@/lib/participant-admission';
import { PARTICIPANTS, getRoster } from '@/lib/participants';
import { clearEmulatorFirestore } from './helpers/emulator-admin';

function decodedFor(index, uid = `it-uid-${index}`) {
    return { uid, email: PARTICIPANTS[index].email, email_verified: true, picture: null };
}

async function usersWithEmail(email, path = 'users') {
    const snapshot = await firestore.collection(path).where('email', '==', email).get();
    return snapshot.docs;
}

describe('participant admission (emulator)', () => {
    beforeEach(async () => {
        await clearEmulatorFirestore();
    });

    test('five concurrent admissions for one token create one profile and one index entry', async () => {
        const decoded = decodedFor(0);

        const results = await Promise.all(Array.from({ length: 5 }, () => admitParticipant(decoded)));

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
    });

    test('concurrent seed and admission produce exactly one profile for the participant', async () => {
        const decoded = decodedFor(1);

        const [, admitted] = await Promise.all([
            ensureAllParticipants(),
            admitParticipant(decoded),
        ]);

        const users = await usersWithEmail(decoded.email);
        expect(users).toHaveLength(1);
        expect(users[0].id).toBe(admitted.user.id);

        const all = await firestore.collection('users').get();
        expect(all.size).toBe(getRoster(2025).length);
    });

    test('concurrent ensureAllParticipants calls create one profile per participant', async () => {
        await Promise.all([
            ensureAllParticipants(),
            ensureAllParticipants(),
            ensureAllParticipants(),
        ]);

        const all = await firestore.collection('users').get();
        expect(all.size).toBe(getRoster(2025).length);
        const emails = all.docs.map((doc) => doc.data().email);
        expect(new Set(emails).size).toBe(getRoster(2025).length);
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
});
