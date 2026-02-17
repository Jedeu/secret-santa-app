'use client';

import { useEffect, useRef } from 'react';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎄'];

export default function ReactionPicker({ onSelect, onClose }) {
    const pickerRef = useRef(null);

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
                top: '-40px',
                right: 0,
                background: 'var(--surface-highlight)',
                border: '1px solid var(--border)',
                borderRadius: '18px',
                padding: '4px 6px',
                display: 'flex',
                gap: '4px',
                zIndex: 50,
                boxShadow: '0 8px 16px rgba(0,0,0,0.25)',
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
                    style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '16px',
                        lineHeight: 1,
                        padding: '2px',
                    }}
                >
                    {emoji}
                </button>
            ))}
        </div>
    );
}
