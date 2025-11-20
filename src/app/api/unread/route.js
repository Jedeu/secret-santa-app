import { NextResponse } from 'next/server';
import { getDB, saveDB } from '@/lib/db';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

// Helper to create conversation ID (sorted to ensure consistency)
function getConversationId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

export async function GET(request) {
    // Get authenticated session or check for dev user
    const { searchParams } = new URL(request.url);
    const devUserId = searchParams.get('userId'); // For dev mode

    const session = await getServerSession(authOptions);
    const db = getDB();

    // Check if this is a dev mode request
    const isDev = devUserId && db.users.find(u => u.id === devUserId && u.email?.endsWith('@dev.test'));

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session
        ? db.users.find(u => u.email === session.user.email)
        : db.users.find(u => u.id === devUserId);

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Calculate unread counts for recipient and santa conversations
    const unreadCounts = {};

    if (user.recipientId) {
        const recipientConvId = getConversationId(user.id, user.recipientId);
        const lastRead = db.lastRead?.find(lr =>
            lr.userId === user.id && lr.conversationId === recipientConvId
        );
        const lastReadAt = lastRead?.lastReadAt || new Date(0).toISOString();

        const unreadMessages = db.messages.filter(msg =>
            msg.fromId === user.recipientId &&
            msg.toId === user.id &&
            msg.timestamp > lastReadAt
        );
        unreadCounts.recipient = unreadMessages.length;
    }

    if (user.gifterId) {
        const santaConvId = getConversationId(user.id, user.gifterId);
        const lastRead = db.lastRead?.find(lr =>
            lr.userId === user.id && lr.conversationId === santaConvId
        );
        const lastReadAt = lastRead?.lastReadAt || new Date(0).toISOString();

        const unreadMessages = db.messages.filter(msg =>
            msg.fromId === user.gifterId &&
            msg.toId === user.id &&
            msg.timestamp > lastReadAt
        );
        unreadCounts.santa = unreadMessages.length;
    }

    return NextResponse.json(unreadCounts);
}

export async function POST(request) {
    // Mark conversation as read
    const session = await getServerSession(authOptions);
    const { otherUserId, userId } = await request.json();
    const db = getDB();

    // Check if this is a dev mode request
    const isDev = userId && db.users.find(u => u.id === userId && u.email?.endsWith('@dev.test'));

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session
        ? db.users.find(u => u.email === session.user.email)
        : db.users.find(u => u.id === userId);
    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const conversationId = getConversationId(user.id, otherUserId);

    // Initialize lastRead array if it doesn't exist (for existing databases)
    if (!db.lastRead) {
        db.lastRead = [];
    }

    // Find or create lastRead entry
    let lastReadEntry = db.lastRead.find(lr =>
        lr.userId === user.id && lr.conversationId === conversationId
    );

    if (lastReadEntry) {
        lastReadEntry.lastReadAt = new Date().toISOString();
    } else {
        db.lastRead.push({
            userId: user.id,
            conversationId,
            lastReadAt: new Date().toISOString()
        });
    }

    saveDB(db);
    return NextResponse.json({ success: true });
}
