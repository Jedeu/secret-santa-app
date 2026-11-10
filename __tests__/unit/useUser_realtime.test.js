/**
 * @jest-environment jsdom
 *
 * UserProvider / useUser: single auth+profile owner.
 * - one bootstrap per auth generation regardless of consumer count
 * - stale bootstrap responses (sign-out, account switch) are ignored
 * - assignment snapshots keep updating `user` after refreshes and re-bootstraps
 * - profile loss (server-confirmed missing doc / permission-denied) re-bootstraps
 * - reset-in-progress retries with a notice; 403/409 surface as errors
 */

import { render, act } from '@testing-library/react';
import { UserProvider } from '@/context/UserContext';
import { useUser } from '@/hooks/useUser';
import { cancelOutboxDrains } from '@/lib/message-outbox';
import { cancelPushOperations } from '@/lib/push-client';
import { resetLastReadState } from '@/lib/lastReadClient';

let mockAuthCallback = null;
const mockSnapshots = []; // { ref, options, next, error, unsubscribe }

jest.mock('firebase/auth', () => ({
    onAuthStateChanged: (auth, callback) => {
        mockAuthCallback = callback;
        return jest.fn();
    },
}));

jest.mock('firebase/firestore', () => ({
    doc: (db, collection, id) => ({ path: `${collection}/${id}`, id }),
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
    getParticipantName: jest.fn((email) => {
        if (email === 'alpha@example.test') return 'Alpha';
        if (email === 'beta@example.test') return 'Beta';
        return null;
    }),
}));

jest.mock('@/lib/message-outbox', () => ({ cancelOutboxDrains: jest.fn() }));
jest.mock('@/lib/push-client', () => ({ cancelPushOperations: jest.fn() }));
jest.mock('@/lib/lastReadClient', () => ({ resetLastReadState: jest.fn() }));

const ALPHA = { uid: 'uid-alpha', email: 'alpha@example.test', getIdToken: jest.fn(() => Promise.resolve('token-alpha')) };
const BETA = { uid: 'uid-beta', email: 'beta@example.test', getIdToken: jest.fn(() => Promise.resolve('token-beta')) };

const alphaUser = { id: 'user-alpha', name: 'Alpha', email: 'alpha@example.test', recipientId: null, gifterId: null };
const betaUser = { id: 'user-beta', name: 'Beta', email: 'beta@example.test', recipientId: null, gifterId: null };

function response(status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
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

function renderWithConsumers(count = 1) {
    const latest = {};
    function Consumer({ name }) {
        latest[name] = useUser();
        return null;
    }
    const utils = render(
        <UserProvider>
            {Array.from({ length: count }, (_, i) => <Consumer key={i} name={`c${i}`} />)}
        </UserProvider>
    );
    return { ...utils, latest };
}

async function signIn(firebaseUser) {
    await act(async () => {
        mockAuthCallback(firebaseUser);
    });
    await flush();
}

function lastSnapshotFor(userId) {
    return [...mockSnapshots].reverse().find((entry) => entry.ref.id === userId);
}

describe('UserProvider / useUser', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthCallback = null;
        mockSnapshots.length = 0;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.fetch;
    });

    test('two consumers trigger exactly one bootstrap', async () => {
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers(2);

        await signIn(ALPHA);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/bootstrap', expect.objectContaining({
            method: 'POST',
            headers: { Authorization: 'Bearer token-alpha' },
        }));
        expect(latest.c0.user).toEqual(alphaUser);
        expect(latest.c1.user).toEqual(alphaUser);
        expect(latest.c0.authUid).toBe('uid-alpha');
        expect(latest.c0.loading).toBe(false);
    });

    test('a stale response after sign-out is ignored', async () => {
        const pending = deferred();
        global.fetch.mockImplementation(() => pending.promise);
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);
        await act(async () => { mockAuthCallback(null); });

        pending.resolve({ ok: true, status: 200, json: async () => ({ success: true, user: alphaUser }) });
        await flush();

        expect(latest.c0.user).toBeNull();
        expect(latest.c0.authUid).toBeNull();
        expect(latest.c0.loading).toBe(false);
    });

    test('a stale response after an account switch is ignored', async () => {
        const alphaPending = deferred();
        global.fetch
            .mockImplementationOnce(() => alphaPending.promise)
            .mockImplementationOnce(() => response(200, { success: true, user: betaUser }));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);
        await signIn(BETA);
        expect(latest.c0.user).toEqual(betaUser);

        alphaPending.resolve({ ok: true, status: 200, json: async () => ({ success: true, user: alphaUser }) });
        await flush();

        expect(latest.c0.user).toEqual(betaUser);
        expect(latest.c0.authUid).toBe('uid-beta');
    });

    test('an auth change calls the three cancels', async () => {
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        renderWithConsumers();
        jest.clearAllMocks();

        await signIn(ALPHA);

        expect(cancelOutboxDrains).toHaveBeenCalledTimes(1);
        expect(cancelPushOperations).toHaveBeenCalledTimes(1);
        expect(resetLastReadState).toHaveBeenCalledTimes(1);
    });

    test('a non-participant email gets ACCESS_DENIED without a request', async () => {
        const { latest } = renderWithConsumers();

        await signIn({ uid: 'uid-x', email: 'outsider@example.test', getIdToken: jest.fn() });

        expect(global.fetch).not.toHaveBeenCalled();
        expect(latest.c0.error).toMatchObject({ code: 'ACCESS_DENIED' });
        expect(latest.c0.user).toBeNull();
    });

    test('assignment snapshots still update the user after refreshUser()', async () => {
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        expect(mockSnapshots).toHaveLength(1);
        expect(mockSnapshots[0].options).toEqual({ includeMetadataChanges: true });

        await act(async () => { await latest.c0.refreshUser(); });
        await flush();

        // Same profile id: the subscription is untouched.
        expect(mockSnapshots).toHaveLength(1);

        await act(async () => {
            mockSnapshots[0].next({
                exists: () => true,
                metadata: { fromCache: false },
                data: () => ({ ...alphaUser, gifterId: 'user-beta', recipientId: 'user-gamma' }),
            });
        });

        expect(latest.c0.user.gifterId).toBe('user-beta');
        expect(latest.c0.user.recipientId).toBe('user-gamma');
    });

    test('non-assignment field changes keep the same user object', async () => {
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        const before = latest.c0.user;

        await act(async () => {
            mockSnapshots[0].next({
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
            .mockImplementationOnce(() => response(200, { success: true, user: alphaUser }))
            .mockImplementationOnce(() => response(200, { success: true, user: resetUser }));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        jest.clearAllMocks();

        await act(async () => {
            mockSnapshots[0].next({ exists: () => false, metadata: { fromCache: false } });
        });
        await flush();

        expect(cancelOutboxDrains).toHaveBeenCalled();
        expect(cancelPushOperations).toHaveBeenCalled();
        expect(resetLastReadState).toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(latest.c0.user.id).toBe('user-alpha-2');
        expect(mockSnapshots[0].unsubscribe).toHaveBeenCalled();

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
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        renderWithConsumers();
        await signIn(ALPHA);
        global.fetch.mockClear();

        await act(async () => {
            mockSnapshots[0].error({ code: 'permission-denied' });
        });
        await flush();

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('a cache-only miss is ignored', async () => {
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);
        global.fetch.mockClear();

        await act(async () => {
            mockSnapshots[0].next({ exists: () => false, metadata: { fromCache: true } });
        });
        await flush();

        expect(global.fetch).not.toHaveBeenCalled();
        expect(latest.c0.user).toEqual(alphaUser);
    });

    test('a snapshot delivered after cleanup is ignored', async () => {
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        const { latest, unmount } = renderWithConsumers();
        await signIn(ALPHA);
        const stale = mockSnapshots[0];
        const userBefore = latest.c0.user;
        global.fetch.mockClear();

        unmount();
        await act(async () => {
            stale.next({ exists: () => false, metadata: { fromCache: false } });
            stale.next({ exists: () => true, metadata: { fromCache: false }, data: () => ({ ...alphaUser, gifterId: 'x' }) });
        });
        await flush();

        expect(stale.unsubscribe).toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(latest.c0.user).toBe(userBefore);
    });

    test('other listener errors are logged', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch.mockImplementation(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers();
        await signIn(ALPHA);

        await act(async () => {
            mockSnapshots[0].error(new Error('unavailable'));
        });

        expect(latest.c0.user).toEqual(alphaUser);
        expect(spy).toHaveBeenCalledWith('[useUser] Error listening to user document:', expect.any(Error));
        spy.mockRestore();
    });

    test('503 RESET_IN_PROGRESS keeps loading with a notice and retries', async () => {
        jest.useFakeTimers();
        global.fetch
            .mockImplementationOnce(() => response(503, { code: 'RESET_IN_PROGRESS', error: 'reset' }))
            .mockImplementationOnce(() => response(503, { code: 'RESET_IN_PROGRESS', error: 'reset' }))
            .mockImplementationOnce(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);
        expect(latest.c0.loading).toBe(true);
        expect(latest.c0.notice).toBe('RESET_IN_PROGRESS');
        expect(latest.c0.authEmail).toBe('alpha@example.test');
        expect(global.fetch).toHaveBeenCalledTimes(1);

        await act(async () => { jest.advanceTimersByTime(1000); });
        await flush();
        expect(global.fetch).toHaveBeenCalledTimes(2);

        await act(async () => { jest.advanceTimersByTime(2000); });
        await flush();
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(latest.c0.loading).toBe(false);
        expect(latest.c0.notice).toBeNull();
        expect(latest.c0.user).toEqual(alphaUser);
    });

    test.each([
        [403, 'EMAIL_NOT_VERIFIED'],
        [409, 'PROFILE_CONFLICT'],
    ])('%i -> error state with user null', async (status, code) => {
        global.fetch.mockImplementation(() => response(status, { code, error: 'Nope' }));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);

        expect(latest.c0.error).toEqual({ code, message: 'Nope' });
        expect(latest.c0.user).toBeNull();
        expect(latest.c0.authUid).toBeNull();
        expect(latest.c0.loading).toBe(false);
    });

    test('a 401 retries once with a forced token refresh', async () => {
        global.fetch
            .mockImplementationOnce(() => response(401, { code: 'UNAUTHENTICATED' }))
            .mockImplementationOnce(() => response(200, { success: true, user: alphaUser }));
        const { latest } = renderWithConsumers();

        await signIn(ALPHA);

        expect(ALPHA.getIdToken).toHaveBeenCalledWith(true);
        expect(latest.c0.user).toEqual(alphaUser);
    });

    test('a refresh network failure keeps the ready state', async () => {
        jest.useFakeTimers();
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch.mockImplementationOnce(() => response(200, { success: true, user: alphaUser }));
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
    });
});
