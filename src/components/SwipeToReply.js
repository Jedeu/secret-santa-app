'use client';

import { useRef } from 'react';

// Distances in px.
const START_SLOP = 10;       // finger travel before the gesture picks a direction
const REPLY_THRESHOLD = 56;  // pull needed to start a reply on release
const MAX_PULL = 72;
const EDGE_GUARD = 24;       // touches this close to the left edge belong to the OS back-swipe

/**
 * Touch-only swipe right to reply, like WhatsApp. `touch-action: pan-y` leaves vertical
 * scrolling to the browser (which cancels this gesture); a horizontal pull slides the
 * row and reveals a reply arrow. Mouse and pen input are ignored, and a swipe never
 * becomes a tap on the message.
 */
export default function SwipeToReply({ onReply, children }) {
    const contentRef = useRef(null);
    const iconRef = useRef(null);
    const gestureRef = useRef(null);
    const suppressClickRef = useRef(false);

    const setPull = (pull, animate) => {
        const content = contentRef.current;
        const icon = iconRef.current;
        if (content) {
            content.style.transition = animate ? 'transform 160ms ease-out' : 'none';
            content.style.transform = pull > 0 ? `translateX(${pull}px)` : '';
        }
        if (icon) {
            icon.style.transition = animate ? 'opacity 160ms ease-out' : 'none';
            icon.style.opacity = String(Math.min(pull / REPLY_THRESHOLD, 1));
        }
    };

    // Only the finger that started the gesture can end it; other touches are ignored.
    const end = (event, commit) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        if (!gesture.active) return;
        suppressClickRef.current = true;
        setPull(0, true);
        if (commit && gesture.armed) onReply?.();
    };

    const onPointerDown = (event) => {
        if (gestureRef.current) return;
        suppressClickRef.current = false;
        if (event.pointerType !== 'touch' || typeof onReply !== 'function') return;
        if (event.clientX < EDGE_GUARD) return;
        gestureRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            armed: false,
        };
    };

    const onPointerMove = (event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        if (!gesture.active) {
            if (Math.abs(dy) > START_SLOP && Math.abs(dy) >= Math.abs(dx)) {
                gestureRef.current = null;
                return;
            }
            if (dx <= START_SLOP || dx < Math.abs(dy) * 1.5) return;
            gesture.active = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        const pull = Math.min(Math.max(dx - START_SLOP, 0), MAX_PULL);
        setPull(pull, false);
        if (!gesture.armed && pull >= REPLY_THRESHOLD) {
            gesture.armed = true;
            navigator.vibrate?.(10);
        } else if (gesture.armed && pull < REPLY_THRESHOLD) {
            gesture.armed = false;
        }
    };

    return (
        <div
            data-testid="swipe-to-reply"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => end(event, true)}
            onPointerCancel={(event) => end(event, false)}
            onLostPointerCapture={(event) => end(event, false)}
            onClickCapture={(event) => {
                if (!suppressClickRef.current) return;
                suppressClickRef.current = false;
                event.stopPropagation();
                event.preventDefault();
            }}
            style={{ position: 'relative', touchAction: 'pan-y' }}
        >
            <span
                ref={iconRef}
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    left: '4px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'var(--surface-highlight)',
                    color: 'var(--foreground)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '15px',
                    opacity: 0,
                    pointerEvents: 'none'
                }}
            >
                ↩
            </span>
            <div ref={contentRef}>{children}</div>
        </div>
    );
}
