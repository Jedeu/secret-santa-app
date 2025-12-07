'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { clientAuth, firestore } from '@/lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, getDocs, limit, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { getParticipantName } from '@/lib/participants';

/**
 * Custom hook to manage Firebase Auth state and link to Firestore user
 * This implements the "handshake" logic to link Google OAuth users to hardcoded participants
 *
 * @returns {Object} - { user, loading, error, refreshUser }
 *   - user: Firestore user object (with UUID-based id, not Firebase uid)
 *   - loading: boolean indicating auth state check in progress
 *   - error: error object if access denied or other error
 *   - refreshUser: function to refresh user data from Firestore
 */
export function useUser() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const firebaseUserRef = useRef(null);

    // Function to fetch user data from Firestore
    const fetchUserData = useCallback(async (firebaseUser) => {
        if (!firebaseUser) {
            setUser(null);
            setError(null);
            return;
        }

        try {
            const email = firebaseUser.email;

            // 1. Check if email is in the allowed participants list
            const participantName = getParticipantName(email);

            if (!participantName) {
                // Not in the list -> Access Denied
                setUser(null);
                setError({
                    code: 'ACCESS_DENIED',
                    message: `Access denied. Email ${email} is not in the Secret Santa participants list.`
                });
                return;
            }

            // 2. Check if user already exists in Firestore
            const usersRef = collection(firestore, 'users');
            const q = query(usersRef, where('email', '==', email), limit(1));
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                // Match found: Use the Firestore user document
                const firestoreUser = snapshot.docs[0].data();
                setUser(firestoreUser);
                setError(null);
            } else {
                // 3. Valid participant but not in Firestore -> Auto-create
                console.log(`Auto-creating user for ${email}`);
                const newId = uuidv4();
                const newUser = {
                    id: newId,
                    name: participantName,
                    email: email,
                    oauthId: firebaseUser.uid,
                    image: firebaseUser.photoURL || null,
                    recipientId: null,
                    gifterId: null
                };

                try {
                    await setDoc(doc(firestore, 'users', newId), newUser);
                    setUser(newUser);
                    setError(null);
                } catch (createErr) {
                    console.error('Error creating user:', createErr);
                    setError({
                        code: 'CREATE_FAILED',
                        message: 'Failed to initialize user profile.'
                    });
                    setUser(null);
                }
            }
        } catch (err) {
            console.error('Error in useUser hook:', err);
            setError({
                code: 'UNKNOWN_ERROR',
                message: 'An error occurred while checking user access.'
            });
            setUser(null);
        }
    }, []);

    // Function to trigger a refresh of user data from Firestore
    const refreshUser = useCallback(async () => {
        if (firebaseUserRef.current) {
            await fetchUserData(firebaseUserRef.current);
        }
    }, [fetchUserData]);

    useEffect(() => {
        if (!clientAuth || !firestore) {
            // Defer state update to avoid synchronous setState in effect
            queueMicrotask(() => {
                setLoading(false);
            });
            return;
        }

        // Listen to Firebase Auth state changes
        const unsubscribe = onAuthStateChanged(clientAuth, async (firebaseUser) => {
            firebaseUserRef.current = firebaseUser;

            if (firebaseUser) {
                await fetchUserData(firebaseUser);
            } else {
                // User is signed out
                setUser(null);
                setError(null);
            }

            setLoading(false);
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, [fetchUserData]);

    // Set up realtime listener for user document to receive assignment changes
    // This is critical for receiving recipientId/gifterId updates from assignments
    useEffect(() => {
        if (!user?.id || !firestore) {
            return;
        }

        const userDocRef = doc(firestore, 'users', user.id);

        const unsubscribe = onSnapshot(
            userDocRef,
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const updatedUser = docSnapshot.data();
                    // Only update if there are actual changes to recipient/gifter assignments
                    setUser(prev => {
                        if (!prev) return updatedUser;
                        if (prev.recipientId !== updatedUser.recipientId ||
                            prev.gifterId !== updatedUser.gifterId) {
                            return updatedUser;
                        }
                        return prev; // No change, avoid unnecessary re-renders
                    });
                }
            },
            (error) => {
                console.error('[useUser] Error listening to user document:', error);
            }
        );

        return () => unsubscribe();
    }, [user?.id]);

    // Expose user data on window for E2E testing in development mode
    useEffect(() => {
        if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
            window.__e2eUserData__ = user;
        }

        return () => {
            if (typeof window !== 'undefined') {
                delete window.__e2eUserData__;
            }
        };
    }, [user]);

    return { user, loading, error, refreshUser };
}

