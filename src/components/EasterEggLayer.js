'use client';

import { useCallback, useEffect, useState } from 'react';
import { onEasterEgg, prefersReducedMotion } from '@/lib/easter-eggs';
import { ChristmasSnow, ConfettiBurst, SnowShower } from '@/components/EasterEggCanvas';
import Grinch from '@/components/Grinch';

const VISUAL_EFFECTS = ['snow', 'confetti', 'grinch'];

/**
 * Seasonal effects, mounted once for the signed-in app.
 *
 * - Listens for `onEasterEgg` effects from `@/lib/easter-eggs`: 'snow' (snow falls over the
 *   chat for a few seconds), 'confetti' (one burst), 'grinch' (the Grinch runs in, takes the
 *   tab bar, and puts it back about 2 s later). 'jingle' is sound only and handled elsewhere.
 *   A repeated snow or confetti restarts it; a Grinch already running is left to finish.
 * - `christmas` turns on Christmas Day mode: gentle background snow here, and `data-christmas`
 *   on <html> for the CSS-only lights on the selected tab and the Santa hat on "HI {NAME}".
 *
 * Every overlay is pointer-events: none, short, lazy and respects prefers-reduced-motion.
 * Each running effect's root carries `data-easter-egg="<effect>"` (Christmas: "christmas").
 */
export default function EasterEggLayer({ christmas = false }) {
    // effect -> { id, still } while it is showing; a new id remounts (restarts) that effect.
    const [running, setRunning] = useState({});

    useEffect(() => onEasterEgg((effect) => {
        if (!VISUAL_EFFECTS.includes(effect)) return;
        const still = prefersReducedMotion();
        setRunning((prev) => {
            if (effect === 'grinch' && prev.grinch) return prev;
            return { ...prev, [effect]: { id: (prev[effect]?.id || 0) + 1, still } };
        });
    }), []);

    useEffect(() => {
        if (!christmas) return undefined;
        const root = document.documentElement;
        root.setAttribute('data-christmas', '');
        return () => root.removeAttribute('data-christmas');
    }, [christmas]);

    const finish = useCallback((effect) => {
        setRunning((prev) => {
            if (!prev[effect]) return prev;
            const next = { ...prev };
            delete next[effect];
            return next;
        });
    }, []);
    const endSnow = useCallback(() => finish('snow'), [finish]);
    const endConfetti = useCallback(() => finish('confetti'), [finish]);
    const endGrinch = useCallback(() => finish('grinch'), [finish]);
    const { snow, confetti, grinch } = running;

    return (
        <>
            {christmas && <ChristmasSnow />}
            {snow && <SnowShower key={snow.id} still={snow.still} onDone={endSnow} />}
            {confetti && <ConfettiBurst key={confetti.id} still={confetti.still} onDone={endConfetti} />}
            {grinch && <Grinch still={grinch.still} onDone={endGrinch} />}
        </>
    );
}
