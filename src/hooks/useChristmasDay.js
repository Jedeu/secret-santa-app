'use client';

import { useEffect, useState } from 'react';
import { isChristmasDay, readDevEggOverrides } from '@/lib/easter-eggs';

const RECHECK_MS = 60_000;

/**
 * True on December 25 by the viewer's local date (re-checked every minute, so the mode starts
 * and ends at local midnight). In development `?xmas=1` forces it on. `now` is injectable for tests.
 */
export function useChristmasDay(now = () => new Date()) {
    const [christmas, setChristmas] = useState(false);

    useEffect(() => {
        const forced = readDevEggOverrides(window.location.search).christmas;
        const check = () => setChristmas(forced || isChristmasDay(now()));
        check();
        const id = setInterval(check, RECHECK_MS);
        return () => clearInterval(id);
        // `now` is read on every check; a new function identity needs no new interval.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return christmas;
}
