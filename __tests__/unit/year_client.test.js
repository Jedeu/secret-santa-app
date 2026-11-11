/**
 * @jest-environment jsdom
 */

const mockDoc = jest.fn((db, ...segments) => ({ kind: 'doc', db, path: segments.join('/') }));
const mockCollection = jest.fn((db, ...segments) => ({ kind: 'collection', db, path: segments.join('/') }));

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
}));

import {
    getWritableScope,
    scopedDocRef,
    setWritableScope,
    yearCollectionRef,
    yearDocRef,
} from '@/lib/year-client';

describe('year-client', () => {
    afterEach(() => {
        setWritableScope(null);
        jest.clearAllMocks();
    });

    test('starts without a scope', () => {
        expect(getWritableScope()).toBeNull();
    });

    test('the same key keeps the existing object identity', () => {
        setWritableScope({ key: 'a', year: 2025 });
        const first = getWritableScope();
        setWritableScope({ key: 'a', year: 2025 });

        expect(getWritableScope()).toBe(first);
        expect(first).toEqual({ key: 'a', year: 2025 });
        expect(Object.isFrozen(first)).toBe(true);
    });

    test('a new key replaces the object', () => {
        setWritableScope({ key: 'a', year: 2025 });
        const first = getWritableScope();
        setWritableScope({ key: 'b', year: 2026 });
        const second = getWritableScope();

        expect(second).not.toBe(first);
        expect(second).toEqual({ key: 'b', year: 2026 });
    });

    test('null clears the scope, and the same key afterwards is a new object', () => {
        setWritableScope({ key: 'a', year: 2025 });
        const first = getWritableScope();
        setWritableScope(null);
        expect(getWritableScope()).toBeNull();

        setWritableScope({ key: 'a', year: 2025 });
        expect(getWritableScope()).not.toBe(first);
    });

    test('scopedDocRef uses the scope year', () => {
        expect(scopedDocRef({ key: 'a', year: 2025 }, 'lastRead', 'k1').path).toBe('lastRead/k1');
        expect(scopedDocRef({ key: 'b', year: 2026 }, 'lastRead', 'k1').path).toBe('years/2026/lastRead/k1');
        expect(mockDoc).toHaveBeenLastCalledWith({ _isMock: true }, 'years', '2026', 'lastRead', 'k1');
    });

    test('yearCollectionRef and yearDocRef build year paths', () => {
        expect(yearCollectionRef(2025, 'messages').path).toBe('messages');
        expect(yearCollectionRef(2026, 'reactions').path).toBe('years/2026/reactions');
        expect(mockCollection).toHaveBeenLastCalledWith({ _isMock: true }, 'years', '2026', 'reactions');
        expect(yearDocRef(2027, 'users', 'u1').path).toBe('years/2027/users/u1');
    });
});
