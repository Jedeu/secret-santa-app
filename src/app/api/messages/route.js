import { NextResponse } from 'next/server';
import { getDB, saveDB } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId'); // The user requesting messages
    const db = getDB();

    if (!userId) {
        // Public feed: Return all messages but mask names for Secret Santa pairs
        // No authentication required for public feed viewing

        const publicMessages = db.messages.map(msg => {
            const fromUser = db.users.find(u => u.id === msg.fromId);
            const toUser = db.users.find(u => u.id === msg.toId);

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
    const isDev = userId && db.users.find(u => u.id === userId && u.email?.endsWith('@dev.test'));

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify the user is requesting their own messages
    const authenticatedUser = session
        ? db.users.find(u => u.email === session.user.email)
        : db.users.find(u => u.id === userId);

    if (!authenticatedUser || authenticatedUser.id !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userMessages = db.messages.filter(msg =>
        msg.fromId === userId || msg.toId === userId
    );

    return NextResponse.json(userMessages);
}

export async function POST(request) {
    // Require authentication to send messages
    // In dev mode, allow if fromId has dev email
    const session = await getServerSession(authOptions);
    const { fromId, toId, content } = await request.json();
    const db = getDB();

    const isDev = fromId && db.users.find(u => u.id === fromId && u.email?.endsWith('@dev.test'));

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify the authenticated user is the sender
    const authenticatedUser = session
        ? db.users.find(u => u.email === session.user.email)
        : db.users.find(u => u.id === fromId);

    if (!authenticatedUser || authenticatedUser.id !== fromId) {
        return NextResponse.json({ error: 'Forbidden: Can only send messages as yourself' }, { status: 403 });
    }

    // Verify the user is authorized to message this recipient
    // They can message their recipient OR their gifter
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

    db.messages.push(newMessage);
    saveDB(db);

    return NextResponse.json(newMessage);
}
