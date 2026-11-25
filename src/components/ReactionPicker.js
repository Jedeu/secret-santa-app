'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎄'];

const buttonStyle = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: 1,
    padding: '2px',
};

export default function ReactionPicker({ onSelect, onClose, onMore, onReply }) {
    const pickerRef = useRef(null);
    // Above the bubble by default; below it when the scrolling list would clip it (the top message).
    const [below, setBelow] = useState(false);

    useLayoutEffect(() => {
        const picker = pickerRef.current;
        let scroller = picker?.parentElement;
        while (scroller && getComputedStyle(scroller).overflowY === 'visible') {
            scroller = scroller.parentElement;
        }
        if (picker && scroller && picker.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
            setBelow(true);
        }
    }, []);

    useEffect(() => {
        const onPointerDown = (event) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target)) {
                onClose?.();
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
        };
    }, [onClose]);

    return (
        <div
            ref={pickerRef}
            style={{
                position: 'absolute',
                top: below ? 'calc(100% + 4px)' : '-40px',
                right: 0,
                background: 'var(--surface-highlight)',
                border: '1px solid var(--border)',
                borderRadius: '18px',
                padding: '4px 6px',
                display: 'flex',
                gap: '4px',
                zIndex: 50,
                boxShadow: 'var(--pop-shadow)',
            }}
        >
            {QUICK_REACTIONS.map((emoji) => (
                <button
                    key={emoji}
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onSelect?.(emoji);
                        onClose?.();
                    }}
                    aria-label={`React with ${emoji}`}
                    style={buttonStyle}
                >
                    {emoji}
                </button>
            ))}
            {onMore && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onMore();
                    }}
                    aria-label="More reactions"
                    title="More reactions"
                    style={{
                        ...buttonStyle,
                        width: '22px',
                        borderRadius: '50%',
                        background: 'var(--surface)',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                    }}
                >
                    +
                </button>
            )}
            {onReply && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onReply();
                        onClose?.();
                    }}
                    aria-label="Reply"
                    title="Reply"
                    style={{
                        ...buttonStyle,
                        borderLeft: '1px solid var(--border)',
                        color: 'var(--foreground)',
                        padding: '2px 2px 2px 8px',
                        marginLeft: '2px',
                    }}
                >
                    ↩
                </button>
            )}
        </div>
    );
}
