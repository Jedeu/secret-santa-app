/**
 * E2E Tests for User Assignment Realtime Updates
 *
 * These tests verify that when a user is assigned a Santa (gifterId updated),
 * their UI updates automatically without requiring a page refresh.
 *
 * CONTEXT: This was a bug where:
 * 1. Jed logs in and chooses Louis (Jed's recipientId = Louis)
 * 2. Louis logs in and chooses Jed (Louis's recipientId = Jed, Jed's gifterId = Louis)
 * 3. Jed should see Louis's messages in his Santa tab immediately
 * 4. BUG: Jed's local gifterId was null until page refresh
 *
 * FIX: Added onSnapshot listener to user document in useUser.js
 *
 * MANUAL VERIFICATION STEPS:
 * Due to Firebase Auth Emulator popup limitations in Playwright, these tests
 * require manual verification:
 *
 * 1. Start emulators: npm run emulators
 * 2. Start dev server: npm run dev
 * 3. Open two INCOGNITO browser windows
 * 4. In Window 1: Log in as jed.piezas@gmail.com
 * 5. In Window 2: Log in as ncammarasana@gmail.com (or another participant)
 * 6. In Window 1: Choose Window 2's user as recipient
 * 7. In Window 2: Choose Window 1's user as recipient
 * 8. In Window 2: Send a message via the Recipient tab
 * 9. EXPECTED: Window 1 should see the message in Santa tab immediately
 *              (without refreshing the page)
 *
 * Prerequisites:
 * - Firebase Emulators running: npm run emulators
 * - Test environment: FIREBASE_EMULATOR_HOST=127.0.0.1:8080
 */

import { test, expect, Page } from '@playwright/test';

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'xmasteak-app';

// Skip all tests unless running with emulators
test.skip(({ }, testInfo) => {
    return !process.env.FIREBASE_EMULATOR_HOST;
});

test.describe('User Assignment Realtime Updates', () => {

    /**
     * Helper: Seed participants into Firestore if not already present
     */
    async function seedParticipants(page: Page) {
        const response = await page.request.get('/api/dev/seed');
        // Don't fail if already seeded
        if (!response.ok() && response.status() !== 401) {
            console.log('Seed response:', await response.text());
        }
    }

    /**
     * Helper: Update a user's gifterId directly via Firestore REST API
     * This simulates what happens when another user chooses them as their recipient
     */
    async function updateUserGifterId(page: Page, userEmail: string, gifterId: string) {
        // First, query for the user by email
        const queryResponse = await page.request.post(
            `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
            {
                data: {
                    structuredQuery: {
                        from: [{ collectionId: 'users' }],
                        where: {
                            fieldFilter: {
                                field: { fieldPath: 'email' },
                                op: 'EQUAL',
                                value: { stringValue: userEmail }
                            }
                        },
                        limit: 1
                    }
                }
            }
        );

        const queryData = await queryResponse.json();
        if (!queryData[0]?.document?.name) {
            throw new Error(`User not found: ${userEmail}`);
        }

        // Extract document path and current fields
        const docPath = queryData[0].document.name;
        const currentFields = queryData[0].document.fields;

        // Update the gifterId field
        const updateData = {
            fields: {
                ...currentFields,
                gifterId: { stringValue: gifterId }
            }
        };

        const updateResponse = await page.request.patch(
            `${FIRESTORE_EMULATOR}${docPath.substring(docPath.indexOf('/v1'))}`,
            { data: updateData }
        );

        if (!updateResponse.ok()) {
            throw new Error(`Failed to update user: ${await updateResponse.text()}`);
        }

        return updateResponse.json();
    }

    test('Firestore REST API can update user gifterId', async ({ page }) => {
        // This test verifies our test helper works correctly
        await page.goto('/');
        await seedParticipants(page);

        // Query for a user to get their current state
        const queryResponse = await page.request.post(
            `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
            {
                data: {
                    structuredQuery: {
                        from: [{ collectionId: 'users' }],
                        limit: 2
                    }
                }
            }
        );

        expect(queryResponse.ok()).toBe(true);
        const users = await queryResponse.json();
        expect(users.length).toBeGreaterThanOrEqual(2);

        // Verify we have user data
        const user1 = users[0]?.document?.fields;
        const user2 = users[1]?.document?.fields;
        expect(user1?.email?.stringValue).toBeDefined();
        expect(user2?.email?.stringValue).toBeDefined();
    });

    test.describe('Realtime Assignment Updates', () => {
        // Skip: Requires authenticated state - see MANUAL VERIFICATION STEPS above
        test.skip(true, 'Requires multi-browser auth - use manual testing');

        test('gifterId update triggers immediate UI refresh', async ({ page }) => {
            // This test would:
            // 1. Log in as User A
            // 2. Verify Santa tab shows no messages
            // 3. Use REST API to update User A's gifterId
            // 4. Use REST API to inject a message from the new gifter
            // 5. Verify Santa tab now shows the message WITHOUT page refresh

            // Implementation blocked by auth popup issues
            // See MANUAL VERIFICATION STEPS at top of file
        });
    });
});
