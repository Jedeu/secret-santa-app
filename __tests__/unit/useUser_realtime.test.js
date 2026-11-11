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
});
