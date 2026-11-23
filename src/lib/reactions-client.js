'use client';

import { firestore } from '@/lib/firebase-client';
import { deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { getWritableScope, scopedDocRef } from '@/lib/year-client';

const UNAVAILABLE_MESSAGE = 'Reactions are unavailable right now';

// Mirrors firestore.rules: 1-16 UTF-16 units and no ASCII except the keycap characters # * 0-9.
const MAX_EMOJI_LENGTH = 16;
const FORBIDDEN_ASCII = /[\x00-\x22\x24-\x29\x2B-\x2F\x3A-\x7F]/;
const EMOJI_MARKER = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

// True for exactly one emoji (one grapheme), including skin-tone, flag and ZWJ sequences.
export function isReactionEmoji(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EMOJI_LENGTH) {
        return false;
    }
    if (FORBIDDEN_ASCII.test(value) || !EMOJI_MARKER.test(value)) {
        return false;
    }
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value);
        return Array.from(graphemes).length === 1;
    }
    return true;
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
