/**
 * Tests for ensureAllParticipants function in firestore.js
 */

import { ensureAllParticipants, getAllUsers, getUserByEmail } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';

const mockParticipants = PARTICIPANTS;

describe('ensureAllParticipants', () => {

    beforeEach(() => {
        // Reset the local DB before each test
        const fs = require('fs');
        const path = require('path');
        const dbPath = path.join(process.cwd(), 'data', 'db.json');
        const initialData = { users: [], messages: [], lastRead: [] };
        fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
    });

    test('should create all participants if they do not exist', async () => {
        await ensureAllParticipants(mockParticipants);

        const allUsers = await getAllUsers();
        expect(allUsers).toHaveLength(PARTICIPANTS.length);

        // Check each participant was created correctly
        for (const participant of mockParticipants) {
            const user = await getUserByEmail(participant.email);
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
        await ensureAllParticipants(mockParticipants);
        const usersAfterFirst = await getAllUsers();
        expect(usersAfterFirst).toHaveLength(PARTICIPANTS.length);

        // Second call - should not create duplicates
        await ensureAllParticipants(mockParticipants);
        const usersAfterSecond = await getAllUsers();
        expect(usersAfterSecond).toHaveLength(PARTICIPANTS.length);

        // Verify same IDs
        // IDs should stay the same for all participants
        const idsFirst = usersAfterFirst.map(u => u.id).sort();
        const idsSecond = usersAfterSecond.map(u => u.id).sort();
        expect(idsSecond).toEqual(idsFirst);
    });

    test('should preserve existing user data when called again', async () => {
        await ensureAllParticipants(mockParticipants);

        // Get Alice and update her
        const participant = mockParticipants[0];
        const user = await getUserByEmail(participant.email);
        const { updateUser } = require('@/lib/firestore');
        await updateUser(user.id, {
            oauthId: 'oauth123',
            image: 'https://example.com/' + participant.name.toLowerCase() + '.jpg',
            recipientId: 'some-recipient-id'
        });

        // Call ensureAllParticipants again
        await ensureAllParticipants(mockParticipants);

        // Alice's data should be preserved
        const participant2 = mockParticipants[0];
        const userAfter = await getUserByEmail(participant2.email);
        expect(userAfter.oauthId).toBe('oauth123');
        expect(userAfter.image).toBe('https://example.com/' + participant2.name.toLowerCase() + '.jpg');
        expect(userAfter.recipientId).toBe('some-recipient-id');
    });

    test('should handle empty participant list', async () => {
        await ensureAllParticipants([]);
        const allUsers = await getAllUsers();
        expect(allUsers).toHaveLength(0);
    });

    test('should create participants with unique IDs', async () => {
        await ensureAllParticipants(mockParticipants);
        const allUsers = await getAllUsers();

        const ids = allUsers.map(u => u.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(allUsers.length);
    });
});
