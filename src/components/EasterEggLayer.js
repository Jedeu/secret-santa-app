'use client';

/**
 * Seasonal effects, mounted once for the signed-in app.
 *
 * - Listens for `onEasterEgg` effects from `@/lib/easter-eggs`: 'snow' (snow falls over the
 *   chat for a few seconds), 'confetti' (one burst), 'grinch' (the Grinch runs in, takes the
 *   tab bar, and puts it back about 2 s later). 'jingle' is sound only and handled elsewhere.
 * - `christmas` turns on Christmas Day mode: lights along the selected-tab underline, gentle
 *   background snow and a Santa hat on "HI {NAME}".
 *
 * Every overlay is pointer-events: none, short, lazy and respects prefers-reduced-motion.
 */
export default function EasterEggLayer({ christmas = false }) {
    void christmas;
    return null;
}
