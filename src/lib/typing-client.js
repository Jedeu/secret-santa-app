'use client';

import { firestore } from '@/lib/firebase-client';
import { deleteDoc, setDoc } from 'firebase/firestore';
import { getWritableScope, scopedDocRef } from '@/lib/year-client';

const TYPING_THROTTLE_MS = 2000;
const pendingTypingWrites = new Map(); // key -> timeout (trailing write)
const lastWriteAt = new Map(); // key -> ms timestamp of last write

function getTypingKey(userId, conversationId) {
    return `${conversationId}_${userId}`;
}

function logTypingDebug(action, userId, conversationId) {
    if (process.env.NODE_ENV !== 'development') {
        return;
    }

    console.debug(`[Typing] ${action} userId=${userId} convId=${conversationId}`);
}

// async so both sync throws and setDoc rejections land in the catch;
// callers fire-and-forget, the returned promise never rejects.
// `scope` is the writable scope captured when the keystroke was requested; nothing is
// written once it is no longer the current scope.
async function writeTyping(scope, key, userId, conversationId) {
    if (getWritableScope() !== scope) {
        return;
    }
    lastWriteAt.set(key, Date.now());
    try {
        const docRef = scopedDocRef(scope, 'typing', key);
        await setDoc(docRef, {
            userId,
            conversationId,
            typingAt: new Date().toISOString(),
        });
        logTypingDebug('set', userId, conversationId);
    } catch (error) {
        console.error('Failed to write typing state:', error);
    }
}

// Leading-edge throttle: the first keystroke writes immediately so the indicator
// appears while the sender types (not after they stop). Subsequent keystrokes
// within the window schedule at most one trailing write to keep `typingAt` fresh
// during long runs, so cost stays <= 1 write per TYPING_THROTTLE_MS.
export function setTyping(userId, conversationId) {
    if (!firestore || !userId || !conversationId) {
        return;
    }

    const scope = getWritableScope();
    if (!scope) {
        return;
    }

    const key = getTypingKey(userId, conversationId);
    const now = Date.now();
    const previousWriteAt = lastWriteAt.get(key) ?? 0;
    const elapsed = now - previousWriteAt;

    if (elapsed >= TYPING_THROTTLE_MS) {
        writeTyping(scope, key, userId, conversationId);
        return;
    }

    // Within the throttle window: schedule a single trailing write if none pending.
    if (pendingTypingWrites.has(key)) {
        return;
    }

    const delay = previousWriteAt + TYPING_THROTTLE_MS - now;
    const timeout = setTimeout(() => {
        pendingTypingWrites.delete(key);
        writeTyping(scope, key, userId, conversationId);
    }, delay);

    pendingTypingWrites.set(key, timeout);
}

export function clearTyping(userId, conversationId) {
    if (!firestore || !userId || !conversationId) {
        return;
    }

    const scope = getWritableScope();
    const key = getTypingKey(userId, conversationId);
    const existingTimeout = pendingTypingWrites.get(key);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingTypingWrites.delete(key);
    }
    lastWriteAt.delete(key);

    if (!scope) {
        return;
    }

    const docRef = scopedDocRef(scope, 'typing', key);
    deleteDoc(docRef).catch((error) => {
        console.error('Failed to clear typing state:', error);
    });
    logTypingDebug('clear', userId, conversationId);
}

/**
 * Drop all local typing state (session change): cancels every trailing write.
 */
export function resetTypingState() {
    pendingTypingWrites.forEach((timeout) => clearTimeout(timeout));
    pendingTypingWrites.clear();
    lastWriteAt.clear();
}
