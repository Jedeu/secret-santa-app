/**
 * @jest-environment jsdom
 *
 * lastReadClient: observed-boundary markers with single-flight, generation- and
 * scope-fenced writes. Scope A = { key: 'a', year: 2025 } (root paths); scope B =
 * { key: 'b', year: 2026 } (years/2026 paths).
 */

const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockDoc = jest.fn();
const mockOnSnapshot = jest.fn();
const mockFromDate = jest.fn((date) => ({ __iso: date.toISOString() }));
const mockAuthState = { uid: 'uid-1' };

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    getDoc: (...args) => mockGetDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    Timestamp: { fromDate: (...args) => mockFromDate(...args) },
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
    clientAuth: {
        get currentUser() {
            return mockAuthState.uid ? { uid: mockAuthState.uid } : null;
        }
    },
}));

import {
    getLastReadTimestamp,
    updateLastReadTimestamp,
    subscribeToLastRead,
    flushPendingWrites,
    resetLastReadState,
    getCachedTimestamp,
} from '@/lib/lastReadClient';
import { setWritableScope } from '@/lib/year-client';

const T1 = '2026-03-01T10:00:00.000Z';
const T2 = '2026-03-01T10:05:00.000Z';
const T3 = '2026-03-01T10:10:00.000Z';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function flush() {
    for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
    }
}

function writtenValues() {
    return mockSetDoc.mock.calls.map(([, data]) => data.lastReadAt.__iso);
}

function writtenRefs() {
    return mockSetDoc.mock.calls.map(([ref]) => ref);
}

function permissionDenied() {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    return error;
}

describe('lastReadClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        resetLastReadState();
        setWritableScope({ key: 'a', year: 2025 });
        mockAuthState.uid = 'uid-1';
        mockDoc.mockImplementation((db, ...segments) => `ref:${segments.join('/')}`);
        mockSetDoc.mockResolvedValue(undefined);
        mockGetDoc.mockResolvedValue({ exists: () => false });
    });

    afterEach(() => {
        setWritableScope(null);
        jest.useRealTimers();
    });

    describe('getLastReadTimestamp', () => {
        test('returns epoch when ids are missing', async () => {
            expect(await getLastReadTimestamp(null, 'conv1')).toBe(new Date(0).toISOString());
            expect(await getLastReadTimestamp('user1', null)).toBe(new Date(0).toISOString());
        });

        test('caches the fetched value', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ lastReadAt: T1 }) });

            expect(await getLastReadTimestamp('user1', 'conv1')).toBe(T1);
            expect(await getLastReadTimestamp('user1', 'conv1')).toBe(T1);
            expect(mockGetDoc).toHaveBeenCalledTimes(1);
        });

        test('never moves the cache backwards when a local marker was set during the fetch', async () => {
            const gate = deferred();
            mockGetDoc.mockReturnValueOnce(gate.promise);

            const fetchPromise = getLastReadTimestamp('user1', 'conv1');
            expect(updateLastReadTimestamp('user1', 'conv1', T2)).toBe(true);

            gate.resolve({ exists: () => true, data: () => ({ lastReadAt: T1 }) });
            expect(await fetchPromise).toBe(T2);
            expect(getCachedTimestamp('user1', 'conv1')).toBe(T2);
        });
    });

    describe('updateLastReadTimestamp', () => {
        test('rejects missing ids, invalid values and non-advancing values', () => {
            expect(updateLastReadTimestamp(null, 'conv1', T1)).toBe(false);
            expect(updateLastReadTimestamp('user1', null, T1)).toBe(false);
            expect(updateLastReadTimestamp('user1', 'conv1', null)).toBe(false);
            expect(updateLastReadTimestamp('user1', 'conv1', 'not-a-date')).toBe(false);

            expect(updateLastReadTimestamp('user1', 'conv1', T2)).toBe(true);
            expect(updateLastReadTimestamp('user1', 'conv1', T2)).toBe(false);
            expect(updateLastReadTimestamp('user1', 'conv1', T1)).toBe(false);
            expect(getCachedTimestamp('user1', 'conv1')).toBe(T2);
        });

        test('debounces and writes the observed timestamp (not "now")', async () => {
            updateLastReadTimestamp('user1', 'conv1', T1);
            updateLastReadTimestamp('user1', 'conv1', T2);

            jest.advanceTimersByTime(1000);
            expect(mockSetDoc).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1000);

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            expect(mockSetDoc).toHaveBeenCalledWith('ref:lastRead/user1_conv1', {
                userId: 'user1',
                conversationId: 'conv1',
                lastReadAt: { __iso: T2 },
            });
        });
    });

    describe('write schedules', () => {
        test('1. in flight + newer observation + flush: no second write until the first settles, then immediately the newest; entry removed after', async () => {
            const first = deferred();
            mockSetDoc.mockReturnValueOnce(first.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T1]);

            updateLastReadTimestamp('user1', 'conv1', T2);
            await flushPendingWrites();
            jest.advanceTimersByTime(5000);
            await flush();
            expect(writtenValues()).toEqual([T1]);

            first.resolve();
            await flush();
            expect(writtenValues()).toEqual([T1, T2]);

            await flush();
            jest.advanceTimersByTime(120000);
            await flush();
            expect(writtenValues()).toEqual([T1, T2]);
        });

        test.each(['resolve', 'reject'])('2. a pre-reset write that settles (%s) leaves the new entry and its timer intact', async (outcome) => {
            const first = deferred();
            mockSetDoc.mockReturnValueOnce(first.promise);
            jest.spyOn(console, 'error').mockImplementation(() => {});

            updateLastReadTimestamp('user1', 'conv1', T2);
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T2]);

            resetLastReadState();
            expect(updateLastReadTimestamp('user1', 'conv1', T1)).toBe(true);

            if (outcome === 'resolve') {
                first.resolve();
            } else {
                first.reject(new Error('unavailable'));
            }
            await flush();

            jest.advanceTimersByTime(2000);
            await flush();
            expect(writtenValues()).toEqual([T2, T1]);
            console.error.mockRestore();
        });

        test('3a. an idle entry covered by a remote marker is removed, then recreated and written', async () => {
            let snapshotNext;
            mockOnSnapshot.mockImplementation((ref, next) => {
                snapshotNext = next;
                return jest.fn();
            });

            updateLastReadTimestamp('user1', 'conv1', T1);
            const callback = jest.fn();
            subscribeToLastRead('user1', 'conv1', callback);
            snapshotNext({ exists: () => true, data: () => ({ lastReadAt: { toDate: () => new Date(T2) } }) });

            expect(callback).toHaveBeenCalledWith(T2);
            jest.advanceTimersByTime(2000);
            expect(mockSetDoc).not.toHaveBeenCalled();

            expect(updateLastReadTimestamp('user1', 'conv1', T3)).toBe(true);
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T3]);
        });

        test('3b. an in-flight entry is not removed by a remote marker (no concurrent write)', async () => {
            let snapshotNext;
            mockOnSnapshot.mockImplementation((ref, next) => {
                snapshotNext = next;
                return jest.fn();
            });
            const first = deferred();
            mockSetDoc.mockReturnValueOnce(first.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            subscribeToLastRead('user1', 'conv1', jest.fn());
            snapshotNext({ exists: () => true, data: () => ({ lastReadAt: T1 }) });

            updateLastReadTimestamp('user1', 'conv1', T2);
            jest.advanceTimersByTime(5000);
            expect(writtenValues()).toEqual([T1]);

            first.resolve();
            await flush();
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T1, T2]);
        });

        test('4. a rejection then a newer observation during backoff: the next write carries the newest', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            mockSetDoc.mockRejectedValueOnce(new Error('unavailable'));

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            await flush();

            expect(updateLastReadTimestamp('user1', 'conv1', T2)).toBe(true);
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T1]);

            jest.advanceTimersByTime(3000); // 5s backoff
            expect(writtenValues()).toEqual([T1, T2]);
            console.error.mockRestore();
        });

        test('5. permission-denied with a deferred confirmation read and a newer observation: the newer value is still written', async () => {
            const confirmation = deferred();
            mockSetDoc.mockRejectedValueOnce(permissionDenied());
            mockGetDoc.mockReturnValueOnce(confirmation.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            await flush();
            expect(mockGetDoc).toHaveBeenCalledTimes(1);

            // Still in flight while confirming: the newer observation only raises observedAt.
            updateLastReadTimestamp('user1', 'conv1', T2);
            jest.advanceTimersByTime(5000);
            expect(writtenValues()).toEqual([T1]);

            confirmation.resolve({ exists: () => true, data: () => ({ lastReadAt: T1 }) });
            await flush();
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T1, T2]);
        });

        test('6. permission-denied with no newer remote: retried, then dropped after the third failure', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockSetDoc.mockImplementation(() => Promise.reject(permissionDenied()));
            mockGetDoc.mockResolvedValue({ exists: () => false });

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            await flush();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(5000);
            await flush();
            expect(mockSetDoc).toHaveBeenCalledTimes(2);

            jest.advanceTimersByTime(15000);
            await flush();
            expect(mockSetDoc).toHaveBeenCalledTimes(3);

            jest.advanceTimersByTime(600000);
            await flush();
            expect(mockSetDoc).toHaveBeenCalledTimes(3);
            expect(errorSpy).toHaveBeenCalledWith(
                'Dropping lastRead update after repeated failures:',
                'user1_conv1'
            );
            errorSpy.mockRestore();
        });

        test('7. a changed auth uid at write start: no write', async () => {
            updateLastReadTimestamp('user1', 'conv1', T1);
            mockAuthState.uid = 'uid-2';

            jest.advanceTimersByTime(2000);
            await flushPendingWrites();

            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        test.each([
            ['permission-denied', permissionDenied],
            ['other error', () => new Error('unavailable')],
        ])('8a. a write invalidated by reset before its %s rejection: no confirmation read, no retry', async (_label, makeError) => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const old = deferred();
            mockSetDoc.mockReturnValueOnce(old.promise);

            updateLastReadTimestamp('user-a', 'synthetic-conversation', '2025-01-01T00:00:00.000Z');
            const flushing = flushPendingWrites();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);

            resetLastReadState();
            old.reject(makeError());
            await flushing;
            await flush();

            jest.advanceTimersByTime(600000);
            await flush();

            expect(mockGetDoc).not.toHaveBeenCalled();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });

        test.each([
            ['permission-denied', permissionDenied],
            ['other error', () => new Error('unavailable')],
        ])('8b. an invalidated %s rejection cannot touch a replacement entry for the same key', async (_label, makeError) => {
            const old = deferred();
            mockSetDoc.mockReturnValueOnce(old.promise);

            updateLastReadTimestamp('user1', 'conv1', T2);
            jest.advanceTimersByTime(2000);
            expect(writtenValues()).toEqual([T2]);

            resetLastReadState();
            expect(updateLastReadTimestamp('user1', 'conv1', T1)).toBe(true);

            old.reject(makeError());
            await flush();

            expect(mockGetDoc).not.toHaveBeenCalled();
            expect(getCachedTimestamp('user1', 'conv1')).toBe(T1);

            // The replacement's own debounce still fires exactly once; no retry of the old write.
            jest.advanceTimersByTime(2000);
            await flush();
            jest.advanceTimersByTime(600000);
            await flush();
            expect(writtenValues()).toEqual([T2, T1]);
        });

        test('8c. invalidation while a confirmation read is pending: the late result is ignored', async () => {
            const confirmation = deferred();
            mockSetDoc.mockRejectedValueOnce(permissionDenied());
            mockGetDoc.mockReturnValueOnce(confirmation.promise);

            updateLastReadTimestamp('user1', 'conv1', T2);
            jest.advanceTimersByTime(2000);
            await flush();
            expect(mockGetDoc).toHaveBeenCalledTimes(1);

            resetLastReadState();
            expect(updateLastReadTimestamp('user1', 'conv1', T1)).toBe(true);

            confirmation.resolve({ exists: () => true, data: () => ({ lastReadAt: T3 }) });
            await flush();

            expect(getCachedTimestamp('user1', 'conv1')).toBe(T1);
            jest.advanceTimersByTime(2000);
            await flush();
            jest.advanceTimersByTime(600000);
            await flush();
            expect(writtenValues()).toEqual([T2, T1]);
            expect(mockGetDoc).toHaveBeenCalledTimes(1);
        });
    });

    describe('writable scope (no resetLastReadState between scopes)', () => {
        const SCOPE_B = { key: 'b', year: 2026 };

        test('without a scope updateLastReadTimestamp returns false and leaves the cache untouched', () => {
            setWritableScope(null);

            expect(updateLastReadTimestamp('user1', 'conv1', T1)).toBe(false);
            expect(getCachedTimestamp('user1', 'conv1')).toBeUndefined();

            jest.advanceTimersByTime(600000);
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        test('an entry enqueued under A whose debounce fires under B is dropped without a write', async () => {
            expect(updateLastReadTimestamp('user1', 'conv1', T1)).toBe(true);
            setWritableScope(SCOPE_B);

            jest.advanceTimersByTime(2000);
            await flushPendingWrites();
            jest.advanceTimersByTime(600000);
            await flush();

            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        test('a write under a 2026 scope goes to years/2026/lastRead', () => {
            setWritableScope(SCOPE_B);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);

            expect(mockDoc).toHaveBeenCalledWith({ _isMock: true }, 'years', '2026', 'lastRead', 'user1_conv1');
            expect(writtenRefs()).toEqual(['ref:years/2026/lastRead/user1_conv1']);
        });

        test('late resolve: a write held under A that resolves under B changes nothing; the B entry keeps its own timers', async () => {
            const held = deferred();
            mockSetDoc.mockReturnValueOnce(held.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            expect(writtenRefs()).toEqual(['ref:lastRead/user1_conv1']);

            setWritableScope(SCOPE_B);
            expect(updateLastReadTimestamp('user1', 'conv1', T2)).toBe(true);
            expect(getCachedTimestamp('user1', 'conv1')).toBe(T2);

            held.resolve();
            await flush();
            expect(getCachedTimestamp('user1', 'conv1')).toBe(T2);

            jest.advanceTimersByTime(2000);
            await flush();
            jest.advanceTimersByTime(120000);
            await flush();

            expect(writtenRefs()).toEqual(['ref:lastRead/user1_conv1', 'ref:years/2026/lastRead/user1_conv1']);
            expect(writtenValues()).toEqual([T1, T2]);
        });

        test.each([
            ['permission-denied', permissionDenied],
            ['other error', () => new Error('unavailable')],
        ])('late reject (%s): no confirmation read, no retry and no log', async (_label, makeError) => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const held = deferred();
            mockSetDoc.mockReturnValueOnce(held.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            setWritableScope(SCOPE_B);

            held.reject(makeError());
            await flush();
            jest.advanceTimersByTime(60000);
            await flush();
            jest.advanceTimersByTime(600000);
            await flush();

            expect(mockGetDoc).not.toHaveBeenCalled();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });

        test('confirmation in flight: a scope change before it resolves applies nothing', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const confirmation = deferred();
            mockSetDoc.mockRejectedValueOnce(permissionDenied());
            mockGetDoc.mockReturnValueOnce(confirmation.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            await flush();
            expect(mockGetDoc).toHaveBeenCalledTimes(1);
            expect(mockGetDoc).toHaveBeenCalledWith('ref:lastRead/user1_conv1');

            setWritableScope(SCOPE_B);
            confirmation.resolve({ exists: () => true, data: () => ({ lastReadAt: T3 }) });
            await flush();

            expect(getCachedTimestamp('user1', 'conv1')).toBe(T1);
            jest.advanceTimersByTime(600000);
            await flush();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            expect(mockGetDoc).toHaveBeenCalledTimes(1);
            expect(errorSpy).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });

        test('control: with A still current, the confirmation read uses A and settles as superseded', async () => {
            const confirmation = deferred();
            mockSetDoc.mockRejectedValueOnce(permissionDenied());
            mockGetDoc.mockReturnValueOnce(confirmation.promise);

            updateLastReadTimestamp('user1', 'conv1', T1);
            jest.advanceTimersByTime(2000);
            await flush();
            expect(mockGetDoc).toHaveBeenCalledWith('ref:lastRead/user1_conv1');

            confirmation.resolve({ exists: () => true, data: () => ({ lastReadAt: T3 }) });
            await flush();

            expect(getCachedTimestamp('user1', 'conv1')).toBe(T3);
            jest.advanceTimersByTime(600000);
            await flush();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });

        test('flushPendingWrites deletes an entry whose scope is not current', async () => {
            updateLastReadTimestamp('user1', 'conv1', T1);
            setWritableScope(SCOPE_B);

            await flushPendingWrites();
            jest.advanceTimersByTime(600000);
            await flush();

            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        test('getLastReadTimestamp without a scope returns the cached value or epoch without a read', async () => {
            setWritableScope(null);

            expect(await getLastReadTimestamp('user1', 'conv1')).toBe(new Date(0).toISOString());
            expect(mockGetDoc).not.toHaveBeenCalled();
        });

        test('subscribeToLastRead without a scope does not listen; after a scope change snapshots are ignored', () => {
            setWritableScope(null);
            const callback = jest.fn();
            const unsubscribe = subscribeToLastRead('user1', 'conv1', callback);
            expect(typeof unsubscribe).toBe('function');
            expect(mockOnSnapshot).not.toHaveBeenCalled();

            let next;
            mockOnSnapshot.mockImplementation((ref, onNext) => {
                next = onNext;
                return jest.fn();
            });
            setWritableScope({ key: 'a2', year: 2025 });
            subscribeToLastRead('user1', 'conv1', callback);
            setWritableScope(SCOPE_B);
            next({ exists: () => true, data: () => ({ lastReadAt: T1 }) });

            expect(callback).not.toHaveBeenCalled();
            expect(getCachedTimestamp('user1', 'conv1')).toBeUndefined();
        });
    });

    describe('subscribeToLastRead', () => {
        test('ignores callbacks after unsubscribe and after a reset', () => {
            const nexts = [];
            mockOnSnapshot.mockImplementation((ref, next) => {
                nexts.push(next);
                return jest.fn();
            });
            const callbackA = jest.fn();
            const callbackB = jest.fn();

            const unsubscribeA = subscribeToLastRead('user1', 'conv1', callbackA);
            subscribeToLastRead('user1', 'conv2', callbackB);
            unsubscribeA();
            resetLastReadState();

            nexts[0]({ exists: () => true, data: () => ({ lastReadAt: T1 }) });
            nexts[1]({ exists: () => true, data: () => ({ lastReadAt: T1 }) });

            expect(callbackA).not.toHaveBeenCalled();
            expect(callbackB).not.toHaveBeenCalled();
            expect(getCachedTimestamp('user1', 'conv2')).toBeUndefined();
        });

        test('never moves backwards', () => {
            let next;
            mockOnSnapshot.mockImplementation((ref, onNext) => {
                next = onNext;
                return jest.fn();
            });
            updateLastReadTimestamp('user1', 'conv1', T2);
            const callback = jest.fn();
            subscribeToLastRead('user1', 'conv1', callback);

            next({ exists: () => true, data: () => ({ lastReadAt: T1 }) });

            expect(callback).toHaveBeenCalledWith(T2);
            expect(getCachedTimestamp('user1', 'conv1')).toBe(T2);
        });
    });
});
