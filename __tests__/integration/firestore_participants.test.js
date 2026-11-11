/**
 * Tests for ensureAllParticipants (seeding the active year's roster) against the
 * Firestore emulator. Reads go through the Admin SDK.
 */

import { firestore } from '@/lib/firebase';
import { ensureAllParticipants } from '@/lib/firestore';
import { getRoster } from '@/lib/participants';
import { clearEmulatorFirestore } from './helpers/emulator-admin';

const roster = getRoster(2025);

async function allUsers() {
    const snapshot = await firestore.collection('users').get();
    return snapshot.docs.map((doc) => doc.data());
}

async function userByEmail(email) {
    const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
    return snapshot.empty ? null : snapshot.docs[0].data();
}

describe('ensureAllParticipants', () => {
    beforeEach(async () => {
        await clearEmulatorFirestore();
    });

    test('should create all participants of the active year if they do not exist', async () => {
        const result = await ensureAllParticipants();

        expect(result).toMatchObject({ year: 2025, created: roster.length, linked: 0, existing: 0 });
        expect(await allUsers()).toHaveLength(roster.length);

        // Check each participant was created correctly
        for (const participant of roster) {
            const user = await userByEmail(participant.email);
            expect(user).toBeTruthy();
            expect(user.name).toBe(participant.name);
            expect(user.email).toBe(participant.email);
            expect(user.recipientId).toBeNull();
            expect(user.gifterId).toBeNull();
            expect(user.oauthId).toBeNull();
            expect(user.image).toBeNull();
        }
    });

    test('should not create duplicates if participants already exist', async () => {
        // First call - creates participants
        await ensureAllParticipants();
        const usersAfterFirst = await allUsers();
        expect(usersAfterFirst).toHaveLength(roster.length);

        // Second call - should not create duplicates
        const second = await ensureAllParticipants();
        expect(second).toMatchObject({ created: 0, existing: roster.length });
        const usersAfterSecond = await allUsers();
        expect(usersAfterSecond).toHaveLength(roster.length);

        // IDs should stay the same for all participants
        const idsFirst = usersAfterFirst.map(u => u.id).sort();
        const idsSecond = usersAfterSecond.map(u => u.id).sort();
        expect(idsSecond).toEqual(idsFirst);
    });

    test('should preserve existing user data when called again', async () => {
        await ensureAllParticipants();

        const participant = roster[0];
        const user = await userByEmail(participant.email);
        await firestore.collection('users').doc(user.id).update({
            oauthId: 'oauth123',
            image: 'https://example.test/avatar.jpg',
            recipientId: 'some-recipient-id'
        });

        await ensureAllParticipants();

        const userAfter = await userByEmail(participant.email);
        expect(userAfter.oauthId).toBe('oauth123');
        expect(userAfter.image).toBe('https://example.test/avatar.jpg');
        expect(userAfter.recipientId).toBe('some-recipient-id');
    });

    test('should create participants with unique IDs', async () => {
        await ensureAllParticipants();
        const users = await allUsers();

        const ids = users.map(u => u.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(users.length);
    });
});
