import { initializeApp, getApps } from 'firebase/app';
import {
    getFirestore,
    connectFirestoreEmulator,
    enableIndexedDbPersistence,
    CACHE_SIZE_UNLIMITED
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// Client-side Firebase configuration
// These are public API keys and safe to expose in client-side code
const firebaseConfig = {
    // In development with emulators, use dummy values (required by Firebase SDK)
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || (process.env.NODE_ENV === 'development' ? 'fake-api-key-for-emulator' : undefined),
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || (process.env.NODE_ENV === 'development' ? 'localhost' : undefined),
    projectId: process.env.NODE_ENV === 'development' ? 'xmasteak-app' : process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

// Initialize Firebase only once
let app;
let db = null;
let auth = null;
let persistenceEnabled = false;

if (typeof window !== 'undefined') {
    // Only initialize in browser environment
    if (!getApps().length && firebaseConfig.projectId) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);

            // Connect to emulators in development
            if (process.env.NODE_ENV === 'development') {
                try {
                    console.log('[Firestore] Connecting to Firebase Emulators...');
                    connectFirestoreEmulator(db, '127.0.0.1', 8080);
                    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
                    console.log('[Firestore] Connected to Firebase Emulators (Firestore: 8080, Auth: 9099)');
                } catch (emulatorError) {
                    console.error('[Firestore] Failed to connect to Firebase Emulators:', emulatorError.message);
                    console.error('Make sure emulators are running: npm run emulators');
                }
            }

            // Enable offline persistence for client-side caching
            // This reduces Firestore reads by serving data from IndexedDB when possible
            if (!persistenceEnabled) {
                enableIndexedDbPersistence(db, {
                    cacheSizeBytes: CACHE_SIZE_UNLIMITED
                })
                    .then(() => {
                        persistenceEnabled = true;
                        console.log('[Firestore] Offline persistence enabled - reads will be cached locally');
                    })
                    .catch((err) => {
                        if (err.code === 'failed-precondition') {
                            // Multiple tabs open, persistence can only be enabled in one tab at a time
                            console.warn('[Firestore] Persistence unavailable: multiple tabs open');
                        } else if (err.code === 'unimplemented') {
                            // Browser doesn't support persistence
                            console.warn('[Firestore] Persistence unavailable: browser not supported');
                        } else {
                            console.warn('[Firestore] Persistence error:', err.message);
                        }
                    });
            }
        } catch (error) {
            console.warn('Firebase client initialization failed:', error.message);
        }
    } else if (getApps().length) {
        app = getApps()[0];
        db = getFirestore(app);
        auth = getAuth(app);
    }

    // Expose auth helpers for E2E testing (only in development)
    if (process.env.NODE_ENV === 'development' && auth) {
        window.__e2eAuth__ = {
            signInWithEmailAndPassword: async (email, password) => {
                const { signInWithEmailAndPassword } = await import('firebase/auth');
                return signInWithEmailAndPassword(auth, email, password);
            },
            signOut: async () => {
                const { signOut } = await import('firebase/auth');
                return signOut(auth);
            }
        };
    }
}

export const firestore = db;
export const clientAuth = auth;
