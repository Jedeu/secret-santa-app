import { NextResponse } from 'next/server';
import { getAllUsers, batchUpdateUsers } from '@/lib/firestore';
import { auth as adminAuth } from '@/lib/firebase';

export async function POST(request) {
    try {
        // Get Authorization header
        const authHeader = request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify Firebase ID token
        const decodedToken = await adminAuth.verifyIdToken(token);
        const email = decodedToken.email;

        // Check if user is admin
        if (email !== 'jed.piezas@gmail.com') {
            return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
        }

        // Get all users
        const users = await getAllUsers();

        if (users.length < 2) {
            return NextResponse.json({ error: 'Not enough users to assign' }, { status: 400 });
        }

        // Shuffle users (Fisher-Yates shuffle)
        const shuffled = [...users];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Assign recipients (circular)
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

        return NextResponse.json({ success: true, message: 'Users assigned successfully' });
    } catch (error) {
        console.error('Assignment failed:', error);
        return NextResponse.json({ error: 'Failed to assign users' }, { status: 500 });
    }
}
