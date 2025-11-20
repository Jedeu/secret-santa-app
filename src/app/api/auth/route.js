import { NextResponse } from 'next/server';
import { getUserByEmail, createUser, getAllUsers, batchUpdateUsers } from '@/lib/firestore';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

export async function POST(request) {
    const { action, recipientName } = await request.json();

    // Get authenticated session
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the authenticated user in database
    const user = await getUserByEmail(session.user.email);
    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (action === 'setRecipient') {
        // Check if user already has a recipient assigned
        if (user.recipientId) {
            return NextResponse.json({
                error: 'Recipient already assigned. Cannot change recipient.'
            }, { status: 400 });
        }

        if (!recipientName) {
            return NextResponse.json({ error: 'Recipient name is required' }, { status: 400 });
        }

        // Find or create recipient
        const allUsers = await getAllUsers();
        let recipient = allUsers.find(u => u.name.toLowerCase() === recipientName.toLowerCase());

        if (!recipient) {
            // Create placeholder recipient if they don't exist yet
            recipient = {
                id: uuidv4(),
                name: recipientName,
                email: null, // Will be filled when they authenticate
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            await createUser(recipient);
        }

        // Link them
        // We need to update both user and recipient
        user.recipientId = recipient.id;
        recipient.gifterId = user.id;

        // Update both in Firestore
        // We can use batchUpdateUsers but that takes an array of users with updated fields
        // Or just update individually.
        // Let's use batchUpdateUsers for consistency if we have it, or just update individually.
        // firestore.js has updateUser(userId, data)
        // But I didn't export it? I did.

        // Wait, I exported `updateUser` but I also exported `batchUpdateUsers`.
        // Let's use `batchUpdateUsers` for atomicity if possible, but `batchUpdateUsers` in my implementation takes an array of FULL user objects or partial?
        // My implementation:
        /*
        export async function batchUpdateUsers(users) {
            checkFirestore();
            const batch = firestore.batch();
            users.forEach(user => {
                const ref = firestore.collection('users').doc(user.id);
                batch.update(ref, {
                    recipientId: user.recipientId,
                    gifterId: user.gifterId
                });
            });
            await batch.commit();
        }
        */
        // It updates recipientId and gifterId. Perfect.

        await batchUpdateUsers([user, recipient]);

        return NextResponse.json({ success: true, user });
    }

    if (action === 'assign') {
        // Re-assign EVERYONE to ensure a clean loop
        // This is an admin action - in production you'd want to restrict this
        const allUsers = await getAllUsers();

        if (allUsers.length < 2) {
            return NextResponse.json({ error: 'Not enough users to assign' }, { status: 400 });
        }

        // Clear existing assignments first (in memory)
        allUsers.forEach(u => {
            u.recipientId = null;
            u.gifterId = null;
        });

        // Fisher-Yates shuffle
        const shuffled = [...allUsers];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Assign in a loop
        for (let i = 0; i < shuffled.length; i++) {
            const current = shuffled[i];
            const next = shuffled[(i + 1) % shuffled.length];

            // Update in main array
            const userIndex = allUsers.findIndex(u => u.id === current.id);
            allUsers[userIndex].recipientId = next.id;

            const recipientIndex = allUsers.findIndex(u => u.id === next.id);
            allUsers[recipientIndex].gifterId = current.id;
        }

        await batchUpdateUsers(allUsers);
        return NextResponse.json({ success: true, message: 'Assignments complete' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function GET() {
    // Require authentication to view users
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await getAllUsers();
    // Return list of users (names only) for selection
    return NextResponse.json(users.map(u => ({ name: u.name, id: u.id })));
}

