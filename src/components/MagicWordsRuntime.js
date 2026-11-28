'use client';

import { useEffect, useRef, useState } from 'react';
import { findMagicEffects, triggerEasterEgg } from '@/lib/easter-eggs';
import { getMessageGif } from '@/lib/giphy-reference';
import { getCachedTimestamp, getRemoteTimestamp } from '@/lib/lastReadClient';

const JINGLE_URL = '/sounds/jingle.wav';

function getIdentity(message) {
    return message?.id || `${message?.fromId || ''}:${message?.toId || ''}:${message?.timestamp || ''}`;
}

function getText(message) {
    const gif = getMessageGif(message);
    return gif ? gif.caption : message?.content;
}

function laterIso(a, b) {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Magic words in the open chat: "let it snow" (snow), "ho ho ho" (jingle) and
 * "merry christmas" (confetti). They fire for messages that arrive while this chat is open,
 * from either person, and once on opening a chat for the viewer's unread ones.
 *
 * The chat's list becomes the baseline once the server has confirmed it (`loading` stays
 * true until then, so history the cache lacked is never taken for live). At that point the
 * messages sent to the viewer that are newer than their read marker replay, each effect at
 * most once. The marker is the one this device held when the chat opened, read during
 * render before Chat's mount effect advances it, raised by what Firestore reported for it;
 * while neither is known (a cold start before the marker loads) nothing replays. Each
 * message fires at most once per session, so reopening a chat stays quiet.
 * The Public Feed and archives pass no chat.
 *
 * @param {Object} props
 * @param {string|null} props.chatKey - The open chat's conversation id; null for any other view
 * @param {string|null} props.viewerId - The signed-in participant's id
 * @param {Object[]} props.messages - That chat's messages
 * @param {boolean} props.loading - True until the messages listener is loaded and server-confirmed
 * @param {boolean} props.soundOn - Sound on and push on: the jingle plays only then
 */
export default function MagicWordsRuntime({ chatKey, viewerId, messages, loading, soundOn }) {
    const baselineRef = useRef({ key: null, ids: new Set() });
    const firedRef = useRef(new Set());
    const [opened, setOpened] = useState({ key: null, marker: undefined });
    if (opened.key !== chatKey) {
        // Conditional update during render, as in Chat: captured before any effect runs.
        setOpened({ key: chatKey, marker: chatKey && viewerId ? getCachedTimestamp(viewerId, chatKey) : undefined });
    }
    const openedMarker = opened.key === chatKey ? opened.marker : undefined;

    useEffect(() => {
        const baseline = baselineRef.current;
        if (!chatKey || loading) {
            baseline.key = null;
            baseline.ids = new Set();
            return;
        }

        const matched = [];
        if (baseline.key !== chatKey) {
            baseline.key = chatKey;
            baseline.ids = new Set(messages.map(getIdentity));
            const marker = laterIso(openedMarker, viewerId ? getRemoteTimestamp(viewerId, chatKey) : undefined);
            if (marker === undefined) return;
            const markerMs = Date.parse(marker);
            for (const message of messages) {
                if (message.toId !== viewerId || message.fromId === viewerId) continue;
                if (!(new Date(message.timestamp).getTime() > markerMs)) continue;
                matched.push(message);
            }
        } else {
            for (const message of messages) {
                const id = getIdentity(message);
                if (baseline.ids.has(id)) continue;
                baseline.ids.add(id);
                matched.push(message);
            }
        }

        const effects = new Set();
        const ids = [];
        for (const message of matched) {
            const id = getIdentity(message);
            if (firedRef.current.has(id)) continue;
            const found = findMagicEffects(getText(message));
            if (!found.length) continue;
            ids.push(id);
            found.forEach((effect) => effects.add(effect));
        }
        if (!effects.size || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
        ids.forEach((id) => firedRef.current.add(id));

        for (const effect of effects) {
            if (effect === 'jingle') {
                if (soundOn && typeof Audio === 'function') {
                    new Audio(JINGLE_URL).play().catch(() => { });
                }
                continue;
            }
            triggerEasterEgg(effect);
        }
    }, [chatKey, viewerId, openedMarker, messages, loading, soundOn]);

    return null;
}
