'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/easter-eggs';

/**
 * Canvas effects for the easter-egg layer: a snow shower, a confetti burst and Christmas Day's
 * background snow. Each canvas is pointer-events: none, allocates only while mounted, and stops
 * its animation frame and resize listener on unmount. With `still`, one frame is drawn and the
 * canvas fades out (prefers-reduced-motion).
 */

const SNOW_MS = 4200;
const CONFETTI_MS = 2600;
const STILL_MS = 1400;

function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

const rand = (min, max) => min + Math.random() * (max - min);

// One drawing loop: `init(w, h)` builds the state once, `draw(ctx, state, frame)` paints a frame.
function runCanvas(canvas, { duration, still, init, draw }, onDone) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        onDone?.();
        return () => { };
    }
    let w = 0;
    let h = 0;
    const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const state = init(w, h);

    if (still) {
        draw(ctx, state, { t: still, dt: 0, w, h, alpha: 1 });
        const id = setTimeout(() => onDone?.(), STILL_MS);
        return () => clearTimeout(id);
    }

    window.addEventListener('resize', resize);
    let raf = 0;
    let start = null;
    let last = 0;
    const tick = (now) => {
        if (start === null) {
            start = now;
            last = now;
        }
        const t = now - start;
        const dt = Math.min(now - last, 50) / 1000;
        last = now;
        if (duration && t >= duration) {
            ctx.clearRect(0, 0, w, h);
            onDone?.();
            return;
        }
        ctx.clearRect(0, 0, w, h);
        draw(ctx, state, { t, dt, w, h });
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
    };
}

// Fade in over `inMs`, hold, fade out over the last `outMs`.
function envelope(t, duration, inMs, outMs) {
    if (t < inMs) return t / inMs;
    if (t > duration - outMs) return Math.max(0, (duration - t) / outMs);
    return 1;
}

function makeFlakes(w, h, count, { rMin, rMax, aMin, aMax, vMin, vMax, top }) {
    return Array.from({ length: count }, () => {
        const depth = Math.random();
        return {
            x: Math.random() * w,
            y: rand(top * h, h),
            r: rMin + depth * (rMax - rMin),
            a: rand(aMin, aMax),
            vy: vMin + depth * (vMax - vMin),
            sway: rand(6, 18),
            phase: Math.random() * Math.PI * 2,
        };
    });
}

function drawFlakes(ctx, flakes, { t, dt, w, h }, color, alpha) {
    ctx.fillStyle = color;
    for (const f of flakes) {
        f.y += f.vy * dt;
        if (f.y - f.r > h) {
            f.y = -f.r;
            f.x = Math.random() * w;
        }
        const x = f.x + Math.sin(t / 900 + f.phase) * f.sway;
        ctx.globalAlpha = f.a * alpha;
        ctx.beginPath();
        ctx.arc(x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function useCanvasEffect(spec, onDone) {
    const ref = useRef(null);
    useEffect(() => runCanvas(ref.current, spec, onDone), [spec, onDone]);
    return ref;
}

const SNOW = {
    duration: SNOW_MS,
    init: (w, h) => ({
        color: cssVar('--foreground', '#ece6d6'),
        flakes: makeFlakes(w, h, Math.min(160, Math.round((w * h) / 4200)), {
            rMin: 1.2, rMax: 3.4, aMin: 0.55, aMax: 0.95, vMin: 45, vMax: 130, top: -0.3,
        }),
    }),
    draw: (ctx, s, frame) => drawFlakes(ctx, s.flakes, frame, s.color, frame.alpha ?? envelope(frame.t, SNOW_MS, 400, 900)),
};

/** 'snow': a short shower over the whole app. */
export function SnowShower({ still = false, onDone }) {
    const ref = useCanvasEffect(still ? STILL_SNOW : SNOW, onDone);
    return <canvas ref={ref} className={'easter-egg-canvas' + (still ? ' is-still' : '')} data-easter-egg="snow" aria-hidden="true" />;
}
const STILL_SNOW = { ...SNOW, still: 1 };

const GRAVITY = 720;

const CONFETTI = {
    duration: CONFETTI_MS,
    init: (w, h) => {
        const colors = [
            cssVar('--primary', '#e0b25a'),
            cssVar('--bubble-outline', '#e06a5a'),
            cssVar('--success', '#6dbf8f'),
            cssVar('--foreground', '#ece6d6'),
        ];
        const scale = Math.min(1.25, Math.max(0.75, Math.min(w, h) / 520));
        const count = Math.min(140, Math.round(w / 4) + 40);
        const pieces = Array.from({ length: count }, (_, i) => {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.35;
            // A wide, even spread of speeds fills the burst instead of drawing a ring.
            const speed = rand(60, 700) * scale;
            return {
                x: w / 2, y: h * 0.4,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                w: rand(5, 9), h: rand(3, 5), round: i % 5 === 0,
                rot: Math.random() * Math.PI, spin: rand(-9, 9),
                flip: Math.random() * Math.PI, flipSpeed: rand(6, 14),
                color: colors[i % colors.length],
            };
        });
        return { pieces };
    },
    draw: (ctx, s, { t, dt }) => {
        const still = dt === 0;
        const alpha = still ? 1 : envelope(t, CONFETTI_MS, 1, 700);
        const drag = Math.pow(0.985, dt * 60);
        for (const p of s.pieces) {
            if (still) {
                // A frozen moment just after the burst.
                const st = t / 1000;
                p.x += p.vx * st * 0.8;
                p.y += p.vy * st * 0.8 + 0.5 * GRAVITY * st * st;
            } else {
                p.vx *= drag;
                p.vy = p.vy * drag + GRAVITY * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.rot += p.spin * dt;
                p.flip += p.flipSpeed * dt;
            }
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.scale(1, Math.cos(p.flip));
            if (p.round) {
                ctx.beginPath();
                ctx.arc(0, 0, p.h * 0.75, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            }
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    },
};
const STILL_CONFETTI = { ...CONFETTI, still: 450 };

/** 'confetti': one burst in the app's palette. */
export function ConfettiBurst({ still = false, onDone }) {
    const ref = useCanvasEffect(still ? STILL_CONFETTI : CONFETTI, onDone);
    return <canvas ref={ref} className={'easter-egg-canvas' + (still ? ' is-still' : '')} data-easter-egg="confetti" aria-hidden="true" />;
}

const CHRISTMAS_SNOW = {
    duration: 0,
    init: (w, h) => ({
        color: cssVar('--foreground', '#ece6d6'),
        // Sparse, tiny and faint: it drifts behind the chat without touching text contrast.
        flakes: makeFlakes(w, h, Math.min(40, Math.round((w * h) / 18000)), {
            rMin: 0.8, rMax: 1.8, aMin: 0.14, aMax: 0.28, vMin: 10, vMax: 26, top: 0,
        }),
    }),
    draw: (ctx, s, frame) => drawFlakes(ctx, s.flakes, frame, s.color, 1),
};
const STILL_CHRISTMAS_SNOW = { ...CHRISTMAS_SNOW, still: 1 };

/**
 * Christmas Day: gentle background snow behind the app for as long as it is mounted; with
 * reduced motion, a still scattering of flakes.
 */
export function ChristmasSnow() {
    const ref = useRef(null);
    useEffect(() => runCanvas(ref.current, prefersReducedMotion() ? STILL_CHRISTMAS_SNOW : CHRISTMAS_SNOW), []);
    return <canvas ref={ref} className="easter-egg-backdrop" data-easter-egg="christmas" aria-hidden="true" />;
}
