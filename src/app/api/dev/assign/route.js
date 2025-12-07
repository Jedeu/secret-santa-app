import { NextResponse } from 'next/server';
import { getAllUsers, batchUpdateUsers } from '@/lib/firestore';

/**
 * DEV-ONLY: Assign Secret Santas without requiring admin auth
 * This route is only available in development mode for E2E testing.
 * 
 * Usage: POST /api/dev/assign
 */
export async function POST() {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }

    try {
        // Get all users
        const users = await getAllUsers();

        if (users.length < 2) {
            return NextResponse.json({
                error: 'Need at least 2 users to assign',
                usersFound: users.length
            }, { status: 400 });
        }

        // Shuffle using Fisher-Yates
        const shuffled = [...users];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Create circular assignment
        const updates = [];
        for (let i = 0; i < shuffled.length; i++) {
            const currentUser = shuffled[i];
            const recipient = shuffled[(i + 1) % shuffled.length];

            updates.push({
                id: currentUser.id,
                recipientId: recipient.id,
                gifterId: shuffled[(i - 1 + shuffled.length) % shuffled.length].id
            });
        }

        // Save to Firestore
        await batchUpdateUsers(updates);

        return NextResponse.json({
            success: true,
            message: 'Users assigned successfully',
            assignmentsCount: updates.length
        });
    } catch (error) {
        console.error('Dev assignment failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
