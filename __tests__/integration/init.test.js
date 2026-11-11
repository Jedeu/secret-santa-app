/**
 * Tests for /api/init endpoint - seeding the active year's roster
 */

import { POST } from '@/app/api/init/route';
import { firestore } from '@/lib/firebase';
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

describe('POST /api/init', () => {
    beforeEach(async () => {
        await clearEmulatorFirestore();
    });

    test('should initialize every participant of the 2025 roster', async () => {
        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.message).toContain('participants initialized');
        expect(data.year).toBe(2025);

        expect(await allUsers()).toHaveLength(roster.length);
    });

    test('should create participants with correct data structure', async () => {
        await POST();

        const users = await allUsers();
        const expectedNames = roster.map((participant) => participant.name);

        users.forEach(user => {
            expect(user.id).toBeTruthy();
            expect(expectedNames).toContain(user.name);
            expect(user.email).toBeTruthy();
            expect(user.email).toContain('@');
            expect(user.recipientId).toBeNull();
            expect(user.gifterId).toBeNull();
            expect(user.oauthId).toBeNull();
            expect(user.image).toBeNull();
        });
    });

    test('should not create duplicates when called multiple times', async () => {
        // First initialization
        await POST();
        const usersAfterFirst = await allUsers();
        expect(usersAfterFirst).toHaveLength(roster.length);

        // Second initialization
        await POST();
        const usersAfterSecond = await allUsers();
        expect(usersAfterSecond).toHaveLength(roster.length);

        // IDs should be the same
        const ids1 = usersAfterFirst.map(u => u.id).sort();
        const ids2 = usersAfterSecond.map(u => u.id).sort();
        expect(ids2).toEqual(ids1);
    });

    test('should preserve existing user data when re-initialized', async () => {
        // First initialization
        await POST();

        // Update a user
        const before = await userByEmail(roster[0].email);
        await firestore.collection('users').doc(before.id).update({
            oauthId: 'oauth123',
            image: 'https://example.test/avatar.jpg'
        });

        // Re-initialize
        await POST();

        // Check that the updated data is preserved
        const after = await userByEmail(roster[0].email);
        expect(after.oauthId).toBe('oauth123');
        expect(after.image).toBe('https://example.test/avatar.jpg');
    });
});
