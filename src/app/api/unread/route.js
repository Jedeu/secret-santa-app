import { NextResponse } from 'next/server';
import { getMessages, markAsRead, getLastRead, getUserById, getUserByEmail, getUnreadCount } from '@/lib/firestore';
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

    // Check if this is a dev mode request
    const isDev = devUserId && (await getUserById(devUserId))?.email?.endsWith('@dev.test');

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let user = null;
    if (session) {
        // Use getUserByEmail instead of getAllUsers for efficiency
        user = await getUserByEmail(session.user.email);
    } else {
        user = await getUserById(devUserId);
    }

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Calculate unread counts for recipient and santa conversations
    const unreadCounts = {};

    if (user.recipientId) {
        const recipientConvId = getConversationId(user.id, user.recipientId);
        const lastRead = await getLastRead(user.id, recipientConvId);
        const lastReadAt = lastRead?.lastReadAt || new Date(0).toISOString();

        // Efficiently count unread messages
        unreadCounts.recipient = await getUnreadCount(user.id, user.recipientId, lastReadAt);
    }

    if (user.gifterId) {
        const santaConvId = getConversationId(user.id, user.gifterId);
        const lastRead = await getLastRead(user.id, santaConvId);
        const lastReadAt = lastRead?.lastReadAt || new Date(0).toISOString();

        // Efficiently count unread messages
        unreadCounts.santa = await getUnreadCount(user.id, user.gifterId, lastReadAt);
    }

    return NextResponse.json(unreadCounts);
}

export async function POST(request) {
    // Mark conversation as read
    const session = await getServerSession(authOptions);
    const { otherUserId, userId } = await request.json();

    // Check if this is a dev mode request
    const isDev = userId && (await getUserById(userId))?.email?.endsWith('@dev.test');

    if (!session && !isDev) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let user = null;
    if (session) {
        // Use getUserByEmail instead of getAllUsers for efficiency
        user = await getUserByEmail(session.user.email);
    } else {
        user = await getUserById(userId);
    }

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const conversationId = getConversationId(user.id, otherUserId);

    await markAsRead(user.id, conversationId);

    return NextResponse.json({ success: true });
}
