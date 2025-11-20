import { NextResponse } from 'next/server';
import { getDB, saveDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

export async function POST(request) {
    const { action, recipientName } = await request.json();
    const db = getDB();

    // Get authenticated session
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the authenticated user in database
    const user = db.users.find(u => u.email === session.user.email);
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
        let recipient = db.users.find(u => u.name.toLowerCase() === recipientName.toLowerCase());

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
            db.users.push(recipient);
        }

        // Link them
        user.recipientId = recipient.id;
        recipient.gifterId = user.id;

        saveDB(db);
        return NextResponse.json({ success: true, user });
    }

    if (action === 'assign') {
        // Re-assign EVERYONE to ensure a clean loop
        // This is an admin action - in production you'd want to restrict this
        if (db.users.length < 2) {
            return NextResponse.json({ error: 'Not enough users to assign' }, { status: 400 });
        }

        // Clear existing assignments first
        db.users.forEach(u => {
            u.recipientId = null;
            u.gifterId = null;
        });

        // Fisher-Yates shuffle
        const shuffled = [...db.users];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Assign in a loop
        for (let i = 0; i < shuffled.length; i++) {
            const current = shuffled[i];
            const next = shuffled[(i + 1) % shuffled.length];

            // Update in main db array
            const userIndex = db.users.findIndex(u => u.id === current.id);
            db.users[userIndex].recipientId = next.id;

            const recipientIndex = db.users.findIndex(u => u.id === next.id);
            db.users[recipientIndex].gifterId = current.id;
        }

        saveDB(db);
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

    const db = getDB();
    // Return list of users (names only) for selection
    return NextResponse.json(db.users.map(u => ({ name: u.name, id: u.id })));
}

