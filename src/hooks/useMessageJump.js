'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const HIGHLIGHT_MS = 1200;

/**
 * Scroll a message into view and briefly highlight it. Messages mark their element
 * with `data-message-id`; the lookup stays inside `containerRef`, so a jump never
 * reaches a message of another thread.
 */
export function useMessageJump() {
    const containerRef = useRef(null);
    const timerRef = useRef(null);
    const [highlightedId, setHighlightedId] = useState(null);

    useEffect(() => () => clearTimeout(timerRef.current), []);

    const jumpTo = useCallback((messageId) => {
        const container = containerRef.current;
        if (!container || typeof messageId !== 'string') return;
        const element = Array.from(container.querySelectorAll('[data-message-id]'))
            .find((node) => node.getAttribute('data-message-id') === messageId);
        if (!element) return;
        element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        setHighlightedId(messageId);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    }, []);

    return { containerRef, highlightedId, jumpTo };
}
