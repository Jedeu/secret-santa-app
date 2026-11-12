/**
 * @jest-environment jsdom
 *
 * UserProvider / useUser: single auth + profile + season owner.
 * - one bootstrap per auth generation regardless of consumer count
 * - stale bootstrap responses (sign-out, account switch, reconciliation) are ignored
 * - assignment snapshots keep updating `user` after refreshes and re-bootstraps
 * - profile loss (server-confirmed missing doc / permission-denied) re-bootstraps
 * - the writable scope is published with the state and cleared first on every loss path
 * - the system/lifecycle fence follows server-confirmed snapshots only; disagreeing
 *   bootstrap responses are retried at most three times
 * - a lifecycle listener that ends is reattached at most once per accepted 2xx bootstrap
 * - 403/409 surface as errors
 * - recipient reveal: the acknowledgment operation is bounded, fenced and settles
 *   synchronously on abandonment; the acknowledgment is monotonic for one tuple
 */

import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
import { UserProvider } from '@/context/UserContext';
import { useUser } from '@/hooks/useUser';
import { cancelOutboxDrains } from '@/lib/message-outbox';
import { cancelPushOperations } from '@/lib/push-client';
import { resetLastReadState } from '@/lib/lastReadClient';
import { resetTypingState } from '@/lib/typing-client';
import { clearYearArchiveCache } from '@/hooks/useYearArchive';
import { getWritableScope, setWritableScope } from '@/lib/year-client';
import { getRevealState } from '@/lib/recipient-reveal';

let mockAuthCallback = null;
// When set (not undefined), onAuthStateChanged delivers this user synchronously on registration.
let mockImmediateAuthUser;
const mockSnapshots = []; // { ref, options, next, error, unsubscribe }

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: (auth, callback) => {
        mockAuthCallback = callback;
        if (mockImmediateAuthUser !== undefined) {
            callback(mockImmediateAuthUser);
        }
        return jest.fn();
    },
}));

jest.mock('firebase/firestore', () => ({
    doc: (db, ...segments) => ({ path: segments.join('/'), id: segments[segments.length - 1] }),
    collection: (db, ...segments) => ({ path: segments.join('/') }),
    onSnapshot: (ref, options, next, error) => {
        const unsubscribe = jest.fn();
        mockSnapshots.push({ ref, options, next, error, unsubscribe });
        return unsubscribe;
    },
}));

jest.mock('@/lib/firebase-client', () => ({
    clientAuth: { _isMock: true },
    firestore: { _isMock: true },
}));

jest.mock('@/lib/participants', () => ({
    isKnownParticipantEmail: jest.fn((email) => email === 'alpha@example.test' || email === 'beta@example.test'),
}));

jest.mock('@/lib/message-outbox', () => ({ cancelOutboxDrains: jest.fn() }));
jest.mock('@/lib/push-client', () => ({ cancelPushOperations: jest.fn() }));
jest.mock('@/lib/lastReadClient', () => ({ resetLastReadState: jest.fn() }));
jest.mock('@/lib/typing-client', () => ({ resetTypingState: jest.fn() }));
jest.mock('@/hooks/useYearArchive', () => ({ clearYearArchiveCache: jest.fn() }));
jest.mock('@/lib/year-client', () => {
    const actual = jest.requireActual('@/lib/year-client');
    return { ...actual, setWritableScope: jest.fn(actual.setWritableScope) };
});

const ALPHA = { uid: 'uid-alpha', email: 'alpha@example.test', getIdToken: jest.fn(() => Promise.resolve('token-alpha')) };
const BETA = { uid: 'uid-beta', email: 'beta@example.test', getIdToken: jest.fn(() => Promise.resolve('token-beta')) };

const alphaUser = { id: 'user-alpha', name: 'Alpha', email: 'alpha@example.test', recipientId: null, gifterId: null };
const alphaUser2026 = { ...alphaUser, id: 'user-alpha-2026' };
const betaUser = { id: 'user-beta', name: 'Beta', email: 'beta@example.test', recipientId: null, gifterId: null };

// Bootstrap response season fields and the matching lifecycle documents.
const SEASON_2025 = { year: 2025, yearState: 'active', epoch: 1, closedYears: [] };
const LIFECYCLE_2025 = { epoch: 1, state: 'active' };
const SEASON_2026 = { year: 2026, yearState: 'active', epoch: 2, closedYears: [2025] };
const LIFECYCLE_2026 = { epoch: 2, state: 'active', year: 2026, closedYears: [2025] };
const LIFECYCLE_CLOSED_2025 = { epoch: 1, state: 'closed', year: 2025, closedYears: [2025] };

const PUBLISHED_2025 = { year: 2025, state: 'active', epoch: 1, closedYears: [] };
const PUBLISHED_2026 = { year: 2026, state: 'active', epoch: 2, closedYears: [2025] };

function response(status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function ok(user, season = SEASON_2025) {
    return response(200, { success: true, user, ...season });
}

function okBody(user, season = SEASON_2025) {
    return { ok: true, status: 200, json: async () => ({ success: true, user, ...season }) };
}

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 20; i += 1) {
            await Promise.resolve();
        }
    });
}

function renderWithConsumers(count = 1, { strict = false } = {}) {
    const latest = {};
    function Consumer({ name }) {
        latest[name] = useUser();
        return null;
    }
    const tree = (
        <UserProvider>
            {Array.from({ length: count }, (_, i) => <Consumer key={i} name={`c${i}`} />)}
        </UserProvider>
    );
    const utils = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    return { ...utils, latest };
}

async function signIn(firebaseUser) {
    await act(async () => {
        mockAuthCallback(firebaseUser);
    });
    await flush();
}

function lifecycleSubs() {
    return mockSnapshots.filter((entry) => entry.ref.path === 'system/lifecycle');
}

function lastLifecycle() {
    const subs = lifecycleSubs();
    return subs[subs.length - 1];
}

function profileSubs() {
    return mockSnapshots.filter((entry) => entry.ref.path !== 'system/lifecycle');
}

function lastSnapshotFor(userId) {
    return [...profileSubs()].reverse().find((entry) => entry.ref.id === userId);
}

function serverLifecycle(data) {
    return { exists: () => data !== null, data: () => data, metadata: { fromCache: false } };
}

function cachedLifecycle(data) {
    return { exists: () => data !== null, data: () => data, metadata: { fromCache: true } };
}

async function deliver(entry, snapshot) {
    await act(async () => {
        entry.next(snapshot);
    });
    await flush();
}

const PERMISSION_DENIED = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };

describe('UserProvider / useUser', () => {
    let warnSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthCallback = null;
        mockImmediateAuthUser = undefined;
        mockSnapshots.length = 0;
        setWritableScope(null);
        global.fetch = jest.fn();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.useRealTimers();
        warnSpy.mockRestore();
        delete global.fetch;
    });

    test('two consumers trigger exactly one bootstrap, which sends the client header and publishes the season', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        const { latest } = renderWithConsumers(2);

        await signIn(ALPHA);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/bootstrap', expect.objectContaining({
            method: 'POST',
            headers: { Authorization: 'Bearer token-alpha', 'X-Secret-Santa-Client': '2' },
        }));
        expect(latest.c0.user).toEqual(alphaUser);
        expect(latest.c1.user).toEqual(alphaUser);
        expect(latest.c0.season).toEqual(PUBLISHED_2025);
        expect(latest.c0.authUid).toBe('uid-alpha');
        expect(latest.c0.loading).toBe(false);
        expect(latest.c0.notice).toBeUndefined();
        expect(getWritableScope()).toEqual({ key: 'uid-alpha|user-alpha|2025|1', year: 2025 });
    });

    test('the lifecycle listener is attached at sign-in with metadata changes; the profile listener uses the season path', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        renderWithConsumers();

        await signIn(ALPHA);

        expect(lifecycleSubs()).toHaveLength(1);
        expect(lifecycleSubs()[0].options).toEqual({ includeMetadataChanges: true });
        expect(profileSubs()).toHaveLength(1);
        expect(profileSubs()[0].ref.path).toBe('users/user-alpha');
        expect(profileSubs()[0].options).toEqual({ includeMetadataChanges: true });
    });

    test('a closed season is published without a writable scope', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser, { year: 2025, yearState: 'closed', epoch: 1, closedYears: [2025] }));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);

        expect(latest.c0.season).toEqual({ year: 2025, state: 'closed', epoch: 1, closedYears: [2025] });
        expect(latest.c0.user).toEqual(alphaUser);
        expect(getWritableScope()).toBeNull();
    });

    test('a stale response after sign-out is ignored', async () => {
        const pending = deferred();
        global.fetch.mockImplementation(() => pending.promise);
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);
        await act(async () => { mockAuthCallback(null); });

        pending.resolve(okBody(alphaUser));
        await flush();

        expect(latest.c0.user).toBeNull();
        expect(latest.c0.season).toBeNull();
        expect(latest.c0.authUid).toBeNull();
        expect(latest.c0.loading).toBe(false);
        expect(getWritableScope()).toBeNull();
    });

    test('a stale response after an account switch is ignored', async () => {
        const alphaPending = deferred();
        global.fetch
            .mockImplementationOnce(() => alphaPending.promise)
            .mockImplementationOnce(() => ok(betaUser));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);
        await signIn(BETA);
        expect(latest.c0.user).toEqual(betaUser);

        alphaPending.resolve(okBody(alphaUser));
        await flush();

        expect(latest.c0.user).toEqual(betaUser);
        expect(latest.c0.authUid).toBe('uid-beta');
        expect(getWritableScope()).toEqual({ key: 'uid-beta|user-beta|2025|1', year: 2025 });
    });

    test('a loss path clears the scope first, then runs the five cancels in order', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        renderWithConsumers();
        await signIn(ALPHA);
        expect(getWritableScope()).not.toBeNull();

        const scopeAtCancel = [];
        cancelOutboxDrains.mockImplementation(() => { scopeAtCancel.push(getWritableScope()); });
        jest.clearAllMocks();

        await act(async () => { mockAuthCallback(null); });

        const steps = [cancelOutboxDrains, cancelPushOperations, resetLastReadState, resetTypingState, clearYearArchiveCache];
        steps.forEach((step) => expect(step).toHaveBeenCalledTimes(1));
        const order = steps.map((step) => step.mock.invocationCallOrder[0]);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(setWritableScope.mock.calls[0]).toEqual([null]);
        expect(setWritableScope.mock.invocationCallOrder[0]).toBeLessThan(order[0]);
        expect(scopeAtCancel).toEqual([null]);
        cancelOutboxDrains.mockImplementation(() => {});
    });

    test('a non-participant email gets ACCESS_DENIED without a request', async () => {
        const { latest } = renderWithConsumers();

        await signIn({ uid: 'uid-x', email: 'outsider@example.test', getIdToken: jest.fn() });

        expect(global.fetch).not.toHaveBeenCalled();
        expect(latest.c0.error).toMatchObject({ code: 'ACCESS_DENIED' });
        expect(latest.c0.user).toBeNull();
    });

    test('assignment snapshots still update the user after refreshUser()', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        expect(profileSubs()).toHaveLength(1);

        await act(async () => { await latest.c0.refreshUser(); });
        await flush();

        // Same profile id and year: the subscription is untouched.
        expect(profileSubs()).toHaveLength(1);

        await act(async () => {
            profileSubs()[0].next({
                exists: () => true,
                metadata: { fromCache: false },
                data: () => ({ ...alphaUser, gifterId: 'user-beta', recipientId: 'user-gamma' }),
            });
        });

        expect(latest.c0.user.gifterId).toBe('user-beta');
        expect(latest.c0.user.recipientId).toBe('user-gamma');
    });

    test('non-assignment field changes keep the same user object', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        const before = latest.c0.user;

        await act(async () => {
            profileSubs()[0].next({
                exists: () => true,
                metadata: { fromCache: false },
                data: () => ({ ...alphaUser, image: 'new-image.jpg' }),
            });
        });

        expect(latest.c0.user).toBe(before);
    });

    test('a server-confirmed missing profile re-bootstraps and the new profile keeps updating', async () => {
        const resetUser = { ...alphaUser, id: 'user-alpha-2' };
        global.fetch
            .mockImplementationOnce(() => ok(alphaUser))
            .mockImplementationOnce(() => ok(resetUser));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        const firstProfile = profileSubs()[0];
        jest.clearAllMocks();

        await act(async () => {
            firstProfile.next({ exists: () => false, metadata: { fromCache: false } });
        });
        await flush();

        expect(cancelOutboxDrains).toHaveBeenCalled();
        expect(cancelPushOperations).toHaveBeenCalled();
        expect(resetLastReadState).toHaveBeenCalled();
        expect(resetTypingState).toHaveBeenCalled();
        expect(clearYearArchiveCache).toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(latest.c0.user.id).toBe('user-alpha-2');
        expect(firstProfile.unsubscribe).toHaveBeenCalled();

        const next = lastSnapshotFor('user-alpha-2');
        expect(next).toBeDefined();
        await act(async () => {
            next.next({
                exists: () => true,
                metadata: { fromCache: false },
                data: () => ({ ...resetUser, recipientId: 'user-beta' }),
            });
        });
        expect(latest.c0.user.recipientId).toBe('user-beta');
    });

    test('permission-denied on the profile listener re-bootstraps', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        renderWithConsumers();
        await signIn(ALPHA);
        global.fetch.mockClear();

        await act(async () => {
            profileSubs()[0].error({ code: 'permission-denied' });
        });
        await flush();

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('a cache-only profile miss is ignored', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        global.fetch.mockClear();

        await act(async () => {
            profileSubs()[0].next({ exists: () => false, metadata: { fromCache: true } });
        });
        await flush();

        expect(global.fetch).not.toHaveBeenCalled();
        expect(latest.c0.user).toEqual(alphaUser);
    });

    test('a snapshot delivered after cleanup is ignored', async () => {
        global.fetch.mockImplementation(() => ok(alphaUser));
        const { latest, unmount } = renderWithConsumers();
        await signIn(ALPHA);
        const stale = profileSubs()[0];
        const staleLifecycle = lifecycleSubs()[0];
        const userBefore = latest.c0.user;
        global.fetch.mockClear();

        unmount();
        await act(async () => {
            stale.next({ exists: () => false, metadata: { fromCache: false } });
            stale.next({ exists: () => true, metadata: { fromCache: false }, data: () => ({ ...alphaUser, gifterId: 'x' }) });
            staleLifecycle.next(serverLifecycle(LIFECYCLE_2026));
        });
        await flush();

        expect(stale.unsubscribe).toHaveBeenCalled();
        expect(staleLifecycle.unsubscribe).toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(latest.c0.user).toBe(userBefore);
        expect(getWritableScope()).toBeNull();
    });

    test('other profile listener errors are logged', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch.mockImplementation(() => ok(alphaUser));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);

        await act(async () => {
            profileSubs()[0].error(new Error('unavailable'));
        });

        expect(latest.c0.user).toEqual(alphaUser);
        expect(spy).toHaveBeenCalledWith('[useUser] Error listening to user document:', expect.any(Error));
        spy.mockRestore();
    });

    test.each([
        [403, 'EMAIL_NOT_VERIFIED'],
        [409, 'PROFILE_CONFLICT'],
        [409, 'CLIENT_UPDATE_REQUIRED'],
    ])('%i %s -> error state with user and season null', async (status, code) => {
        global.fetch.mockImplementation(() => response(status, { code, error: 'Nope' }));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);

        expect(latest.c0.error).toEqual({ code, message: 'Nope' });
        expect(latest.c0.user).toBeNull();
        expect(latest.c0.season).toBeNull();
        expect(latest.c0.authUid).toBeNull();
        expect(latest.c0.loading).toBe(false);
        expect(getWritableScope()).toBeNull();
    });

    test('a 401 retries once with a forced token refresh', async () => {
        global.fetch
            .mockImplementationOnce(() => response(401, { code: 'UNAUTHENTICATED' }))
            .mockImplementationOnce(() => ok(alphaUser));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);

        expect(ALPHA.getIdToken).toHaveBeenCalledWith(true);
        expect(latest.c0.user).toEqual(alphaUser);
    });

    test('a refresh network failure keeps the ready state', async () => {
        jest.useFakeTimers();
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch.mockImplementationOnce(() => ok(alphaUser));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);

        global.fetch.mockImplementation(() => Promise.reject(new Error('offline')));
        await act(async () => { await latest.c0.refreshUser(); });
        await flush();
        for (const delay of [1000, 2000, 4000, 8000, 8000]) {
            await act(async () => { jest.advanceTimersByTime(delay); });
            await flush();
        }

        expect(global.fetch).toHaveBeenCalledTimes(1 + 5);
        expect(latest.c0.user).toEqual(alphaUser);
        expect(latest.c0.loading).toBe(false);
        expect(latest.c0.error).toBeNull();
        spy.mockRestore();
    });

    test('initial bootstrap network failures end in BOOTSTRAP_FAILED after five attempts', async () => {
        jest.useFakeTimers();
        global.fetch.mockImplementation(() => Promise.reject(new Error('offline')));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);
        for (const delay of [1000, 2000, 4000, 8000]) {
            await act(async () => { jest.advanceTimersByTime(delay); });
            await flush();
        }

        expect(global.fetch).toHaveBeenCalledTimes(5);
        expect(latest.c0.error).toMatchObject({ code: 'BOOTSTRAP_FAILED' });
        expect(latest.c0.user).toBeNull();
        expect(latest.c0.season).toBeNull();
    });

    describe('StrictMode', () => {
        test('the scope and the lifecycle subscription are restored after the remount; updaters run once', async () => {
            // Synchronous delivery makes the first mount see the user before StrictMode's
            // simulated unmount/remount (the first mount's bootstrap is then superseded).
            mockImmediateAuthUser = ALPHA;
            global.fetch.mockImplementation(() => ok(alphaUser));
            const { latest } = renderWithConsumers(1, { strict: true });
            await flush();

            const subs = lifecycleSubs();
            expect(subs).toHaveLength(2);
            expect(subs[0].unsubscribe).toHaveBeenCalled();
            expect(subs[1].unsubscribe).not.toHaveBeenCalled();

            await act(async () => { await latest.c0.refreshUser(); });
            await flush();
            expect(latest.c0.user).toEqual(alphaUser);
            expect(getWritableScope()).toEqual({ key: 'uid-alpha|user-alpha|2025|1', year: 2025 });

            // One publication = one updater call = one scope publication.
            setWritableScope.mockClear();
            await act(async () => {
                lastSnapshotFor('user-alpha').next({
                    exists: () => true,
                    metadata: { fromCache: false },
                    data: () => ({ ...alphaUser, recipientId: 'user-beta' }),
                });
            });
            expect(latest.c0.user.recipientId).toBe('user-beta');
            expect(setWritableScope).toHaveBeenCalledTimes(1);

            // The restored lifecycle listener is live.
            global.fetch.mockClear();
            global.fetch.mockImplementation(() => ok(alphaUser2026, SEASON_2026));
            await deliver(subs[1], serverLifecycle(LIFECYCLE_2026));
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(latest.c0.season).toEqual(PUBLISHED_2026);
        });
    });

    describe('lifecycle fence and reconciliation', () => {
        test('a cache-only differing lifecycle snapshot does not move the fence and causes no bootstrap', async () => {
            global.fetch.mockImplementation(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            global.fetch.mockClear();

            await deliver(lastLifecycle(), cachedLifecycle(LIFECYCLE_2026));

            expect(global.fetch).not.toHaveBeenCalled();
            expect(latest.c0.season).toEqual(PUBLISHED_2025);
            expect(getWritableScope()).not.toBeNull();

            // The fence is still unset: a matching server snapshot changes nothing either.
            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2025));
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('healthy convergence: a server-confirmed Start clears the scope synchronously and re-bootstraps once', async () => {
            global.fetch.mockImplementationOnce(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2025));
            expect(getWritableScope()).not.toBeNull();

            global.fetch.mockClear();
            global.fetch.mockImplementation(() => ok(alphaUser2026, SEASON_2026));

            act(() => {
                lastLifecycle().next(serverLifecycle(LIFECYCLE_2026));
            });
            expect(getWritableScope()).toBeNull();
            expect(latest.c0.loading).toBe(true);

            await flush();

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(latest.c0.season).toEqual(PUBLISHED_2026);
            expect(latest.c0.user).toEqual(alphaUser2026);
            expect(getWritableScope()).toEqual({ key: 'uid-alpha|user-alpha-2026|2026|2', year: 2026 });
            expect(lastSnapshotFor('user-alpha-2026').ref.path).toBe('years/2026/users/user-alpha-2026');
        });

        test('a server-confirmed Close while ready re-bootstraps into the closed season with no scope', async () => {
            global.fetch.mockImplementationOnce(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            global.fetch.mockClear();
            global.fetch.mockImplementation(() => ok(alphaUser, { year: 2025, yearState: 'closed', epoch: 1, closedYears: [2025] }));

            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_CLOSED_2025));

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(latest.c0.season).toEqual({ year: 2025, state: 'closed', epoch: 1, closedYears: [2025] });
            expect(getWritableScope()).toBeNull();
        });

        test('lagging listener: a response ahead of the fence waits, then the 1 s retry publishes it', async () => {
            jest.useFakeTimers();
            global.fetch.mockImplementationOnce(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2025));

            global.fetch.mockClear();
            global.fetch.mockImplementation(() => ok(alphaUser2026, SEASON_2026));
            await act(async () => { await latest.c0.refreshUser(); });
            await flush();

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(latest.c0.loading).toBe(true);
            expect(latest.c0.user).toBeNull();
            expect(latest.c0.season).toBeNull();
            expect(getWritableScope()).toBeNull();

            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2026));
            expect(global.fetch).toHaveBeenCalledTimes(1);

            await act(async () => { jest.advanceTimersByTime(1000); });
            await flush();

            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(latest.c0.season).toEqual(PUBLISHED_2026);
            expect(latest.c0.loading).toBe(false);
            expect(getWritableScope()).toEqual({ key: 'uid-alpha|user-alpha-2026|2026|2', year: 2026 });
        });

        test('persistent mismatch: exactly three requests, then LIFECYCLE_MISMATCH; refreshUser starts one new bounded cycle', async () => {
            jest.useFakeTimers();
            // Every response carries K0 (2025 active, epoch 1); the fence moves to K1 (2026).
            global.fetch.mockImplementation(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            global.fetch.mockClear();

            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2026));
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(latest.c0.loading).toBe(true);

            await act(async () => { jest.advanceTimersByTime(1000); });
            await flush();
            expect(global.fetch).toHaveBeenCalledTimes(2);

            await act(async () => { jest.advanceTimersByTime(2000); });
            await flush();
            expect(global.fetch).toHaveBeenCalledTimes(3);

            expect(latest.c0.error).toEqual({
                code: 'LIFECYCLE_MISMATCH',
                message: 'The exchange changed while loading. Please try again.',
            });
            expect(latest.c0.user).toBeNull();
            expect(latest.c0.season).toBeNull();
            expect(latest.c0.loading).toBe(false);
            expect(getWritableScope()).toBeNull();

            await act(async () => { jest.advanceTimersByTime(120000); });
            await flush();
            expect(global.fetch).toHaveBeenCalledTimes(3);

            // Try again: one new bounded cycle.
            await act(async () => { await latest.c0.refreshUser(); });
            await flush();
            for (const delay of [1000, 2000]) {
                await act(async () => { jest.advanceTimersByTime(delay); });
                await flush();
            }
            expect(global.fetch).toHaveBeenCalledTimes(6);
            expect(latest.c0.error).toMatchObject({ code: 'LIFECYCLE_MISMATCH' });

            await act(async () => { jest.advanceTimersByTime(120000); });
            await flush();
            expect(global.fetch).toHaveBeenCalledTimes(6);
        });

        test('a held stale bootstrap response released after a reconciliation is ignored', async () => {
            global.fetch.mockImplementationOnce(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2025));

            const held = deferred();
            global.fetch
                .mockImplementationOnce(() => held.promise)
                .mockImplementationOnce(() => ok(alphaUser2026, SEASON_2026));
            await act(async () => { await latest.c0.refreshUser(); });

            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2026));
            expect(latest.c0.season).toEqual(PUBLISHED_2026);

            held.resolve(okBody(alphaUser));
            await flush();

            expect(latest.c0.season).toEqual(PUBLISHED_2026);
            expect(latest.c0.user).toEqual(alphaUser2026);
        });

        test('environment reset: a server-confirmed missing lifecycle re-bootstraps once and the response is accepted', async () => {
            global.fetch.mockImplementation(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2025));
            global.fetch.mockClear();

            await deliver(lastLifecycle(), serverLifecycle(null));

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(latest.c0.loading).toBe(false);
            expect(latest.c0.season).toEqual(PUBLISHED_2025);
            expect(latest.c0.user).toEqual(alphaUser);
            expect(getWritableScope()).toEqual({ key: 'uid-alpha|user-alpha|2025|1', year: 2025 });
        });

        test('callbacks from a previous subscription generation are ignored after an account switch; the fence starts null', async () => {
            global.fetch.mockImplementationOnce(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            const alphaLifecycle = lastLifecycle();

            const betaPending = deferred();
            global.fetch.mockImplementationOnce(() => betaPending.promise);
            await signIn(BETA);
            expect(lifecycleSubs()).toHaveLength(2);
            expect(alphaLifecycle.unsubscribe).toHaveBeenCalled();

            await act(async () => {
                alphaLifecycle.next(serverLifecycle(LIFECYCLE_2026));
                alphaLifecycle.error(PERMISSION_DENIED);
            });
            await flush();

            // No reattach and no extra bootstrap.
            expect(lifecycleSubs()).toHaveLength(2);
            expect(global.fetch).toHaveBeenCalledTimes(2);

            // The stale 2026 snapshot did not set the fence: a 2025 response is accepted.
            betaPending.resolve(okBody(betaUser));
            await flush();
            expect(latest.c0.user).toEqual(betaUser);
            expect(latest.c0.season).toEqual(PUBLISHED_2025);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('bounded lifecycle reattach', () => {
        test('first admission, error then success: exactly one reattach and no extra bootstrap', async () => {
            const held = deferred();
            global.fetch.mockImplementationOnce(() => held.promise);
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            const first = lastLifecycle();

            await act(async () => { first.error(PERMISSION_DENIED); });
            await flush();
            expect(lifecycleSubs()).toHaveLength(1);

            held.resolve(okBody(alphaUser));
            await flush();

            expect(latest.c0.user).toEqual(alphaUser);
            expect(lifecycleSubs()).toHaveLength(2);
            expect(global.fetch).toHaveBeenCalledTimes(1);

            // The new listener is live: a server-confirmed advance reconciles.
            global.fetch.mockImplementation(() => ok(alphaUser2026, SEASON_2026));
            const second = lastLifecycle();
            await deliver(second, serverLifecycle(LIFECYCLE_2025));
            expect(global.fetch).toHaveBeenCalledTimes(1);
            await deliver(second, serverLifecycle(LIFECYCLE_2026));
            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(latest.c0.season).toEqual(PUBLISHED_2026);
        });

        test('first admission, success then error: exactly one reattach, no extra bootstrap, and the new listener is live', async () => {
            global.fetch.mockImplementationOnce(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);
            expect(lifecycleSubs()).toHaveLength(1);

            await act(async () => { lifecycleSubs()[0].error(PERMISSION_DENIED); });
            await flush();

            expect(lifecycleSubs()).toHaveLength(2);
            expect(global.fetch).toHaveBeenCalledTimes(1);

            global.fetch.mockImplementation(() => ok(alphaUser2026, SEASON_2026));
            await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2026));
            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(latest.c0.season).toEqual(PUBLISHED_2026);
        });

        test('repeated denial: no further attach or bootstrap until a later accepted bootstrap, which reattaches once', async () => {
            jest.useFakeTimers();
            global.fetch.mockImplementation(() => ok(alphaUser));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);

            await act(async () => { lifecycleSubs()[0].error(PERMISSION_DENIED); });
            await flush();
            expect(lifecycleSubs()).toHaveLength(2);

            await act(async () => { lifecycleSubs()[1].error(PERMISSION_DENIED); });
            await flush();
            await act(async () => { jest.advanceTimersByTime(120000); });
            await flush();

            expect(lifecycleSubs()).toHaveLength(2);
            expect(global.fetch).toHaveBeenCalledTimes(1);

            await act(async () => { await latest.c0.refreshUser(); });
            await flush();

            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(lifecycleSubs()).toHaveLength(3);
        });

        test('a 2xx without a year is transient and causes no reattach', async () => {
            jest.useFakeTimers();
            global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser, epoch: 1, yearState: 'active' }));
            const { latest } = renderWithConsumers();
            await signIn(ALPHA);

            await act(async () => { lifecycleSubs()[0].error(PERMISSION_DENIED); });
            await flush();

            expect(latest.c0.loading).toBe(true);
            expect(latest.c0.user).toBeNull();
            expect(lifecycleSubs()).toHaveLength(1);

            // The transient retry does not count as an admission either.
            await act(async () => { jest.advanceTimersByTime(1000); });
            await flush();
            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(lifecycleSubs()).toHaveLength(1);
        });
    });

    describe('recipient reveal', () => {
        const ACK_URL = '/api/reveal/acknowledge';
        const BOOT_URL = '/api/auth/bootstrap';
        const ACK_AT = '2026-11-11T10:00:00.000Z';
        const TIMEOUT_MS = 15000;

        const SEASON_CLOSED_2026 = { year: 2026, yearState: 'closed', epoch: 2, closedYears: [2025, 2026] };
        const LIFECYCLE_CLOSED_2026 = { epoch: 2, state: 'closed', year: 2026, closedYears: [2025, 2026] };
        const SEASON_2027 = { year: 2027, yearState: 'active', epoch: 3, closedYears: [2025, 2026] };
        const LIFECYCLE_2027 = { epoch: 3, state: 'active', year: 2027, closedYears: [2025, 2026] };

        // Synthetic 2026 automatic-draw profiles (ring Alpha -> Bravo -> Charlie).
        const autoPending = {
            id: 'alpha-2026',
            name: 'Alpha',
            email: 'alpha@example.test',
            recipientId: 'bravo-2026',
            gifterId: 'charlie-2026',
            drawMode: 'auto',
            revealAckRecipientId: null,
            revealAckAt: null,
        };
        const autoAcked = { ...autoPending, revealAckRecipientId: 'bravo-2026', revealAckAt: ACK_AT };
        const betaPending = {
            id: 'bravo-2026',
            name: 'Beta',
            email: 'beta@example.test',
            recipientId: 'charlie-2026',
            gifterId: 'alpha-2026',
            drawMode: 'auto',
            revealAckRecipientId: null,
            revealAckAt: null,
        };
        const manualAssigned = {
            id: 'alpha-2026',
            name: 'Alpha',
            email: 'alpha@example.test',
            recipientId: 'bravo-2026',
            gifterId: 'charlie-2026',
        };
        const ACK_REQUEST = { year: 2026, epoch: 2, userId: 'alpha-2026', recipientId: 'bravo-2026' };

        let unhandled;
        let routes;

        function makeUser({ uid = 'uid-alpha', email = 'alpha@example.test', token = 'token-alpha' } = {}) {
            return { uid, email, getIdToken: jest.fn(() => Promise.resolve(token)) };
        }

        function ackResponse(status, body) {
            return { ok: status >= 200 && status < 300, status, json: async () => body };
        }

        function ackBody(overrides = {}) {
            return { success: true, changed: true, ...ACK_REQUEST, acknowledgedAt: ACK_AT, ...overrides };
        }

        function fetchCalls(url) {
            return global.fetch.mock.calls.filter(([calledUrl]) => calledUrl === url);
        }

        function profileSnapshot(data, fromCache = false) {
            return { exists: () => true, data: () => data, metadata: { fromCache } };
        }

        // Handlers are attached at once so that no rejection is ever unhandled across clock advances.
        function track(promise) {
            const run = { promise, done: false, value: undefined, error: undefined };
            run.settled = promise.then(
                (value) => {
                    run.done = true;
                    run.value = value;
                    return value;
                },
                (error) => {
                    run.done = true;
                    run.error = error;
                    return undefined;
                }
            );
            return run;
        }

        async function start(latest) {
            let run;
            await act(async () => {
                run = track(latest.c0.acknowledgeReveal());
            });
            await flush();
            return run;
        }

        async function advance(ms) {
            await act(async () => { jest.advanceTimersByTime(ms); });
            await flush();
        }

        async function signedIn(firebaseUser = makeUser()) {
            const utils = renderWithConsumers();
            await signIn(firebaseUser);
            return { ...utils, alpha: firebaseUser };
        }

        beforeEach(() => {
            unhandled = jest.fn();
            process.on('unhandledRejection', unhandled);
            routes = {
                bootstrap: () => ok(autoPending, SEASON_2026),
                acknowledge: () => Promise.resolve(ackResponse(200, ackBody())),
            };
            global.fetch.mockImplementation((url, init) => {
                if (url === BOOT_URL) return routes.bootstrap(init);
                if (url === ACK_URL) return routes.acknowledge(init);
                return Promise.reject(new Error(`unexpected request ${url}`));
            });
        });

        afterEach(async () => {
            jest.useRealTimers();
            // One real macrotask so that Node reports any rejection the test left unhandled.
            await new Promise((resolve) => setTimeout(resolve, 0));
            process.off('unhandledRejection', unhandled);
            expect(unhandled).not.toHaveBeenCalled();
        });

        describe('operation', () => {
            test('O1 request shape; a 200 publishes both ack fields and resolves acknowledged; no listener is added or removed', async () => {
                const { latest, alpha } = await signedIn();
                expect(latest.c0.user).toEqual(autoPending);
                expect(getRevealState(latest.c0.user)).toBe('pending');
                const listenerCount = mockSnapshots.length;
                const unsubscribeCounts = mockSnapshots.map((entry) => entry.unsubscribe.mock.calls.length);
                alpha.getIdToken.mockClear();

                const run = await start(latest);

                expect(alpha.getIdToken).toHaveBeenCalledTimes(1);
                expect(alpha.getIdToken).toHaveBeenCalledWith(false);
                const calls = fetchCalls(ACK_URL);
                expect(calls).toHaveLength(1);
                const [, init] = calls[0];
                expect(init.method).toBe('POST');
                expect(init.headers).toEqual({ Authorization: 'Bearer token-alpha', 'Content-Type': 'application/json' });
                expect(JSON.parse(init.body)).toEqual(ACK_REQUEST);
                expect(run.value).toEqual({ status: 'acknowledged' });
                expect(latest.c0.user).toEqual(autoAcked);
                expect(getRevealState(latest.c0.user)).toBe('acknowledged');
                expect(mockSnapshots).toHaveLength(listenerCount);
                mockSnapshots.forEach((entry, i) => {
                    expect(entry.unsubscribe.mock.calls.length).toBe(unsubscribeCounts[i]);
                });
            });

            test.each([
                ['a manual profile', () => ok(manualAssigned, SEASON_2026)],
                ['an acknowledged profile', () => ok(autoAcked, SEASON_2026)],
                ['an invalid profile', () => ok({ ...autoPending, recipientId: null }, SEASON_2026)],
                ['a closed season', () => ok(autoPending, SEASON_CLOSED_2026)],
            ])('O2 %s resolves stale with no token request and no fetch', async (_label, bootstrap) => {
                routes.bootstrap = bootstrap;
                const { latest, alpha } = await signedIn();
                expect(latest.c0.user).not.toBeNull();
                alpha.getIdToken.mockClear();
                global.fetch.mockClear();

                const run = await start(latest);

                expect(run.value).toEqual({ status: 'stale' });
                expect(alpha.getIdToken).not.toHaveBeenCalled();
                expect(global.fetch).not.toHaveBeenCalled();
            });

            test('O3 two calls for the same scope while one is in flight share one promise and one fetch', async () => {
                const held = deferred();
                routes.acknowledge = () => held.promise;
                const { latest } = await signedIn();

                let first;
                let second;
                let run;
                await act(async () => {
                    first = latest.c0.acknowledgeReveal();
                    run = track(first);
                    second = latest.c0.acknowledgeReveal();
                });
                await flush();

                expect(second).toBe(first);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                expect(run.done).toBe(false);

                held.resolve(ackResponse(200, ackBody()));
                await flush();

                expect(run.value).toEqual({ status: 'acknowledged' });
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
            });

            test.each([
                ['a 500', { acknowledge: () => Promise.resolve(ackResponse(500, { code: 'INTERNAL' })) }, 'INTERNAL'],
                ['a 400', { acknowledge: () => Promise.resolve(ackResponse(400, { code: 'INVALID_REQUEST' })) }, 'INVALID_REQUEST'],
                ['a rejected fetch', { acknowledge: () => Promise.reject(new TypeError('offline')) }, 'NETWORK'],
                ['a rejected token', { token: () => Promise.reject(new Error('token unavailable')) }, 'NETWORK'],
                ['a 200 with a missing echo', {
                    acknowledge: () => Promise.resolve(ackResponse(200, { success: true, changed: true, acknowledgedAt: ACK_AT })),
                }, 'REQUEST_FAILED'],
                ['a 200 with a mismatched echo', {
                    acknowledge: () => Promise.resolve(ackResponse(200, ackBody({ recipientId: 'delta-2026' }))),
                }, 'REQUEST_FAILED'],
            ])('O4 while live, %s gives failed; the user is unchanged; a later call sends a new request and succeeds', async (_label, failure, code) => {
                const { latest, alpha } = await signedIn();
                const before = latest.c0.user;
                if (failure.acknowledge) {
                    routes.acknowledge = failure.acknowledge;
                }
                if (failure.token) {
                    alpha.getIdToken.mockImplementationOnce(failure.token);
                }

                const failed = await start(latest);

                expect(failed.value).toEqual({ status: 'failed', code });
                expect(latest.c0.user).toBe(before);
                const failedFetches = fetchCalls(ACK_URL).length;
                expect(failedFetches).toBe(failure.token ? 0 : 1);

                routes.acknowledge = () => Promise.resolve(ackResponse(200, ackBody()));
                const retried = await start(latest);

                expect(retried.value).toEqual({ status: 'acknowledged' });
                expect(fetchCalls(ACK_URL)).toHaveLength(failedFetches + 1);
                expect(latest.c0.user).toEqual(autoAcked);
            });

            test('O4 a non-string token gives failed with no fetch', async () => {
                const { latest, alpha } = await signedIn();
                alpha.getIdToken.mockImplementationOnce(() => Promise.resolve(undefined));

                const run = await start(latest);

                expect(run.value).toEqual({ status: 'failed', code: 'AUTH' });
                expect(fetchCalls(ACK_URL)).toHaveLength(0);
                expect(latest.c0.user).toEqual(autoPending);
            });

            test('O5 a token that never settles: TIMEOUT at 15 000 ms and not before; no fetch, even after a late token', async () => {
                jest.useFakeTimers();
                const { latest, alpha } = await signedIn();
                const token = deferred();
                alpha.getIdToken.mockImplementationOnce(() => token.promise);

                const run = await start(latest);
                await advance(TIMEOUT_MS - 1);
                expect(run.done).toBe(false);
                await advance(1);

                expect(run.value).toEqual({ status: 'failed', code: 'TIMEOUT' });
                expect(fetchCalls(ACK_URL)).toHaveLength(0);

                token.resolve('token-alpha');
                await flush();

                expect(fetchCalls(ACK_URL)).toHaveLength(0);
                expect(latest.c0.user).toEqual(autoPending);
            });

            test('O6 a fetch that never settles and ignores abort: TIMEOUT at 15 000 ms, the signal is aborted, a late 200 starts nothing; the listener then publishes', async () => {
                jest.useFakeTimers();
                const held = deferred();
                let signal = null;
                routes.acknowledge = (init) => {
                    signal = init.signal;
                    return held.promise;
                };
                const { latest, alpha } = await signedIn();

                const run = await start(latest);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                expect(signal.aborted).toBe(false);
                await advance(TIMEOUT_MS - 1);
                expect(run.done).toBe(false);
                await advance(1);

                expect(run.value).toEqual({ status: 'failed', code: 'TIMEOUT' });
                expect(signal.aborted).toBe(true);

                const fetches = global.fetch.mock.calls.length;
                const tokens = alpha.getIdToken.mock.calls.length;
                held.resolve(ackResponse(200, ackBody()));
                await flush();

                expect(latest.c0.user).toEqual(autoPending);
                expect(global.fetch.mock.calls.length).toBe(fetches);
                expect(alpha.getIdToken.mock.calls.length).toBe(tokens);

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot(autoAcked));
                expect(latest.c0.user).toEqual(autoAcked);
            });

            test('O7 a body that never settles and ignores abort: TIMEOUT at 15 000 ms; the late body publishes and starts nothing', async () => {
                jest.useFakeTimers();
                const body = deferred();
                routes.acknowledge = () => Promise.resolve({ ok: true, status: 200, json: () => body.promise });
                const { latest, alpha } = await signedIn();

                const run = await start(latest);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                await advance(TIMEOUT_MS - 1);
                expect(run.done).toBe(false);
                await advance(1);

                expect(run.value).toEqual({ status: 'failed', code: 'TIMEOUT' });

                const fetches = global.fetch.mock.calls.length;
                const tokens = alpha.getIdToken.mock.calls.length;
                body.resolve(ackBody());
                await flush();

                expect(latest.c0.user).toEqual(autoPending);
                expect(global.fetch.mock.calls.length).toBe(fetches);
                expect(alpha.getIdToken.mock.calls.length).toBe(tokens);
            });

            test.each([
                [401, 'UNAUTHENTICATED'],
                [409, 'REVEAL_STALE'],
                [403, 'ACCESS_DENIED'],
            ])('O8 after a timeout, a late %i starts no token request, no fetch and no bootstrap', async (status, code) => {
                jest.useFakeTimers();
                const held = deferred();
                routes.acknowledge = () => held.promise;
                const { latest, alpha } = await signedIn();

                const run = await start(latest);
                await advance(TIMEOUT_MS);
                expect(run.value).toEqual({ status: 'failed', code: 'TIMEOUT' });
                const tokens = alpha.getIdToken.mock.calls.length;
                const acks = fetchCalls(ACK_URL).length;
                const boots = fetchCalls(BOOT_URL).length;

                held.resolve(ackResponse(status, { code, error: 'Nope' }));
                await flush();
                await advance(TIMEOUT_MS);

                expect(alpha.getIdToken.mock.calls.length).toBe(tokens);
                expect(fetchCalls(ACK_URL)).toHaveLength(acks);
                expect(fetchCalls(BOOT_URL)).toHaveLength(boots);
                expect(latest.c0.user).toEqual(autoPending);
            });

            test('O9 a 401 retries once with a forced token under the same deadline: TIMEOUT at 15 000 ms in total', async () => {
                jest.useFakeTimers();
                const first = deferred();
                const second = deferred();
                const pending = [first, second];
                routes.acknowledge = () => pending.shift().promise;
                const { latest, alpha } = await signedIn();
                alpha.getIdToken.mockClear();

                const run = await start(latest);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                await advance(5000);
                first.resolve(ackResponse(401, { code: 'UNAUTHENTICATED' }));
                await flush();

                expect(alpha.getIdToken.mock.calls).toEqual([[false], [true]]);
                expect(fetchCalls(ACK_URL)).toHaveLength(2);
                await advance(TIMEOUT_MS - 5000 - 1);
                expect(run.done).toBe(false);
                await advance(1);

                expect(run.value).toEqual({ status: 'failed', code: 'TIMEOUT' });

                second.resolve(ackResponse(200, ackBody()));
                await flush();
                expect(latest.c0.user).toEqual(autoPending);
                expect(fetchCalls(ACK_URL)).toHaveLength(2);
            });

            test('O9 a second 401 gives failed UNAUTHENTICATED after exactly two fetches', async () => {
                routes.acknowledge = () => Promise.resolve(ackResponse(401, { code: 'UNAUTHENTICATED' }));
                const { latest, alpha } = await signedIn();
                alpha.getIdToken.mockClear();

                const run = await start(latest);
                await flush();

                expect(run.value).toEqual({ status: 'failed', code: 'UNAUTHENTICATED' });
                expect(fetchCalls(ACK_URL)).toHaveLength(2);
                expect(alpha.getIdToken.mock.calls).toEqual([[false], [true]]);
            });

            test('O9 a scope change between the 401 and the forced token gives no second fetch', async () => {
                routes.acknowledge = () => Promise.resolve(ackResponse(401, { code: 'UNAUTHENTICATED' }));
                const { latest, alpha } = await signedIn();
                const forced = deferred();
                alpha.getIdToken.mockImplementation((forceRefresh) => (
                    forceRefresh ? forced.promise : Promise.resolve('token-alpha')
                ));

                const run = await start(latest);
                expect(alpha.getIdToken).toHaveBeenLastCalledWith(true);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                expect(run.done).toBe(false);

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoPending, recipientId: 'delta-2026' }));
                expect(run.value).toEqual({ status: 'stale' });

                forced.resolve('token-alpha-forced');
                await flush();

                expect(fetchCalls(ACK_URL)).toHaveLength(1);
            });

            test.each([
                [409, 'REVEAL_STALE'],
                [403, 'ACCESS_DENIED'],
            ])('O10 a live %i gives failed with the server code and starts exactly one refresh bootstrap', async (status, code) => {
                routes.acknowledge = () => Promise.resolve(ackResponse(status, { code, error: 'Nope' }));
                const { latest } = await signedIn();
                const boots = fetchCalls(BOOT_URL).length;

                const run = await start(latest);
                await flush();

                expect(run.value).toEqual({ status: 'failed', code });
                expect(fetchCalls(BOOT_URL)).toHaveLength(boots + 1);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                expect(latest.c0.user).toEqual(autoPending);
            });

            const ABANDON_SCENARIOS = [
                ['sign-out', async () => {
                    await act(async () => { mockAuthCallback(null); });
                    await flush();
                }],
                ['an account switch', async () => {
                    routes.bootstrap = (init) => (init.headers.Authorization === 'Bearer token-beta'
                        ? ok(betaPending, SEASON_2026)
                        : ok(autoPending, SEASON_2026));
                    await signIn(makeUser({ uid: 'uid-beta', email: 'beta@example.test', token: 'token-beta' }));
                }],
                ['a server-confirmed lifecycle change', async () => {
                    routes.bootstrap = () => ok(autoPending, SEASON_CLOSED_2026);
                    await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_CLOSED_2026));
                }],
                ['a server-confirmed missing profile', async () => {
                    await deliver(lastSnapshotFor('alpha-2026'), { exists: () => false, metadata: { fromCache: false } });
                }],
                ['a snapshot that changes the recipient', async () => {
                    await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoPending, recipientId: 'delta-2026' }));
                }],
                ['unmount', async ({ unmount }) => {
                    unmount();
                    await flush();
                }],
            ];
            const ABANDON_CASES = ABANDON_SCENARIOS.flatMap(([name, abandon]) => (
                [200, 401, 409].map((status) => [name, status, abandon])
            ));

            test.each(ABANDON_CASES)('O11 %s with the fetch held: stale at once and the signal aborted; a late %i does nothing', async (name, status, abandon) => {
                jest.useFakeTimers();
                const held = deferred();
                let signal = null;
                routes.acknowledge = (init) => {
                    signal = init.signal;
                    return held.promise;
                };
                const utils = await signedIn();
                const { latest, alpha } = utils;

                const run = await start(latest);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);
                expect(run.done).toBe(false);

                // No clock advance: abandonment settles the operation by itself.
                await abandon(utils);

                expect(run.value).toEqual({ status: 'stale' });
                expect(signal.aborted).toBe(true);
                if (name === 'sign-out' || name === 'unmount') {
                    // jest.getTimerCount() also counts the fake microtask queue: each awaited
                    // act(async () => ...) leaves one fake queueMicrotask job (React's DEV
                    // "act was not awaited" check). Drain only that queue: runAllTicks runs
                    // queued microtasks, never advances the clock and never runs or clears
                    // a timeout or interval, so any timer left by the operation still counts.
                    const now = Date.now();
                    jest.runAllTicks();
                    expect(Date.now()).toBe(now);
                    expect(jest.getTimerCount()).toBe(0);
                }
                const userAfter = latest.c0.user;
                const fetches = global.fetch.mock.calls.length;
                const tokens = alpha.getIdToken.mock.calls.length;

                await advance(TIMEOUT_MS);

                expect(run.value).toEqual({ status: 'stale' });
                expect(global.fetch.mock.calls.length).toBe(fetches);
                expect(alpha.getIdToken.mock.calls.length).toBe(tokens);

                held.resolve(ackResponse(status, status === 200
                    ? ackBody()
                    : { code: status === 401 ? 'UNAUTHENTICATED' : 'REVEAL_STALE', error: 'Nope' }));
                await flush();
                await advance(TIMEOUT_MS);

                expect(global.fetch.mock.calls.length).toBe(fetches);
                expect(alpha.getIdToken.mock.calls.length).toBe(tokens);
                expect(latest.c0.user).toBe(userAfter);
                if (userAfter) {
                    expect(getRevealState(userAfter)).not.toBe('acknowledged');
                }
            });

            test('O12 the listener confirms mid-flight: acknowledged at once, the signal aborted, the late response ignored', async () => {
                const held = deferred();
                let signal = null;
                routes.acknowledge = (init) => {
                    signal = init.signal;
                    return held.promise;
                };
                const { latest } = await signedIn();

                const run = await start(latest);
                expect(run.done).toBe(false);

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot(autoAcked));

                expect(run.value).toEqual({ status: 'acknowledged' });
                expect(signal.aborted).toBe(true);
                expect(latest.c0.user).toEqual(autoAcked);
                const userAfter = latest.c0.user;
                const fetches = global.fetch.mock.calls.length;

                held.resolve(ackResponse(200, ackBody({ acknowledgedAt: '2026-11-12T00:00:00.000Z' })));
                await flush();

                expect(latest.c0.user).toBe(userAfter);
                expect(global.fetch.mock.calls.length).toBe(fetches);
            });

            test('O13 a newer operation is isolated from an older one', async () => {
                jest.useFakeTimers();
                const heldA = deferred();
                const heldB = deferred();
                const pending = [heldA, heldB];
                routes.acknowledge = () => pending.shift().promise;
                const { latest } = await signedIn();

                // A starts at t = 0 (deadline 15 s) for recipient R1.
                const runA = await start(latest);
                expect(fetchCalls(ACK_URL)).toHaveLength(1);

                // The recipient changes to R2 at t = 5 s: A ends stale.
                await advance(5000);
                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoPending, recipientId: 'delta-2026' }));
                expect(runA.value).toEqual({ status: 'stale' });
                const userR2 = latest.c0.user;
                expect(getRevealState(userR2)).toBe('pending');

                // B starts at t = 5 s (deadline 20 s) for R2.
                const runB = await start(latest);
                expect(fetchCalls(ACK_URL)).toHaveLength(2);
                expect(JSON.parse(fetchCalls(ACK_URL)[1][1].body)).toEqual({ ...ACK_REQUEST, recipientId: 'delta-2026' });

                // A's late 200, then past A's original deadline but before B's.
                heldA.resolve(ackResponse(200, ackBody()));
                await flush();
                await advance(TIMEOUT_MS - 5000 + 1);

                expect(runB.done).toBe(false);
                let third;
                await act(async () => {
                    third = latest.c0.acknowledgeReveal();
                });
                expect(third).toBe(runB.promise);
                expect(fetchCalls(ACK_URL)).toHaveLength(2);
                expect(latest.c0.user).toBe(userR2);

                heldB.resolve(ackResponse(200, ackBody({ recipientId: 'delta-2026' })));
                await flush();

                expect(runB.value).toEqual({ status: 'acknowledged' });
                expect(latest.c0.user).toMatchObject({
                    recipientId: 'delta-2026',
                    revealAckRecipientId: 'delta-2026',
                    revealAckAt: ACK_AT,
                });
            });
        });

        describe('monotonic acknowledgment', () => {
            test.each([
                ['M1 server-flagged', false],
                ['M2 cached', true],
            ])('%s: after API success, a pending snapshot for the same recipient keeps the acknowledgment and the same object', async (_label, fromCache) => {
                const { latest } = await signedIn();
                const run = await start(latest);
                expect(run.value).toEqual({ status: 'acknowledged' });
                const acked = latest.c0.user;

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot(autoPending, fromCache));

                expect(latest.c0.user).toBe(acked);
                expect(getRevealState(latest.c0.user)).toBe('acknowledged');
            });

            test('M3 a refresh bootstrap held from before the acknowledgment and released after it with a pending body keeps it', async () => {
                const { latest } = await signedIn();
                const heldBoot = deferred();
                routes.bootstrap = () => heldBoot.promise;
                await act(async () => { await latest.c0.refreshUser(); });
                await flush();
                expect(fetchCalls(BOOT_URL)).toHaveLength(2);

                const run = await start(latest);
                expect(run.value).toEqual({ status: 'acknowledged' });

                heldBoot.resolve(okBody(autoPending, SEASON_2026));
                await flush();

                expect(getRevealState(latest.c0.user)).toBe('acknowledged');
                expect(latest.c0.user).toMatchObject({ revealAckRecipientId: 'bravo-2026', revealAckAt: ACK_AT });
            });

            test('M4 acknowledged from the initial bootstrap, then a cached pending snapshot, then an acknowledged snapshot: acknowledged throughout', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                const acked = latest.c0.user;
                expect(getRevealState(acked)).toBe('acknowledged');

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot(autoPending, true));
                expect(latest.c0.user).toBe(acked);

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot(autoAcked, false));
                expect(latest.c0.user).toBe(acked);
                expect(getRevealState(latest.c0.user)).toBe('acknowledged');
            });

            test.each([
                ['cached', true],
                ['server-flagged', false],
            ])('M5 pending, then a %s snapshot carrying the acknowledgment is published', async (_label, fromCache) => {
                const { latest } = await signedIn();

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot(autoAcked, fromCache));

                expect(latest.c0.user).toEqual(autoAcked);
            });

            test('M6 a changed recipient through a snapshot replaces the user and reads as pending', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                const before = latest.c0.user;

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoAcked, recipientId: 'delta-2026' }));

                expect(latest.c0.user).not.toBe(before);
                expect(latest.c0.user).toMatchObject({ recipientId: 'delta-2026', revealAckRecipientId: 'bravo-2026' });
                expect(getRevealState(latest.c0.user)).toBe('pending');
            });

            test('M6 a changed recipient through a bootstrap response reads as pending', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                routes.bootstrap = () => ok({ ...autoAcked, recipientId: 'delta-2026' }, SEASON_2026);

                await act(async () => { await latest.c0.refreshUser(); });
                await flush();

                expect(latest.c0.user).toMatchObject({ recipientId: 'delta-2026', revealAckRecipientId: 'bravo-2026' });
                expect(getRevealState(latest.c0.user)).toBe('pending');
            });

            test('M7 account isolation: account B is pending even with the same profile and recipient ids', async () => {
                routes.bootstrap = (init) => (init.headers.Authorization === 'Bearer token-beta'
                    ? ok({ ...autoPending, email: 'beta@example.test' }, SEASON_2026)
                    : ok(autoAcked, SEASON_2026));
                const { latest } = await signedIn();
                expect(getRevealState(latest.c0.user)).toBe('acknowledged');

                await signIn(makeUser({ uid: 'uid-beta', email: 'beta@example.test', token: 'token-beta' }));

                expect(latest.c0.authUid).toBe('uid-beta');
                expect(getRevealState(latest.c0.user)).toBe('pending');
            });

            test('M7 year isolation: a server-confirmed Start and a 2027 bootstrap with a new pending profile read as pending', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2026));
                expect(getRevealState(latest.c0.user)).toBe('acknowledged');
                const pending2027 = { ...autoPending, id: 'alpha-2027', recipientId: 'bravo-2027', gifterId: 'echo-2027' };
                routes.bootstrap = () => ok(pending2027, SEASON_2027);

                await deliver(lastLifecycle(), serverLifecycle(LIFECYCLE_2027));

                expect(latest.c0.season).toEqual({ year: 2027, state: 'active', epoch: 3, closedYears: [2025, 2026] });
                expect(latest.c0.user).toEqual(pending2027);
                expect(getRevealState(latest.c0.user)).toBe('pending');
            });

            test('M7 profile isolation: a bootstrap for the same account with a different profile id reads as pending', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                routes.bootstrap = () => ok({ ...autoPending, id: 'alpha-2026-other' }, SEASON_2026);

                await act(async () => { await latest.c0.refreshUser(); });
                await flush();

                expect(latest.c0.user.id).toBe('alpha-2026-other');
                expect(getRevealState(latest.c0.user)).toBe('pending');
            });

            test('M8 acknowledged, then a snapshot with an unknown drawMode: the user is replaced and reads as invalid', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                const before = latest.c0.user;

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoAcked, drawMode: 'other' }));

                expect(latest.c0.user).not.toBe(before);
                expect(latest.c0.user.drawMode).toBe('other');
                expect(getRevealState(latest.c0.user)).toBe('invalid');
            });
        });

        describe('change detection', () => {
            test('D1 a snapshot that only adds drawMode auto to an assigned manual profile replaces the user (now pending)', async () => {
                routes.bootstrap = () => ok(manualAssigned, SEASON_2026);
                const { latest } = await signedIn();
                const before = latest.c0.user;
                expect(getRevealState(before)).toBe('manual');

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...manualAssigned, drawMode: 'auto' }));

                expect(latest.c0.user).not.toBe(before);
                expect(getRevealState(latest.c0.user)).toBe('pending');
            });

            test('D2 a snapshot that only changes drawMode from auto to another value replaces the user (now invalid)', async () => {
                const { latest } = await signedIn();
                const before = latest.c0.user;
                expect(getRevealState(before)).toBe('pending');

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoPending, drawMode: 'other' }));

                expect(latest.c0.user).not.toBe(before);
                expect(getRevealState(latest.c0.user)).toBe('invalid');
            });

            test('D3 a snapshot that differs only in revealAckAt, or only in an unrelated field, keeps the same user object', async () => {
                routes.bootstrap = () => ok(autoAcked, SEASON_2026);
                const { latest } = await signedIn();
                const before = latest.c0.user;

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoAcked, revealAckAt: '2026-12-01T00:00:00.000Z' }));
                expect(latest.c0.user).toBe(before);

                await deliver(lastSnapshotFor('alpha-2026'), profileSnapshot({ ...autoAcked, image: 'new-image.jpg' }));
                expect(latest.c0.user).toBe(before);
            });
        });
    });
});
