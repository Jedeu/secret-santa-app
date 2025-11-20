import { NextResponse } from 'next/server';
import { getDB, saveDB } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// DEVELOPMENT MODE ONLY - Simple auth bypass for testing
// This endpoint is used when NEXT_PUBLIC_BYPASS_AUTH=true

export async function POST(request) {
    const { name, action, userId, recipientName } = await request.json();
    const db = getDB();

    // Simple login - find or create user by name
    if (!action && name) {
        let user = db.users.find(u => u.name.toLowerCase() === name.toLowerCase());

        if (!user) {
            // Create new user
            user = {
                id: uuidv4(),
                name,
                email: `${name.toLowerCase()}@dev.test`, // Fake email for dev mode
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            db.users.push(user);

            // If recipient provided during signup, link them
            if (recipientName) {
                let recipient = db.users.find(u => u.name.toLowerCase() === recipientName.toLowerCase());
                if (!recipient) {
                    recipient = {
                        id: uuidv4(),
                        name: recipientName,
                        email: `${recipientName.toLowerCase()}@dev.test`,
                        oauthId: null,
                        image: null,
                        recipientId: null,
                        gifterId: null
                    };
                    db.users.push(recipient);
                }
                user.recipientId = recipient.id;
                recipient.gifterId = user.id;
            }

            saveDB(db);
        } else {
            // Ensure existing user has dev email for bypass to work
            if (!user.email || !user.email.endsWith('@dev.test')) {
                user.email = `${name.toLowerCase()}@dev.test`;
                saveDB(db);
            }
        }

        return NextResponse.json(user);
    }

    // Set recipient for existing user
    if (action === 'setRecipient') {
        const user = db.users.find(u => u.id === userId);
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (user.recipientId) {
            return NextResponse.json({
                error: 'Recipient already assigned'
            }, { status: 400 });
        }

        let recipient = db.users.find(u => u.name.toLowerCase() === recipientName.toLowerCase());
        if (!recipient) {
            recipient = {
                id: uuidv4(),
                name: recipientName,
                email: `${recipientName.toLowerCase()}@dev.test`,
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            db.users.push(recipient);
        }

        user.recipientId = recipient.id;
        recipient.gifterId = user.id;
        saveDB(db);

        return NextResponse.json({ success: true, user });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
