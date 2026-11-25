'use client';

import { getMessagePreviewText } from '@/lib/message-media';

const UNAVAILABLE_TEXT = 'Original message unavailable';

/**
 * The quoted original shown at the top of a reply. `target` is looked up by the
 * caller within the current thread only, and `label` is that view's own sender
 * label for it, so a quote never reveals more than the view already shows.
 * A missing target renders as unavailable.
 */
export default function MessageQuote({ target, label, onJump, tone = 'other' }) {
    const preview = target ? getMessagePreviewText(target).trim() : '';
    const isOwnTone = tone === 'own';
    const canJump = !!target && typeof onJump === 'function';

    return (
        <button
            type="button"
            data-testid="message-quote"
            disabled={!canJump}
            aria-label={target ? `Replying to ${label}. Show original message` : UNAVAILABLE_TEXT}
            onClick={(event) => {
                event.stopPropagation();
                if (canJump) onJump(target.id);
            }}
            style={{
                display: 'block',
                width: '100%',
                minWidth: '120px',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                background: isOwnTone ? 'var(--quote-own-bg)' : 'var(--quote-bg)',
                border: 'none',
                borderLeft: `3px solid ${isOwnTone ? 'var(--quote-own-bar)' : 'var(--quote-bar)'}`,
                borderRadius: '6px',
                padding: '4px 8px',
                marginBottom: '6px',
                cursor: canJump ? 'pointer' : 'default'
            }}
        >
            {target && (
                <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, opacity: 0.9 }}>
                    {label}
                </span>
            )}
            <span style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                fontSize: '12px',
                opacity: target ? 0.85 : 0.7,
                fontStyle: target ? 'normal' : 'italic',
                wordBreak: 'break-word'
            }}>
                {target ? preview : UNAVAILABLE_TEXT}
            </span>
        </button>
    );
}
