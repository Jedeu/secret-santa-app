'use client';

import { firestore } from '@/lib/firebase-client';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

function reactionDocId(messageId, userId, emoji) {
    return `${messageId}_${userId}_${emoji}`;
}

function logReactionDebug(action, messageId, emoji) {
    if (process.env.NODE_ENV !== 'development') {
        return;
    }

    console.debug(`[Reaction] ${action} msgId=${messageId} emoji=${emoji}`);
}

export async function toggleReaction(messageId, userId, emoji) {
    if (!firestore || !messageId || !userId || !emoji) {
        throw new Error('Invalid reaction payload');
    }

    const reactionId = reactionDocId(messageId, userId, emoji);
    const reactionRef = doc(firestore, 'reactions', reactionId);
    const existing = await getDoc(reactionRef);

    if (existing.exists()) {
        await deleteDoc(reactionRef);
        logReactionDebug('removed', messageId, emoji);
        return { action: 'removed' };
    }

    await setDoc(reactionRef, {
        messageId,
        userId,
        emoji,
        createdAt: new Date().toISOString(),
    });
    logReactionDebug('added', messageId, emoji);
    return { action: 'added' };
}
