'use client';
import { useState, useEffect } from 'react';
import { clientAuth, firestore } from '@/lib/firebase-client';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, getDocs, limit, doc, setDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { getParticipantName } from '@/lib/participants';

/**
 * Custom hook to manage Firebase Auth state and link to Firestore user
 * This implements the "handshake" logic to link Google OAuth users to hardcoded participants
 * 
 * @returns {Object} - { user, loading, error }
 *   - user: Firestore user object (with UUID-based id, not Firebase uid)
 *   - loading: boolean indicating auth state check in progress
 *   - error: error object if access denied or other error
 */
export function useUser() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!clientAuth || !firestore) {
            setLoading(false);
            return;
        }

        // Listen to Firebase Auth state changes
        const unsubscribe = onAuthStateChanged(clientAuth, async (firebaseUser) => {
            try {
                if (firebaseUser) {
                    // User is signed in with Firebase Auth
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
                        setLoading(false);
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
                } else {
                    // User is signed out
                    setUser(null);
                    setError(null);
                }
            } catch (err) {
                console.error('Error in useUser hook:', err);
                setError({
                    code: 'UNKNOWN_ERROR',
                    message: 'An error occurred while checking user access.'
                });
                setUser(null);
            } finally {
                setLoading(false);
            }
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    return { user, loading, error };
}
