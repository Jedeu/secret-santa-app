'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/lib/firebase-client';

const TYPING_ACTIVE_WINDOW_MS = 5000;
const TYPING_TICK_MS = 1000;

function isTypingRecently(typingAt, nowMs) {
    if (!typingAt) {
        return false;
    }

    const typingMs = Date.parse(typingAt);
    if (Number.isNaN(typingMs)) {
        return false;
    }

    return nowMs - typingMs < TYPING_ACTIVE_WINDOW_MS;
}

export function useTypingIndicator(conversationId, otherUserId) {
    const [typingAt, setTypingAt] = useState(null);
    const [nowTick, setNowTick] = useState(Date.now());

    useEffect(() => {
        if (!firestore || !conversationId || !otherUserId) {
            setTypingAt(null);
            return undefined;
        }

        const typingDocId = `${conversationId}_${otherUserId}`;
        const docRef = doc(firestore, 'typing', typingDocId);

        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            if (!snapshot.exists()) {
                setTypingAt(null);
                return;
            }

            const raw = snapshot.data()?.typingAt;
            setTypingAt(typeof raw === 'string' ? raw : null);
        }, (error) => {
            console.error('Failed to subscribe typing indicator:', error);
        });

        return () => unsubscribe();
    }, [conversationId, otherUserId]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNowTick(Date.now());
        }, TYPING_TICK_MS);

        return () => clearInterval(intervalId);
    }, []);

    return isTypingRecently(typingAt, nowTick);
}
