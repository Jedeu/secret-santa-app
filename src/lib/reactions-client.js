'use client';

import { firestore } from '@/lib/firebase-client';
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { getWritableScope, scopedDocRef } from '@/lib/year-client';

const UNAVAILABLE_MESSAGE = 'Reactions are unavailable right now';

// firestore.rules allows 1-16 UTF-16 units (the longest emoji is 15).
const MAX_EMOJI_LENGTH = 16;
// One pictograph (a lone flag letter is not one) with optional variation selector, skin tone
// and subdivision-flag tags.
const EMOJI_PART = '(?!\\p{Regional_Indicator})(?:\\p{Extended_Pictographic}|\\p{Emoji_Presentation})(?:\\uFE0F|\\p{Emoji_Modifier})*(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?';
// A keycap, a flag, or pictographs joined by ZWJ.
const SINGLE_EMOJI = new RegExp(
    `^(?:[#*0-9]\\uFE0F?\\u20E3|\\p{Regional_Indicator}{2}|${EMOJI_PART}(?:\\u200D${EMOJI_PART})*)$`,
    'u'
);

// True for exactly one emoji, including skin-tone, flag, keycap and ZWJ sequences.
export function isReactionEmoji(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_EMOJI_LENGTH
        && SINGLE_EMOJI.test(value);
}

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
    if (!firestore || !messageId || !userId || !isReactionEmoji(emoji)) {
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
