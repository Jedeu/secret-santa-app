import { NextResponse } from 'next/server';
import { getMessages, sendMessage, getAllMessagesWithCache, getAllUsersWithCache, getUserMessages, getUserById, getUserByEmail } from '@/lib/firestore';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId'); // The user requesting messages

    if (!userId) {
        // Public feed: Return all messages but mask names for Secret Santa pairs
        // No authentication required for public feed viewing

        const allMessages = await getAllMessagesWithCache();
        // Note: We still need all users for the public feed to map message IDs to names
        // This is cached on the server side (5 second TTL)
        const allUsers = await getAllUsersWithCache();

        const publicMessages = allMessages.map(msg => {
            const fromUser = allUsers.find(u => u.id === msg.fromId);
            const toUser = allUsers.find(u => u.id === msg.toId);

            // Handle missing users
            if (!fromUser || !toUser) {
                return {
                    ...msg,
                    fromName: fromUser?.name || 'Unknown',
                    toName: toUser?.name || 'Unknown',
                    isSantaMsg: false
                };
            }

            // If it's a message from Santa to Recipient
            if (fromUser.recipientId === toUser.id) {
                return {
                    ...msg,
                    fromName: 'Secret Santa',
                    toName: toUser.name,
                    isSantaMsg: true
                };
            }
            // If it's a message from Recipient to Santa
            else if (toUser.recipientId === fromUser.id) {
                return {
                    ...msg,
                    fromName: fromUser.name,
                    toName: 'Secret Santa',
                    isSantaMsg: false
                };
            }

            // Fallback for messages that don't match the Santa pattern
            return {
                ...msg,
                fromName: 'Secret Santa',
                toName: toUser.name,
                isSantaMsg: true
            };
        });

        return NextResponse.json(publicMessages);
    }

    // User specific messages - require authentication
    // In dev mode, allow if user has dev email
    const session = await getServerSession(authOptions);
    const isDev = userId && (await getUserById(userId))?.email?.endsWith('@dev.test');

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify the user is requesting their own messages
    let authenticatedUser = null;
    if (session) {
        // Use getUserByEmail instead of getAllUsers for efficiency
        authenticatedUser = await getUserByEmail(session.user.email);
    } else {
        authenticatedUser = await getUserById(userId);
    }

    if (!authenticatedUser || authenticatedUser.id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get all messages for this user (sent or received)
    // Use efficient getUserMessages instead of getAllMessages + filter
    const userMessages = await getUserMessages(userId);

    return NextResponse.json(userMessages);
}

export async function POST(request) {
    // Require authentication to send messages
    const session = await getServerSession(authOptions);
    const { fromId, toId, content } = await request.json();

    const sender = await getUserById(fromId);
    const isDev = fromId && sender?.email?.endsWith('@dev.test');

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify the authenticated user is the sender
    let authenticatedUser = null;
    if (session) {
        // Use getUserByEmail instead of getAllUsers for efficiency
        authenticatedUser = await getUserByEmail(session.user.email);
    } else {
        authenticatedUser = sender;
    }

    if (!authenticatedUser || authenticatedUser.id !== fromId) {
        return NextResponse.json({ error: 'Forbidden: Can only send messages as yourself' }, { status: 403 });
    }

    // Verify the user is authorized to message this recipient
    if (toId !== authenticatedUser.recipientId && toId !== authenticatedUser.gifterId) {
        return NextResponse.json({ error: 'Forbidden: Can only message your recipient or Santa' }, { status: 403 });
    }

    const newMessage = {
        id: uuidv4(),
        fromId,
        toId,
        content,
        timestamp: new Date().toISOString(),
    };

    await sendMessage(newMessage);

    return NextResponse.json(newMessage);
}
