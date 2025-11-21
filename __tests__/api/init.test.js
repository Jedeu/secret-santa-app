/**
 * Tests for /api/init endpoint - participant initialization
 */

import { POST } from '@/app/api/init/route';
import { getAllUsers } from '@/lib/firestore';

// Reset database before each test
beforeEach(() => {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(process.cwd(), 'data', 'db.json');
    const initialData = { users: [], messages: [], lastRead: [] };
    fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
});

describe('POST /api/init', () => {
    test('should initialize all 8 participants', async () => {
        const response = await POST();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.message).toContain('participants initialized');

        // Verify all 8 participants were created
        const allUsers = await getAllUsers();
        expect(allUsers).toHaveLength(8);
    });

    test('should create participants with correct data structure', async () => {
        await POST();

        const allUsers = await getAllUsers();
        const expectedNames = ['Jed', 'Natalie', 'Chinh', 'Gaby', 'Jana', 'Peter', 'Louis', 'Genevieve'];

        allUsers.forEach(user => {
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
        const usersAfterFirst = await getAllUsers();
        expect(usersAfterFirst).toHaveLength(8);

        // Second initialization
        await POST();
        const usersAfterSecond = await getAllUsers();
        expect(usersAfterSecond).toHaveLength(8);

        // IDs should be the same
        const ids1 = usersAfterFirst.map(u => u.id).sort();
        const ids2 = usersAfterSecond.map(u => u.id).sort();
        expect(ids2).toEqual(ids1);
    });

    test('should preserve existing user data when re-initialized', async () => {
        // First initialization
        await POST();

        // Update a user
        const { getUserByEmail, updateUser } = require('@/lib/firestore');
        const jed = await getUserByEmail('jed.piezas@gmail.com');
        await updateUser(jed.id, {
            oauthId: 'oauth123',
            image: 'https://example.com/jed.jpg'
        });

        // Re-initialize
        await POST();

        // Check that the updated data is preserved
        const jedAfter = await getUserByEmail('jed.piezas@gmail.com');
        expect(jedAfter.oauthId).toBe('oauth123');
        expect(jedAfter.image).toBe('https://example.com/jed.jpg');
    });
});
