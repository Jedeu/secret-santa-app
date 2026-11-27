'use client';

import { useEffect, useRef } from 'react';
import { findMagicEffects, triggerEasterEgg } from '@/lib/easter-eggs';
import { getMessageGif } from '@/lib/giphy-reference';

// A message counts as live only while it is this fresh, so a late server snapshot that fills
// in older history never fires an effect.
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const JINGLE_URL = '/sounds/jingle.wav';

function getIdentity(message) {
    return message?.id || `${message?.fromId || ''}:${message?.toId || ''}:${message?.timestamp || ''}`;
}

function getText(message) {
    const gif = getMessageGif(message);
    return gif ? gif.caption : message?.content;
}

function isLive(message, now) {
    const at = Date.parse(message?.timestamp);
    return Number.isFinite(at) && now - at < LIVE_WINDOW_MS;
}

/**
 * Magic words in the open chat: "let it snow" (snow), "ho ho ho" (jingle) and
 * "merry christmas" (confetti). Only messages that arrive while this chat is open fire an
 * effect, from either person: the first loaded list of a chat is a silent baseline, so loading,
 * opening or switching chats never does. The Public Feed and archives pass no chat.
 *
 * @param {Object} props
 * @param {string|null} props.chatKey - The open chat's conversation id; null for any other view
 * @param {Object[]} props.messages - That chat's messages
 * @param {boolean} props.loading - True while the messages listener has not loaded
 * @param {boolean} props.soundOn - Sound on and push on: the jingle plays only then
 */
export default function MagicWordsRuntime({ chatKey, messages, loading, soundOn }) {
    const baselineRef = useRef({ key: null, ids: new Set() });

    useEffect(() => {
        const baseline = baselineRef.current;
        if (!chatKey || loading) {
            baseline.key = null;
            baseline.ids = new Set();
            return;
        }
        if (baseline.key !== chatKey) {
            baseline.key = chatKey;
            baseline.ids = new Set(messages.map(getIdentity));
            return;
        }

        const now = Date.now();
        const effects = new Set();
        for (const message of messages) {
            const id = getIdentity(message);
            if (baseline.ids.has(id)) continue;
            baseline.ids.add(id);
            if (!isLive(message, now)) continue;
            findMagicEffects(getText(message)).forEach((effect) => effects.add(effect));
        }
        if (!effects.size || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;

        for (const effect of effects) {
            if (effect === 'jingle') {
                if (soundOn && typeof Audio === 'function') {
                    new Audio(JINGLE_URL).play().catch(() => { });
                }
                continue;
            }
            triggerEasterEgg(effect);
        }
    }, [chatKey, messages, loading, soundOn]);

    return null;
}
