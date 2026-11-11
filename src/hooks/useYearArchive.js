'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDocsFromServer } from 'firebase/firestore';
import { yearCollectionRef } from '@/lib/year-client';
import { isValidYear } from '@/lib/year-paths';

/**
 * One-shot, server-only read of a year's archive (users, messages, reactions).
 *
 * - Three getDocsFromServer reads per load; no orderBy, no limit, no cache fallback and
 *   no listeners.
 * - A result is cached per `${authUid}:${year}` only when `immutable` (a closed year),
 *   so reopening it in the same page session costs no reads.
 * - Any rejection, cache-sourced snapshot or snapshot with pending writes is an error:
 *   nothing is cached and no partial data is shown. There is no automatic retry.
 * - clearYearArchiveCache() (session change) also invalidates loads in flight.
 */

const ARCHIVE_COLLECTIONS = ['users', 'messages', 'reactions'];

const cache = new Map(); // `${authUid}:${year}` -> { users, messages, reactions }
let archiveGeneration = 0;

export function clearYearArchiveCache() {
    archiveGeneration += 1;
    cache.clear();
}

function rowsOf(snapshot) {
    return (snapshot?.docs || []).map((doc) => {
        const data = doc.data() || {};
        return { ...data, id: data.id ?? doc.id };
    });
}

function isServerConfirmed(snapshot) {
    return snapshot?.metadata?.fromCache !== true && snapshot?.metadata?.hasPendingWrites !== true;
}

function loadFromServer(year) {
    try {
        return Promise.all(ARCHIVE_COLLECTIONS.map((name) => getDocsFromServer(yearCollectionRef(year, name))));
    } catch (error) {
        return Promise.reject(error);
    }
}

/**
 * @param {{ authUid: string|null, year: number|null, immutable: boolean }} options
 * @returns {{ status: 'idle'|'loading'|'ready'|'error', data: { users, messages, reactions } | null, reload: Function }}
 */
export function useYearArchive({ authUid, year, immutable }) {
    const key = authUid && isValidYear(year) ? `${authUid}:${year}` : null;
    const [reloadNonce, setReloadNonce] = useState(0);
    // Results are tagged with the key and reload nonce they were requested for.
    const [result, setResult] = useState({ key: null, nonce: -1, status: 'idle', data: null });

    useEffect(() => {
        if (!key) {
            return undefined;
        }

        let active = true;
        const nonce = reloadNonce;
        const publish = (status, data) => {
            setResult({ key, nonce, status, data });
        };

        const cached = cache.get(key);
        if (cached) {
            // A hit: ready with no reads (published asynchronously, never in the effect body).
            Promise.resolve().then(() => {
                if (active) publish('ready', cached);
            });
            return () => {
                active = false;
            };
        }

        const generation = archiveGeneration;
        loadFromServer(year)
            .then((snapshots) => {
                if (!active) return;
                if (generation !== archiveGeneration) {
                    publish('error', null);
                    return;
                }
                if (!snapshots.every(isServerConfirmed)) {
                    publish('error', null);
                    return;
                }
                const [users, messages, reactions] = snapshots.map(rowsOf);
                const data = { users, messages, reactions };
                if (immutable) {
                    cache.set(key, data);
                }
                publish('ready', data);
            })
            .catch(() => {
                if (!active) return;
                publish('error', null);
            });

        return () => {
            active = false;
        };
    }, [key, year, immutable, reloadNonce]);

    const reload = useCallback(() => {
        if (key) {
            cache.delete(key);
        }
        setReloadNonce((value) => value + 1);
    }, [key]);

    if (!key) {
        return { status: 'idle', data: null, reload };
    }
    if (result.key !== key || result.nonce !== reloadNonce) {
        return { status: 'loading', data: null, reload };
    }
    return { status: result.status, data: result.status === 'ready' ? result.data : null, reload };
}
