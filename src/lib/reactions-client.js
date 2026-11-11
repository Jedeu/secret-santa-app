'use client';

import { firestore } from '@/lib/firebase-client';
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { getWritableScope, scopedDocRef } from '@/lib/year-client';

const UNAVAILABLE_MESSAGE = 'Reactions are unavailable right now';

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

    // Capture the writable scope when the toggle is requested; refs come only from it.
    const scope = getWritableScope();
    if (!scope) {
        throw new Error(UNAVAILABLE_MESSAGE);
    }

    const reactionId = reactionDocId(messageId, userId, emoji);
    const reactionRef = scopedDocRef(scope, 'reactions', reactionId);
    const existing = await getDoc(reactionRef);

    if (getWritableScope() !== scope) {
        throw new Error(UNAVAILABLE_MESSAGE);
    }

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
