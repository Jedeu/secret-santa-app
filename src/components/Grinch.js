'use client';

import { useEffect, useRef } from 'react';

/**
 * 'grinch': he runs in from the right, grabs the tab bar (mobile `.tab-nav`, desktop
 * `.sidebar-nav`), carries it off to the left, brings it back about 2 s later and runs off.
 *
 * Both he and the bar move with the Web Animations API and no fill, so the bar's own styles are
 * never written: cancelling (unmount, or the effect ending) leaves it exactly as it was.
 * With `still` (prefers-reduced-motion) he only peeks in beside the bar, which stays put.
 */

const RUN_MS = 6400;
const PEEK_MS = 1800;
const SIZE = 72; // rendered width; the drawing is 80×96

/** The visible tab bar to steal: the mobile tabs, else the desktop chat list. */
function findTabBar() {
    for (const selector of ['.tab-nav', '.sidebar-nav']) {
        const el = document.querySelector(selector);
        if (el && el.getClientRects().length > 0) return el;
    }
    return null;
}

// The bar's visible extent: its items' union (the desktop list stretches far below its items).
function visibleRect(bar) {
    const rect = bar.getBoundingClientRect();
    const items = Array.from(bar.children, (child) => child.getBoundingClientRect()).filter((r) => r.height > 0);
    if (items.length === 0) return rect;
    const bottom = Math.max(...items.map((r) => r.bottom));
    return { left: rect.left, right: rect.right, width: rect.width, top: rect.top, bottom };
}

/**
 * Keyframes for one run, in px, from the bar's rect and the viewport width. Exported for tests.
 * The Grinch's x is his left edge; `away` is how far left the bar travels to leave the screen.
 */
export function grinchKeyframes(rect, viewportWidth, size = SIZE) {
    const grab = Math.round(rect.left + rect.width / 2 - size / 2);
    const away = Math.round(rect.right + size + 24);
    const frame = (transform, offset, easing) => ({ transform, offset, ...(easing ? { easing } : {}) });
    const g = (x, y, face, offset, easing) => frame(`translate(${x}px, ${y}px) scaleX(${face})`, offset, easing);
    const b = (x, y, r, offset, easing) => frame(`translate(${x}px, ${y}px) rotate(${r}deg)`, offset, easing);
    return {
        // In (0–0.13), grab and lift (–0.22), carry it off left (–0.42), away about 2 s
        // (–0.62), bring it back (–0.8), drop it, then run off (–1).
        grinch: [
            g(viewportWidth + 12, 0, 1, 0),
            g(grab, 0, 1, 0.13),
            g(grab, -6, 1, 0.18),
            g(grab, -6, 1, 0.22, 'ease-in'),
            g(grab - away, -6, 1, 0.42),
            g(grab - away, -6, -1, 0.62, 'ease-out'),
            g(grab, -6, -1, 0.8),
            g(grab, 0, -1, 0.84),
            g(grab, 0, 1, 0.86),
            g(grab - away, 0, 1, 1),
        ],
        bar: [
            b(0, 0, 0, 0),
            b(0, 0, 0, 0.18),
            b(0, -6, -1.5, 0.22, 'ease-in'),
            b(-away, -6, -1.5, 0.42),
            b(-away, -6, 1.5, 0.62, 'ease-out'),
            b(0, -6, 1.5, 0.8),
            b(0, 0, 0, 0.84),
            b(0, 0, 0, 1),
        ],
    };
}

export default function Grinch({ still = false, onDone }) {
    const ref = useRef(null);

    useEffect(() => {
        const grinch = ref.current;
        const bar = findTabBar();
        if (!grinch || !bar || typeof grinch.animate !== 'function') {
            onDone?.();
            return undefined;
        }
        const rect = visibleRect(bar);
        // His raised hands overlap the bar's lower edge.
        grinch.style.top = `${Math.round(rect.bottom - 10)}px`;

        if (still) {
            grinch.style.transform = `translateX(${Math.round(Math.min(rect.right, window.innerWidth) - SIZE - 8)}px)`;
            const peek = grinch.animate(
                [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
                { duration: PEEK_MS }
            );
            peek.onfinish = () => onDone?.();
            return () => peek.cancel();
        }

        const frames = grinchKeyframes(rect, window.innerWidth);
        const timing = { duration: RUN_MS, easing: 'linear' };
        const run = grinch.animate(frames.grinch, timing);
        const carry = bar.animate(frames.bar, timing);
        run.onfinish = () => onDone?.();
        return () => {
            run.cancel();
            carry.cancel();
        };
    }, [still, onDone]);

    return (
        <div ref={ref} className={'grinch' + (still ? ' is-still' : '')} data-easter-egg="grinch" aria-hidden="true">
            <GrinchDrawing />
        </div>
    );
}

// A stylised, grumpy, furry green fellow, arms up, facing left.
function GrinchDrawing() {
    const fur = '#5e9a45';
    const furDark = '#2f5523';
    return (
        <svg viewBox="0 0 80 96" width={SIZE} height={SIZE * 1.2} focusable="false">
            {/* Arms raised to carry */}
            <g stroke={fur} strokeWidth="7" strokeLinecap="round" fill="none">
                <path d="M26 50 Q18 30 22 8" />
                <path d="M54 50 Q62 30 58 8" />
            </g>
            <circle cx="22" cy="7" r="4.5" fill={fur} stroke={furDark} strokeWidth="1.5" />
            <circle cx="58" cy="7" r="4.5" fill={fur} stroke={furDark} strokeWidth="1.5" />
            {/* Legs: two pairs swap while running */}
            <g className="grinch-leg grinch-leg-a" stroke={furDark} strokeWidth="6" strokeLinecap="round">
                <path d="M34 78 L30 92" />
                <path d="M30 92 L22 92" />
            </g>
            <g className="grinch-leg grinch-leg-b" stroke={furDark} strokeWidth="6" strokeLinecap="round">
                <path d="M46 78 L50 92" />
                <path d="M50 92 L42 92" />
            </g>
            {/* Furry body */}
            <path
                d="M24 54 Q20 70 28 80 L32 77 L35 82 L40 78 L45 82 L48 77 L52 80 Q60 70 56 54 Q48 46 40 46 Q32 46 24 54 Z"
                fill={fur}
                stroke={furDark}
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            {/* Head with tufts */}
            <path
                d="M22 36 Q18 24 26 18 L25 12 L31 16 Q36 12 40 13 L42 8 L45 14 Q56 15 58 26 Q61 36 54 44 Q46 50 34 48 Q24 46 22 36 Z"
                fill={fur}
                stroke={furDark}
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
            {/* Eyes: yellow with red irises, glancing left */}
            <ellipse cx="32" cy="29" rx="5" ry="4" fill="#f2df6b" />
            <ellipse cx="46" cy="29" rx="5" ry="4" fill="#f2df6b" />
            <circle cx="30.5" cy="29.5" r="2.2" fill="#b3352a" />
            <circle cx="44.5" cy="29.5" r="2.2" fill="#b3352a" />
            <circle cx="30.2" cy="29.6" r="1" fill="#141a16" />
            <circle cx="44.2" cy="29.6" r="1" fill="#141a16" />
            {/* Heavy grumpy brows */}
            <path d="M26 24 L37 27" stroke={furDark} strokeWidth="3" strokeLinecap="round" />
            <path d="M52 23 L41 27" stroke={furDark} strokeWidth="3" strokeLinecap="round" />
            {/* Sly grin */}
            <path d="M27 38 Q38 46 52 36 Q46 41 38 41 Q32 41 27 38 Z" fill="#1f3518" />
            <path d="M51 36 L54 34" stroke={furDark} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
