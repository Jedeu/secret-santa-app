import { NextResponse } from 'next/server';
import { getUserByEmail, createUser, getAllUsers, batchUpdateUsers, getUserById } from '@/lib/firestore';
import { v4 as uuidv4 } from 'uuid';

// DEVELOPMENT MODE ONLY - Simple auth bypass for testing
// This endpoint is used when NEXT_PUBLIC_BYPASS_AUTH=true

export async function POST(request) {
    const { name, action, userId, recipientName } = await request.json();

    // Simple login - find or create user by name
    if (!action && name) {
        // In dev mode, we use name + @dev.test as email
        const email = `${name.toLowerCase()}@dev.test`;
        let user = await getUserByEmail(email);

        if (!user) {
            // Create new user
            user = {
                id: uuidv4(),
                name,
                email,
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            await createUser(user);

            // If recipient provided during signup, link them
            if (recipientName) {
                const recipientEmail = `${recipientName.toLowerCase()}@dev.test`;
                let recipient = await getUserByEmail(recipientEmail);

                if (!recipient) {
                    recipient = {
                        id: uuidv4(),
                        name: recipientName,
                        email: recipientEmail,
                        oauthId: null,
                        image: null,
                        recipientId: null,
                        gifterId: null
                    };
                    await createUser(recipient);
                }

                user.recipientId = recipient.id;
                recipient.gifterId = user.id;

                await batchUpdateUsers([user, recipient]);
            }
        } else {
            // Ensure existing user has dev email for bypass to work (should already be true if found by email)
            if (!user.email || !user.email.endsWith('@dev.test')) {
                // This case shouldn't happen if we search by email, but just in case
                // We can't easily update email if it's the key, but here we assume it's fine.
            }
        }

        return NextResponse.json(user);
    }

    // Set recipient for existing user
    if (action === 'setRecipient') {
        const user = await getUserById(userId);
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (user.recipientId) {
            return NextResponse.json({
                error: 'Recipient already assigned'
            }, { status: 400 });
        }

        const recipientEmail = `${recipientName.toLowerCase()}@dev.test`;
        let recipient = await getUserByEmail(recipientEmail);

        if (!recipient) {
            recipient = {
                id: uuidv4(),
                name: recipientName,
                email: recipientEmail,
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            await createUser(recipient);
        }

        user.recipientId = recipient.id;
        recipient.gifterId = user.id;

        await batchUpdateUsers([user, recipient]);

        return NextResponse.json({ success: true, user });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
