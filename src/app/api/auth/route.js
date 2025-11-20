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

        // Validate recipient is in the allowed list
        const ALLOWED_RECIPIENTS = [
            'Jed', 'Natalie', 'Chinh', 'Gaby',
            'Jana', 'Peter', 'Louis', 'Genevieve'
        ];

        // Case-insensitive check
        const normalizedRecipientName = ALLOWED_RECIPIENTS.find(
            name => name.toLowerCase() === recipientName.toLowerCase()
        );

        if (!normalizedRecipientName) {
            return NextResponse.json({
                error: 'Invalid recipient. Please select from the list.'
            }, { status: 400 });
        }

        // Find or create recipient
        const allUsers = await getAllUsers();
        let recipient = allUsers.find(u => u.name.toLowerCase() === recipientName.toLowerCase());

        if (recipient) {
            // Check if recipient is already taken (has a gifter)
            if (recipient.gifterId) {
                return NextResponse.json({
                    error: 'This recipient has already been selected by someone else.'
                }, { status: 400 });
            }
        } else {
            // Create placeholder recipient if they don't exist yet
            recipient = {
                id: uuidv4(),
                name: normalizedRecipientName, // Use the canonical casing
                email: null,
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            await createUser(recipient);
        }

        // Link them
        user.recipientId = recipient.id;
        recipient.gifterId = user.id;

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
    // Return list of users with gifterId so frontend can filter taken ones
    // Also return name and id
    return NextResponse.json(users.map(u => ({
        name: u.name,
        id: u.id,
        gifterId: u.gifterId // Expose this so we can disable/hide taken recipients
    })));
}

