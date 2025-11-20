import { NextResponse } from 'next/server';
import { getMessages, sendMessage, getAllMessages, getUserById, getAllUsers } from '@/lib/firestore';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId'); // The user requesting messages

    if (!userId) {
        // Public feed: Return all messages but mask names for Secret Santa pairs
        // No authentication required for public feed viewing

        const allMessages = await getAllMessages();
        const allUsers = await getAllUsers();

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
        // We can't rely on session.user.id being populated if it wasn't in the DB when session started (though it should be)
        // But let's fetch fresh from DB to be safe or trust session.
        // Actually session callback fetches from DB.
        // Let's fetch fresh to be sure.
        // Wait, session.user.email is reliable.
        const users = await getAllUsers(); // Optimization: could use getUserByEmail but we need to check ID match
        authenticatedUser = users.find(u => u.email === session.user.email);
    } else {
        authenticatedUser = await getUserById(userId);
    }

    if (!authenticatedUser || authenticatedUser.id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // We need messages where user is sender OR receiver.
    // getMessages(userId, otherId) gets conversation between two.
    // But here we want ALL messages for this user?
    // The original code: db.messages.filter(msg => msg.fromId === userId || msg.toId === userId)
    // This returns ALL messages involving the user.
    // Firestore: We need to query for (fromId == userId) and (toId == userId) separately and merge.

    // Wait, getMessages in firestore.js takes (userId, otherId).
    // I should add getUserMessages(userId) to firestore.js?
    // Or just use raw firestore calls here? Better to keep logic in firestore.js.
    // But I can't easily change firestore.js right now without another tool call.
    // Let's use getAllMessages and filter in memory for now (small scale).
    // It's 100-200 messages per year. In-memory filtering is totally fine.

    const allMessages = await getAllMessages();
    const userMessages = allMessages.filter(msg =>
        msg.fromId === userId || msg.toId === userId
    );

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
        const users = await getAllUsers();
        authenticatedUser = users.find(u => u.email === session.user.email);
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
