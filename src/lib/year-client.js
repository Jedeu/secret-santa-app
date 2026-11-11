'use client';

import { collection, doc } from 'firebase/firestore';
import { firestore } from '@/lib/firebase-client';
import { yearCollectionPath, yearDocPath } from '@/lib/year-paths';

/**
 * Client SDK year-scoped references and the session's writable scope.
 *
 * The writable scope is published by UserContext: `{ key, year }` while the session is
 * ready in an active (open) year, otherwise null. Every direct writer (read markers,
 * typing, reactions) captures the scope object when an action is requested, builds refs
 * only from the captured scope, and acts only while `getWritableScope() === captured`.
 * No writer resolves "the current year" at execution time.
 */

let writableScope = null;

/**
 * @param {{ key: string, year: number } | null} next
 * Same key keeps the existing object; otherwise stores a new frozen object.
 */
export function setWritableScope(next) {
    if (!next) {
        writableScope = null;
        return;
    }
    if (writableScope && writableScope.key === next.key) {
        return;
    }
    writableScope = Object.freeze({ key: next.key, year: next.year });
}

/**
 * @returns {{ key: string, year: number } | null} identity is stable per key
 */
export function getWritableScope() {
    return writableScope;
}

export function scopedDocRef(scope, name, id) {
    return doc(firestore, ...yearDocPath(scope.year, name, id));
}

export function yearCollectionRef(year, name) {
    return collection(firestore, ...yearCollectionPath(year, name));
}

export function yearDocRef(year, name, id) {
    return doc(firestore, ...yearDocPath(year, name, id));
}
