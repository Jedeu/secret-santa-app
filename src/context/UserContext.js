'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { clientAuth, firestore } from '@/lib/firebase-client';
import { getParticipantName } from '@/lib/participants';
import { cancelOutboxDrains } from '@/lib/message-outbox';
import { cancelPushOperations } from '@/lib/push-client';
import { resetLastReadState } from '@/lib/lastReadClient';

/**
 * Single owner of auth + profile state.
 *
 * Three separate lifecycles:
 * - Auth generation: changes only on uid change, sign-out or unmount.
 * - Request sequence: one per bootstrap request; a response/retry applies only if the
 *   auth generation is unchanged and its sequence is the latest.
 * - Profile subscription: keyed on [authUid, user.id] with an effect-local active flag.
 *
 * The server (/api/auth/bootstrap) resolves or creates the UUID profile; the client
 * never queries or writes `users` to establish identity.
 */

const UserContext = createContext(null);

// Retry delays: 1s, 2s, 4s, then every 8s.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const MAX_TRANSIENT_ATTEMPTS = 5;

const SIGNED_OUT_STATE = {
    status: 'signed-out',
    user: null,
    authUid: null,
    authEmail: null,
    error: null,
    notice: null,
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

function cancelSessionWork() {
    cancelOutboxDrains();
    cancelPushOperations();
    resetLastReadState();
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

    const applyState = useCallback((updater) => {
        setState((prev) => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            stateRef.current = next;
            return next;
        });
    }, []);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

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
                    notice: null,
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
                    headers: { Authorization: `Bearer ${token}` },
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

            if (response.ok && data?.user?.id) {
                applyState((prev) => ({
                    ...prev,
                    status: 'ready',
                    user: data.user,
                    authUid: firebaseUser.uid,
                    error: null,
                    notice: null,
                }));
                return;
            }

            if (response.status === 401 && !authRetried) {
                runBootstrapRef.current?.(mode, attempt, true, true);
                return;
            }

            if (response.status === 503 && data?.code === 'RESET_IN_PROGRESS') {
                applyState((prev) => ({
                    ...prev,
                    status: 'loading',
                    user: null,
                    authUid: null,
                    error: null,
                    notice: 'RESET_IN_PROGRESS',
                }));
                // Unbounded: 1s, 2s, 4s, then every 8s; always from 'initial'.
                scheduleRetry(generation, sequence, 'initial', attempt);
                return;
            }

            if (response.status === 403 || response.status === 409) {
                applyState((prev) => ({
                    ...prev,
                    status: 'error',
                    user: null,
                    authUid: null,
                    notice: null,
                    error: {
                        code: data?.code || (response.status === 403 ? 'ACCESS_DENIED' : 'PROFILE_CONFLICT'),
                        message: data?.error || 'Your profile could not be loaded.',
                    },
                }));
                return;
            }

            handleTransient(new Error(`Bootstrap failed with status ${response.status}`));
        })();
    }, [applyState, scheduleRetry]);

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
            error: null,
        }));
        startBootstrapNow('initial');
    }, [applyState, clearRetryTimer, startBootstrapNow]);

    // Auth lifecycle
    useEffect(() => {
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
            };
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
                error: null,
                notice: null,
            });

            if (!email || !getParticipantName(email)) {
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
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [applyState, clearRetryTimer, startBootstrapNow]);

    const userId = state.user?.id ?? null;
    const authUid = state.authUid;

    // Profile subscription (assignment changes + profile-loss recovery)
    useEffect(() => {
        if (!userId || !authUid || !firestore) {
            return undefined;
        }

        let active = true;
        const unsubscribe = onSnapshot(
            doc(firestore, 'users', userId),
            { includeMetadataChanges: true },
            (docSnapshot) => {
                if (!active) return;

                if (docSnapshot.exists()) {
                    const updatedUser = docSnapshot.data() || {};
                    applyState((prev) => {
                        if (!active || !prev.user || prev.user.id !== userId) return prev;
                        if (prev.user.recipientId !== updatedUser.recipientId
                            || prev.user.gifterId !== updatedUser.gifterId) {
                            return { ...prev, user: { ...updatedUser, id: updatedUser.id ?? userId } };
                        }
                        return prev; // No change, avoid unnecessary re-renders
                    });
                    return;
                }

                if (docSnapshot.metadata?.fromCache === true) {
                    return; // Cache-only miss: wait for the server.
                }

                handleProfileLoss();
            },
            (error) => {
                if (!active) return;
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
    }, [authUid, userId, applyState, handleProfileLoss]);

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
            if (!email || !getParticipantName(email)) {
                return; // Non-participant: no request.
            }
            applyState((prev) => ({
                ...prev,
                status: 'loading',
                user: null,
                authUid: null,
                error: null,
                notice: null,
            }));
            startBootstrapNow('initial');
            return;
        }

        startBootstrapNow(current.status === 'ready' ? 'refresh' : 'initial');
    }, [applyState, startBootstrapNow]);

    const value = useMemo(() => ({
        user: state.user,
        authUid: state.authUid,
        authEmail: state.authEmail,
        loading: state.status === 'loading',
        error: state.error,
        notice: state.notice,
        refreshUser,
    }), [state, refreshUser]);

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
