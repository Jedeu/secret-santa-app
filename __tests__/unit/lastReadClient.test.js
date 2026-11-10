/**
 * @jest-environment jsdom
 *
 * lastReadClient: observed-boundary markers with single-flight, generation-fenced writes.
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
        mockAuthState.uid = 'uid-1';
        mockDoc.mockImplementation((db, collection, id) => `ref:${collection}/${id}`);
        mockSetDoc.mockResolvedValue(undefined);
        mockGetDoc.mockResolvedValue({ exists: () => false });
    });

    afterEach(() => {
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
