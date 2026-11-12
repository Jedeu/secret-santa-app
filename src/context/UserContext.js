'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { clientAuth, firestore } from '@/lib/firebase-client';
import { isKnownParticipantEmail } from '@/lib/participants';
import { cancelOutboxDrains } from '@/lib/message-outbox';
import { cancelPushOperations } from '@/lib/push-client';
import { resetLastReadState } from '@/lib/lastReadClient';
import { resetTypingState } from '@/lib/typing-client';
import { clearYearArchiveCache } from '@/hooks/useYearArchive';
import { interpretLifecycle, lifecycleKey } from '@/lib/year-paths';
import { setWritableScope, yearDocRef } from '@/lib/year-client';
import { getRevealState } from '@/lib/recipient-reveal';

/**
 * Single owner of auth + profile + season state.
 *
 * Lifecycles:
 * - Auth generation: changes only on uid change, sign-out or unmount.
 * - Request sequence: one per bootstrap request; a response/retry applies only if the
 *   auth generation is unchanged and its sequence is the latest.
 * - Profile subscription: keyed on [authUid, user.id, season.year] with an effect-local
 *   active flag.
 * - Lifecycle subscription: one listener on system/lifecycle for the whole signed-in auth
 *   session. Only server-confirmed snapshots move the fence (confirmedKeyRef); a
 *   confirmed change while ready re-bootstraps. A listener that ends with an error is
 *   reattached at most once per accepted 2xx bootstrap (maybeReattachLifecycle).
 *
 * Publication: stateRef.current is authoritative and React state mirrors it. Every
 * publication also publishes the writable scope (src/lib/year-client.js), which is set
 * only while ready in an active year.
 *
 * Reveal acknowledgment: acknowledgeReveal() asks POST /api/reveal/acknowledge to record
 * the one-time recipient reveal for the published (account, profile, year, epoch,
 * recipient). One operation at a time, one 15 s deadline (including one 401 retry), and
 * a synchronous, idempotent settlement that fences every later token request, fetch,
 * bootstrap and publication. Every publication reconciles the operation in flight
 * (applyState). For one tuple the acknowledgment is monotonic within a page session:
 * bootstrap responses and profile snapshots never turn it back to pending
 * (keepAcknowledgment). The existing profile listener synchronizes it across tabs.
 *
 * The server (/api/auth/bootstrap) resolves or creates the UUID profile; the client
 * never queries or writes `users` to establish identity.
 */

const UserContext = createContext(null);

// Retry delays: 1s, 2s, 4s, then every 8s.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const MAX_TRANSIENT_ATTEMPTS = 5;
// Consecutive fenced-out bootstrap responses before the LIFECYCLE_MISMATCH error card.
const MAX_LIFECYCLE_MISMATCHES = 3;
const CLIENT_VERSION_HEADER = 'X-Secret-Santa-Client';
const CLIENT_VERSION = '2';
const REVEAL_ACK_URL = '/api/reveal/acknowledge';
const REVEAL_ACK_TIMEOUT_MS = 15000;

const SIGNED_OUT_STATE = {
    status: 'signed-out',
    user: null,
    authUid: null,
    authEmail: null,
    season: null,
    error: null,
};

function retryDelay(attempt) {
    return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function accessDeniedError(email) {
    return {
        code: 'ACCESS_DENIED',
        message: `Access denied. Email ${email} is not in the Secret Santa participants list.`
    };
}

/**
 * Writable scope for a published state: only while ready in an active year.
 */
function scopeFor(state) {
    if (state?.status !== 'ready' || !state.user?.id || !state.season || state.season.state !== 'active') {
        return null;
    }
    return {
        key: `${state.authUid}|${state.user.id}|${state.season.year}|${state.season.epoch}`,
        year: state.season.year,
    };
}

/**
 * Season from a 2xx bootstrap body, or null when the fields are invalid (transient).
 */
function parseSeason(data) {
    if (!Number.isInteger(data?.year) || !Number.isInteger(data?.epoch)) {
        return null;
    }
    if (data.yearState !== 'active' && data.yearState !== 'closed') {
        return null;
    }
    return {
        year: data.year,
        state: data.yearState,
        epoch: data.epoch,
        closedYears: Array.isArray(data.closedYears) ? [...data.closedYears] : [],
    };
}

function cancelSessionWork() {
    setWritableScope(null);
    cancelOutboxDrains();
    cancelPushOperations();
    resetLastReadState();
    resetTypingState();
    clearYearArchiveCache();
}

/**
 * Scope of a pending reveal for a published state, or null:
 * { authUid, userId, year, epoch, recipientId } when the state is ready, the season is
 * active and the user's reveal is pending.
 */
function revealScopeOf(state) {
    if (state?.status !== 'ready' || !state.user || !state.season || state.season.state !== 'active') {
        return null;
    }
    if (getRevealState(state.user) !== 'pending') {
        return null;
    }
    return {
        authUid: state.authUid,
        userId: state.user.id,
        year: state.season.year,
        epoch: state.season.epoch,
        recipientId: state.user.recipientId,
    };
}

/**
 * True when the state is ready in an active season with the same authUid, user.id,
 * season.year, season.epoch and user.recipientId as scope (pending or already
 * acknowledged).
 */
function matchesRevealScope(state, scope) {
    return !!scope
        && state?.status === 'ready'
        && !!state.user
        && !!state.season
        && state.season.state === 'active'
        && state.authUid === scope.authUid
        && state.user.id === scope.userId
        && state.season.year === scope.year
        && state.season.epoch === scope.epoch
        && state.user.recipientId === scope.recipientId;
}

/**
 * Acknowledgment is monotonic for one profile and recipient: an incoming pending user
 * keeps the held acknowledgment when the held user is the same profile with the same
 * recipient and already acknowledged. Anything else (including an incoming 'invalid' or
 * 'manual' profile) returns incomingUser unchanged.
 */
function keepAcknowledgment(heldUser, incomingUser) {
    if (!heldUser || !incomingUser) return incomingUser;
    if (heldUser.id !== incomingUser.id || heldUser.recipientId !== incomingUser.recipientId) {
        return incomingUser;
    }
    if (getRevealState(heldUser) !== 'acknowledged' || getRevealState(incomingUser) !== 'pending') {
        return incomingUser;
    }
    return {
        ...incomingUser,
        revealAckRecipientId: heldUser.revealAckRecipientId,
        revealAckAt: heldUser.revealAckAt ?? null,
    };
}

/**
 * Ends an acknowledgment operation. Synchronous and idempotent; awaits nothing.
 */
function settleRevealAck(holder, op, result) {
    if (op.settled) return;
    op.settled = true; // the abandonment fence
    clearTimeout(op.timer);
    try { op.controller?.abort(); } catch { /* ignore */ }
    if (holder.current === op) holder.current = null;
    op.resolve(result);
}

export function UserProvider({ children }) {
    const [state, setState] = useState({ ...SIGNED_OUT_STATE, status: 'loading' });

    const stateRef = useRef(state);
    const firebaseUserRef = useRef(null);
    const authGenerationRef = useRef(0);
    const requestSequenceRef = useRef(0);
    const retryTimerRef = useRef(null);
    const authInitializedRef = useRef(false);
    const mountedRef = useRef(true);

    // Lifecycle subscription, fence and reconciliation.
    const lifecycleSubRef = useRef({ id: 0, unsubscribe: null, ended: false, attachedAtSeq: 0 });
    const admissionSeqRef = useRef(0);
    const confirmedKeyRef = useRef(null);
    const mismatchCountRef = useRef(0);
    const handleProfileLossRef = useRef(null);

    // The reveal acknowledgment operation in flight (see acknowledgeReveal), or null.
    const revealAckRef = useRef(null);

    /**
     * Synchronous publication; the updater is pure and called exactly once.
     * Also reconciles the acknowledgment operation in flight: a publication that leaves
     * its scope abandons it ('stale'); one that shows it acknowledged settles it.
     */
    const applyState = useCallback((updater) => {
        const prev = stateRef.current;
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (next === prev) return;
        stateRef.current = next;
        setWritableScope(scopeFor(next));
        const op = revealAckRef.current;
        if (op) {
            if (!matchesRevealScope(next, op.scope)) {
                settleRevealAck(revealAckRef, op, { status: 'stale' });
            } else if (getRevealState(next.user) === 'acknowledged') {
                settleRevealAck(revealAckRef, op, { status: 'acknowledged' });
            }
        }
        if (mountedRef.current) setState(next);
    }, []);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    const unsubscribeLifecycle = useCallback(() => {
        const sub = lifecycleSubRef.current;
        sub.id += 1;
        const unsubscribe = sub.unsubscribe;
        sub.unsubscribe = null;
        if (typeof unsubscribe === 'function') {
            unsubscribe();
        }
    }, []);

    const subscribeLifecycleRef = useRef(null);

    /**
     * Reattach only if the listener has ended and a newer accepted bootstrap exists.
     * Called from the listener's error callback and from the 2xx bootstrap branch.
     */
    const maybeReattachLifecycle = useCallback(() => {
        const sub = lifecycleSubRef.current;
        if (firebaseUserRef.current && sub.ended && admissionSeqRef.current > sub.attachedAtSeq) {
            subscribeLifecycleRef.current?.();
        }
    }, []);

    const subscribeLifecycle = useCallback(() => {
        unsubscribeLifecycle();
        const sub = lifecycleSubRef.current;
        const id = sub.id;
        sub.ended = false;
        sub.attachedAtSeq = admissionSeqRef.current;
        if (!firestore) return;

        sub.unsubscribe = onSnapshot(
            doc(firestore, 'system', 'lifecycle'),
            { includeMetadataChanges: true },
            (snapshot) => {
                if (id !== lifecycleSubRef.current.id) return;
                // Cached data never moves the fence.
                if (snapshot?.metadata?.fromCache !== false) return;

                const liveKey = snapshot.exists() ? lifecycleKey(interpretLifecycle(snapshot.data())) : null;
                if (liveKey === confirmedKeyRef.current) return;

                // The fence follows the server in either direction.
                confirmedKeyRef.current = liveKey;
                mismatchCountRef.current = 0;

                const current = stateRef.current;
                if (current.status === 'ready' && lifecycleKey(current.season) !== liveKey) {
                    handleProfileLossRef.current?.();
                }
            },
            (error) => {
                if (id !== lifecycleSubRef.current.id) return;
                lifecycleSubRef.current.ended = true;
                console.warn('[useUser] Lifecycle listener stopped:', error);
                maybeReattachLifecycle();
            }
        );
    }, [unsubscribeLifecycle, maybeReattachLifecycle]);

    useEffect(() => {
        subscribeLifecycleRef.current = subscribeLifecycle;
    }, [subscribeLifecycle]);

    const runBootstrapRef = useRef(null);

    const scheduleRetry = useCallback((generation, sequence, mode, attempt) => {
        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!mountedRef.current
                || generation !== authGenerationRef.current
                || sequence !== requestSequenceRef.current) {
                return;
            }
            runBootstrapRef.current?.(mode, attempt + 1);
        }, retryDelay(attempt));
    }, [clearRetryTimer]);

    /**
     * mode: 'initial' (from loading) | 'refresh' (from ready)
     */
    const runBootstrap = useCallback((mode = 'initial', attempt = 0, forceRefreshToken = false, authRetried = false) => {
        const firebaseUser = firebaseUserRef.current;
        if (!firebaseUser) return;

        const generation = authGenerationRef.current;
        requestSequenceRef.current += 1;
        const sequence = requestSequenceRef.current;
        const isLatest = () => mountedRef.current
            && generation === authGenerationRef.current
            && sequence === requestSequenceRef.current;

        const handleTransient = (reason) => {
            if (attempt + 1 >= MAX_TRANSIENT_ATTEMPTS) {
                if (mode === 'refresh' && stateRef.current.status === 'ready') {
                    console.error('[useUser] Profile refresh failed:', reason);
                    return;
                }
                applyState((prev) => ({
                    ...prev,
                    status: 'error',
                    user: null,
                    authUid: null,
                    season: null,
                    error: { code: 'BOOTSTRAP_FAILED', message: 'Could not load your profile. Please try again.' },
                }));
                return;
            }
            scheduleRetry(generation, sequence, mode, attempt);
        };

        (async () => {
            let response;
            let data = null;
            try {
                const token = await firebaseUser.getIdToken(forceRefreshToken);
                if (!isLatest()) return;
                response = await fetch('/api/auth/bootstrap', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        [CLIENT_VERSION_HEADER]: CLIENT_VERSION,
                    },
                });
                if (!isLatest()) return;
                try {
                    data = await response.json();
                } catch {
                    data = null;
                }
                if (!isLatest()) return;
            } catch (networkError) {
                if (!isLatest()) return;
                handleTransient(networkError);
                return;
            }

            const season = response.ok ? parseSeason(data) : null;
            if (response.ok && data?.user?.id && season) {
                // An accepted 2xx proves the caller's identity record now exists.
                admissionSeqRef.current += 1;
                maybeReattachLifecycle();

                const confirmed = confirmedKeyRef.current;
                if (confirmed !== null && lifecycleKey(season) !== confirmed) {
                    // Fenced out: the response disagrees with the latest server-confirmed lifecycle.
                    cancelSessionWork(); // scope is null from here on
                    mismatchCountRef.current += 1;
                    if (mismatchCountRef.current >= MAX_LIFECYCLE_MISMATCHES) {
                        mismatchCountRef.current = 0;
                        applyState((prev) => ({
                            ...prev,
                            status: 'error',
                            user: null,
                            authUid: null,
                            season: null,
                            error: { code: 'LIFECYCLE_MISMATCH', message: 'The exchange changed while loading. Please try again.' },
                        }));
                        return;
                    }
                    applyState((prev) => ({
                        ...prev,
                        status: 'loading',
                        user: null,
                        authUid: null,
                        season: null,
                        error: null,
                    }));
                    scheduleRetry(generation, sequence, 'initial', mismatchCountRef.current - 1); // 1 s, then 2 s
                    return;
                }

                mismatchCountRef.current = 0;
                applyState((prev) => {
                    // Same account, year and epoch: a pending response for the same profile
                    // and recipient never undoes an acknowledgment already published.
                    const held = prev.status === 'ready' && prev.authUid === firebaseUser.uid
                        && prev.season?.year === season.year && prev.season?.epoch === season.epoch
                        ? prev.user
                        : null;
                    return {
                        ...prev,
                        status: 'ready',
                        user: keepAcknowledgment(held, data.user),
                        authUid: firebaseUser.uid,
                        season,
                        error: null,
                    };
                });
                return;
            }

            if (response.status === 401 && !authRetried) {
                runBootstrapRef.current?.(mode, attempt, true, true);
                return;
            }

            if (response.status === 403 || response.status === 409) {
                applyState((prev) => ({
                    ...prev,
                    status: 'error',
                    user: null,
                    authUid: null,
                    season: null,
                    error: {
                        code: data?.code || (response.status === 403 ? 'ACCESS_DENIED' : 'PROFILE_CONFLICT'),
                        message: data?.error || 'Your profile could not be loaded.',
                    },
                }));
                return;
            }

            // Includes a 2xx without valid season fields and a 503 (unavailable lifecycle).
            handleTransient(new Error(`Bootstrap failed with status ${response.status}`));
        })();
    }, [applyState, scheduleRetry, maybeReattachLifecycle]);

    useEffect(() => {
        runBootstrapRef.current = runBootstrap;
    }, [runBootstrap]);

    const startBootstrapNow = useCallback((mode) => {
        runBootstrapRef.current = runBootstrap;
        clearRetryTimer();
        runBootstrap(mode, 0);
    }, [clearRetryTimer, runBootstrap]);

    const handleProfileLoss = useCallback(() => {
        clearRetryTimer();
        cancelSessionWork();
        applyState((prev) => ({
            ...prev,
            status: 'loading',
            user: null,
            authUid: null,
            season: null,
            error: null,
        }));
        startBootstrapNow('initial');
    }, [applyState, clearRetryTimer, startBootstrapNow]);

    useEffect(() => {
        handleProfileLossRef.current = handleProfileLoss;
    }, [handleProfileLoss]);

    // Auth lifecycle
    useEffect(() => {
        // Restores the scope after a StrictMode remount.
        setWritableScope(scopeFor(stateRef.current));
        mountedRef.current = true;

        if (!clientAuth || !firestore) {
            // Defer state update to avoid synchronous setState in effect
            queueMicrotask(() => {
                if (mountedRef.current) {
                    applyState({ ...SIGNED_OUT_STATE });
                }
            });
            return () => {
                mountedRef.current = false;
                setWritableScope(null);
            };
        }

        // StrictMode remount with a user already known: restore the lifecycle listener.
        if (firebaseUserRef.current) {
            subscribeLifecycle();
        }

        const unsubscribe = onAuthStateChanged(clientAuth, (firebaseUser) => {
            const nextUid = firebaseUser?.uid ?? null;
            const previousUid = firebaseUserRef.current?.uid ?? null;
            firebaseUserRef.current = firebaseUser || null;

            // Same-uid callbacks after the first are ignored (generation unchanged).
            if (authInitializedRef.current && nextUid === previousUid) {
                return;
            }
            authInitializedRef.current = true;

            // New auth generation: synchronously invalidate everything from the old one.
            authGenerationRef.current += 1;
            clearRetryTimer();
            cancelSessionWork();

            unsubscribeLifecycle();
            confirmedKeyRef.current = null;
            mismatchCountRef.current = 0;
            admissionSeqRef.current = 0;
            if (firebaseUser) {
                subscribeLifecycle();
            }

            if (!firebaseUser) {
                applyState({ ...SIGNED_OUT_STATE });
                return;
            }

            const email = firebaseUser.email || '';
            applyState({
                status: 'loading',
                user: null,
                authUid: null,
                authEmail: email || null,
                season: null,
                error: null,
            });

            if (!email || !isKnownParticipantEmail(email)) {
                applyState((prev) => ({
                    ...prev,
                    status: 'error',
                    error: accessDeniedError(email),
                }));
                return;
            }

            startBootstrapNow('initial');
        });

        return () => {
            mountedRef.current = false;
            authGenerationRef.current += 1;
            clearRetryTimer();
            if (revealAckRef.current) {
                settleRevealAck(revealAckRef, revealAckRef.current, { status: 'stale' });
            }
            setWritableScope(null);
            unsubscribeLifecycle();
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [applyState, clearRetryTimer, startBootstrapNow, subscribeLifecycle, unsubscribeLifecycle]);

    const userId = state.user?.id ?? null;
    const authUid = state.authUid;
    const seasonYear = state.season?.year ?? null;

    // Profile subscription (assignment changes + profile-loss recovery), at the season's path
    useEffect(() => {
        if (!userId || !authUid || !seasonYear || !firestore) {
            return undefined;
        }

        let active = true;
        // Ignore callbacks once the published state has left this profile.
        const isCurrent = () => active && stateRef.current.user?.id === userId;
        const unsubscribe = onSnapshot(
            yearDocRef(seasonYear, 'users', userId),
            { includeMetadataChanges: true },
            (docSnapshot) => {
                if (!isCurrent()) return;

                if (docSnapshot.exists()) {
                    const updatedUser = docSnapshot.data() || {};
                    applyState((prev) => {
                        if (!active || !prev.user || prev.user.id !== userId) return prev;
                        // Cached or server-flagged alike: a pending snapshot for the same
                        // profile and recipient never undoes a published acknowledgment.
                        const next = keepAcknowledgment(prev.user, { ...updatedUser, id: updatedUser.id ?? userId });
                        const pairingChanged = prev.user.recipientId !== next.recipientId
                            || prev.user.gifterId !== next.gifterId;
                        const modeChanged = (prev.user.drawMode ?? null) !== (next.drawMode ?? null);
                        const ackChanged = (prev.user.revealAckRecipientId ?? null) !== (next.revealAckRecipientId ?? null);
                        // A revealAckAt-only difference is deliberately ignored.
                        if (!pairingChanged && !modeChanged && !ackChanged) return prev; // No change, avoid unnecessary re-renders
                        return { ...prev, user: next };
                    });
                    return;
                }

                if (docSnapshot.metadata?.fromCache === true) {
                    return; // Cache-only miss: wait for the server.
                }

                handleProfileLoss();
            },
            (error) => {
                if (!isCurrent()) return;
                if (error?.code === 'permission-denied') {
                    handleProfileLoss();
                    return;
                }
                console.error('[useUser] Error listening to user document:', error);
            }
        );

        return () => {
            active = false;
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [authUid, userId, seasonYear, applyState, handleProfileLoss]);

    // Expose user data on window for E2E testing in development mode
    useEffect(() => {
        if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
            window.__e2eUserData__ = state.user;
        }

        return () => {
            if (typeof window !== 'undefined') {
                delete window.__e2eUserData__;
            }
        };
    }, [state.user]);

    const refreshUser = useCallback(async () => {
        const firebaseUser = firebaseUserRef.current;
        if (!firebaseUser) return;

        const current = stateRef.current;
        if (current.status === 'error') {
            const email = firebaseUser.email || '';
            if (!email || !isKnownParticipantEmail(email)) {
                return; // Non-participant: no request.
            }
            applyState((prev) => ({
                ...prev,
                status: 'loading',
                user: null,
                authUid: null,
                season: null,
                error: null,
            }));
            startBootstrapNow('initial');
            return;
        }

        startBootstrapNow(current.status === 'ready' ? 'refresh' : 'initial');
    }, [applyState, startBootstrapNow]);

    /**
     * Confirm the one-time recipient reveal on the server for the published scope.
     *
     * Not async on purpose: a second call for the same scope while one is in flight
     * returns the exact same promise. The returned promise is the operation's own and
     * settles only through settleRevealAck (result, 15 s deadline, scope change or
     * unmount), never later. It never rejects.
     *
     * @returns {Promise<{ status: 'acknowledged'|'stale'|'failed', code?: string }>}
     */
    const acknowledgeReveal = useCallback(() => {
        const scope = revealScopeOf(stateRef.current);
        const firebaseUser = firebaseUserRef.current;
        if (!scope || !firebaseUser || firebaseUser.uid !== scope.authUid) {
            return Promise.resolve({ status: 'stale' });
        }

        const key = [scope.authUid, scope.userId, scope.year, scope.epoch, scope.recipientId].join('|');
        const held = revealAckRef.current;
        if (held && held.key === key) {
            return held.promise;
        }
        if (held) {
            settleRevealAck(revealAckRef, held, { status: 'stale' });
        }

        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        const op = {
            key,
            scope,
            generation: authGenerationRef.current,
            settled: false,
            retried: false,
            controller: typeof AbortController === 'function' ? new AbortController() : null,
            timer: null,
            resolve,
            promise,
        };
        op.timer = setTimeout(
            () => settleRevealAck(revealAckRef, op, { status: 'failed', code: 'TIMEOUT' }),
            REVEAL_ACK_TIMEOUT_MS
        );
        revealAckRef.current = op;

        const settle = (result) => settleRevealAck(revealAckRef, op, result);
        const isLive = () => !op.settled
            && mountedRef.current
            && op.generation === authGenerationRef.current
            && matchesRevealScope(stateRef.current, op.scope);
        // Checkpoint: false (and settled 'stale' if needed) when the operation has ended.
        const passes = () => {
            if (op.settled) return false;
            if (!isLive()) {
                settle({ status: 'stale' });
                return false;
            }
            return true;
        };

        // Every getIdToken, fetch and startBootstrapNow below runs in the same synchronous
        // block as a passed checkpoint, so none can start after the operation is settled.
        const work = async () => {
            let forceRefresh = false;
            for (;;) {
                let token;
                try {
                    token = await firebaseUser.getIdToken(forceRefresh);
                } catch {
                    if (op.settled) return;
                    settle({ status: 'failed', code: 'NETWORK' });
                    return;
                }

                // Checkpoint A: after the token, immediately before fetch.
                if (!passes()) return;
                if (typeof token !== 'string' || !token) {
                    settle({ status: 'failed', code: 'AUTH' });
                    return;
                }

                let response;
                try {
                    response = await fetch(REVEAL_ACK_URL, {
                        method: 'POST',
                        headers: {
                            Authorization: 'Bearer ' + token,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            year: scope.year,
                            epoch: scope.epoch,
                            userId: scope.userId,
                            recipientId: scope.recipientId,
                        }),
                        signal: op.controller ? op.controller.signal : undefined,
                    });
                } catch {
                    if (op.settled) return;
                    settle({ status: 'failed', code: 'NETWORK' });
                    return;
                }

                // Checkpoint B: after the headers.
                if (!passes()) return;

                let data = null;
                try {
                    data = await response.json();
                } catch {
                    data = null;
                }

                // Checkpoint C: after the body. Classification below is synchronous.
                if (!passes()) return;

                if (response.status === 401) {
                    if (op.retried) {
                        settle({ status: 'failed', code: 'UNAUTHENTICATED' });
                        return;
                    }
                    // One retry with a forced token, under the same deadline.
                    op.retried = true;
                    forceRefresh = true;
                    continue;
                }

                if (response.ok
                    && data?.success === true
                    && data.year === scope.year
                    && data.epoch === scope.epoch
                    && data.userId === scope.userId
                    && data.recipientId === scope.recipientId) {
                    const acknowledgedAt = typeof data.acknowledgedAt === 'string' ? data.acknowledgedAt : null;
                    applyState((prev) => (
                        matchesRevealScope(prev, op.scope) && getRevealState(prev.user) === 'pending'
                            ? {
                                ...prev,
                                user: {
                                    ...prev.user,
                                    revealAckRecipientId: op.scope.recipientId,
                                    revealAckAt: acknowledgedAt,
                                },
                            }
                            : prev
                    ));
                    settle({ status: 'acknowledged' });
                    return;
                }

                if (response.status === 403 || response.status === 409) {
                    startBootstrapNow('refresh');
                    settle({ status: 'failed', code: data?.code ?? 'CONFLICT' });
                    return;
                }

                // 400, 5xx, or a malformed or mismatched 2xx.
                settle({ status: 'failed', code: data?.code ?? 'REQUEST_FAILED' });
                return;
            }
        };

        work().catch(() => settle({ status: 'failed', code: 'NETWORK' }));
        return op.promise;
    }, [applyState, startBootstrapNow]);

    const value = useMemo(() => ({
        user: state.user,
        authUid: state.authUid,
        authEmail: state.authEmail,
        season: state.season,
        loading: state.status === 'loading',
        error: state.error,
        refreshUser,
        acknowledgeReveal,
    }), [state, refreshUser, acknowledgeReveal]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
}

export function useUserContext() {
    const context = useContext(UserContext);
    if (context === null) {
        throw new Error('useUserContext must be used within a UserProvider');
    }
    return context;
}
