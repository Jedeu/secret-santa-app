'use client';

import { firestore } from '@/lib/firebase-client';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';

const TYPING_DEBOUNCE_MS = 2000;
const pendingTypingWrites = new Map(); // key -> timeout

function getTypingKey(userId, conversationId) {
    return `${conversationId}_${userId}`;
}

function logTypingDebug(action, userId, conversationId) {
    if (process.env.NODE_ENV !== 'development') {
        return;
    }

    console.debug(`[Typing] ${action} userId=${userId} convId=${conversationId}`);
}

export function setTyping(userId, conversationId) {
    if (!firestore || !userId || !conversationId) {
        return;
    }

    const key = getTypingKey(userId, conversationId);
    const existingTimeout = pendingTypingWrites.get(key);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
        try {
            const docRef = doc(firestore, 'typing', key);
            await setDoc(docRef, {
                userId,
                conversationId,
                typingAt: new Date().toISOString(),
            });
            logTypingDebug('set', userId, conversationId);
        } catch (error) {
            console.error('Failed to write typing state:', error);
        } finally {
            pendingTypingWrites.delete(key);
        }
    }, TYPING_DEBOUNCE_MS);

    pendingTypingWrites.set(key, timeout);
}

export function clearTyping(userId, conversationId) {
    if (!firestore || !userId || !conversationId) {
        return;
    }

    const key = getTypingKey(userId, conversationId);
    const existingTimeout = pendingTypingWrites.get(key);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingTypingWrites.delete(key);
    }

    const docRef = doc(firestore, 'typing', key);
    deleteDoc(docRef).catch((error) => {
        console.error('Failed to clear typing state:', error);
    });
    logTypingDebug('clear', userId, conversationId);
}
