/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';

const mockOnSnapshot = jest.fn();

jest.mock('firebase/firestore', () => ({
    doc: (db, ...segments) => ({ path: segments.join('/') }),
    collection: (db, ...segments) => ({ path: segments.join('/') }),
    onSnapshot: (...args) => mockOnSnapshot(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
}));

import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { setWritableScope } from '@/lib/year-client';

const CONVERSATION = 'santa_user-a_recipient_user-b';

describe('useTypingIndicator writable scope', () => {
    let listeners;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        listeners = [];
        mockOnSnapshot.mockImplementation((ref, next, error) => {
            const unsubscribe = jest.fn();
            listeners.push({ ref, next, error, unsubscribe });
            return unsubscribe;
        });
    });

    afterEach(() => {
        setWritableScope(null);
        jest.useRealTimers();
    });

    test('no subscription without a writable scope', () => {
        const { result } = renderHook(() => useTypingIndicator(CONVERSATION, 'user-b'));

        expect(mockOnSnapshot).not.toHaveBeenCalled();
        expect(result.current).toBe(false);
    });

    test('subscribes at the captured scope year path', () => {
        setWritableScope({ key: 'scope-2026', year: 2026 });

        renderHook(() => useTypingIndicator(CONVERSATION, 'user-b'));

        expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
        expect(listeners[0].ref.path).toBe(`years/2026/typing/${CONVERSATION}_user-b`);
    });

    test('a 2025 scope subscribes at the root path and shows a fresh typing state', () => {
        setWritableScope({ key: 'scope-2025', year: 2025 });
        const { result } = renderHook(() => useTypingIndicator(CONVERSATION, 'user-b'));
        expect(listeners[0].ref.path).toBe(`typing/${CONVERSATION}_user-b`);

        act(() => {
            listeners[0].next({ exists: () => true, data: () => ({ typingAt: new Date().toISOString() }) });
            jest.advanceTimersByTime(1000);
        });

        expect(result.current).toBe(true);
    });

    test('snapshots delivered after a scope change are ignored', () => {
        setWritableScope({ key: 'scope-a', year: 2025 });
        const { result } = renderHook(() => useTypingIndicator(CONVERSATION, 'user-b'));

        setWritableScope({ key: 'scope-b', year: 2026 });
        act(() => {
            listeners[0].next({ exists: () => true, data: () => ({ typingAt: new Date().toISOString() }) });
            jest.advanceTimersByTime(1000);
        });

        expect(result.current).toBe(false);
    });
});
