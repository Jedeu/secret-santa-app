/**
 * Tests for ensureAllParticipants function in firestore.js
 */

import { ensureAllParticipants, getAllUsers, getUserByEmail } from '@/lib/firestore';

describe('ensureAllParticipants', () => {
    const mockParticipants = [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' },
        { name: 'Charlie', email: 'charlie@example.com' }
    ];

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
        expect(allUsers).toHaveLength(3);

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
        expect(usersAfterFirst).toHaveLength(3);

        // Second call - should not create duplicates
        await ensureAllParticipants(mockParticipants);
        const usersAfterSecond = await getAllUsers();
        expect(usersAfterSecond).toHaveLength(3);

        // Verify same IDs
        expect(usersAfterSecond[0].id).toBe(usersAfterFirst[0].id);
        expect(usersAfterSecond[1].id).toBe(usersAfterFirst[1].id);
        expect(usersAfterSecond[2].id).toBe(usersAfterFirst[2].id);
    });

    test('should preserve existing user data when called again', async () => {
        await ensureAllParticipants(mockParticipants);

        // Get Alice and update her
        const alice = await getUserByEmail('alice@example.com');
        const { updateUser } = require('@/lib/firestore');
        await updateUser(alice.id, {
            oauthId: 'oauth123',
            image: 'https://example.com/alice.jpg',
            recipientId: 'some-recipient-id'
        });

        // Call ensureAllParticipants again
        await ensureAllParticipants(mockParticipants);

        // Alice's data should be preserved
        const aliceAfter = await getUserByEmail('alice@example.com');
        expect(aliceAfter.oauthId).toBe('oauth123');
        expect(aliceAfter.image).toBe('https://example.com/alice.jpg');
        expect(aliceAfter.recipientId).toBe('some-recipient-id');
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
