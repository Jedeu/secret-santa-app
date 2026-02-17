'use client';

import { useEffect, useRef } from 'react';

const DEDUP_WINDOW_MS = 1000;

function detectStandaloneMode() {
    if (typeof window === 'undefined') return false;
    const mediaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
    const iosStandalone = window.navigator?.standalone === true;
    return Boolean(mediaStandalone || iosStandalone);
}

function logSoundDebug(event, details = {}) {
    if (process.env.NODE_ENV !== 'development') {
        return;
    }

    const serialized = Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
    console.debug(`[Sound] ${event}${serialized ? ` ${serialized}` : ''}`);
}

function getMessageIdentity(message) {
    if (message?.id) {
        return message.id;
    }

    return `${message?.fromId || 'unknown'}:${message?.toId || 'unknown'}:${message?.timestamp || 'unknown'}`;
}

export default function NotificationSoundRuntime({
    soundEnabled,
    currentUserId,
    allMessages = [],
    allMessagesLoading = false,
}) {
    const isHydratedRef = useRef(false);
    const prevMessagesRef = useRef([]);
    const lastChimeTimeRef = useRef(0);
    const previousLoadingRef = useRef(allMessagesLoading);

    useEffect(() => {
        if (!currentUserId) {
            isHydratedRef.current = false;
            prevMessagesRef.current = [];
            previousLoadingRef.current = allMessagesLoading;
            return;
        }

        const loadingFinished = previousLoadingRef.current && !allMessagesLoading;
        previousLoadingRef.current = allMessagesLoading;

        if (!isHydratedRef.current && loadingFinished) {
            prevMessagesRef.current = allMessages;
            isHydratedRef.current = true;
            logSoundDebug('suppressed', { reason: 'initial-hydration' });
            return;
        }

        if (!isHydratedRef.current) {
            return;
        }

        const previousIds = new Set(prevMessagesRef.current.map(getMessageIdentity));
        const newMessages = allMessages.filter((message) => !previousIds.has(getMessageIdentity(message)));
        prevMessagesRef.current = allMessages;

        if (!newMessages.length) {
            return;
        }

        const incomingToCurrentUser = newMessages.some((message) => (
            message?.toId === currentUserId && message?.fromId !== currentUserId
        ));

        if (!incomingToCurrentUser) {
            logSoundDebug('suppressed', { reason: 'not-current-user' });
            return;
        }

        if (!soundEnabled) {
            logSoundDebug('suppressed', { reason: 'muted' });
            return;
        }

        if (!detectStandaloneMode()) {
            logSoundDebug('suppressed', { reason: 'not-standalone' });
            return;
        }

        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            logSoundDebug('suppressed', { reason: 'hidden' });
            return;
        }

        const now = Date.now();
        if (now - lastChimeTimeRef.current < DEDUP_WINDOW_MS) {
            logSoundDebug('suppressed', { reason: 'dedup-window' });
            return;
        }

        lastChimeTimeRef.current = now;

        if (typeof Audio !== 'function') {
            logSoundDebug('suppressed', { reason: 'audio-unsupported' });
            return;
        }

        const audio = new Audio('/sounds/notification.wav');
        audio.play()
            .then(() => {
                logSoundDebug('played', { count: newMessages.length });
            })
            .catch((error) => {
                logSoundDebug('suppressed', { reason: 'play-failed', error: error?.message || 'unknown' });
            });
    }, [allMessages, allMessagesLoading, currentUserId, soundEnabled]);

    return null;
}
