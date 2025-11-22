import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
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
                    console.log('🔥 Connecting to Firebase Emulators...');
                    connectFirestoreEmulator(db, '127.0.0.1', 8080);
                    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
                    console.log('✅ Connected to Firebase Emulators (Firestore: 8080, Auth: 9099)');
                } catch (emulatorError) {
                    console.error('❌ Failed to connect to Firebase Emulators:', emulatorError.message);
                    console.error('Make sure emulators are running: npm run emulators');
                }
            }
        } catch (error) {
            console.warn('Firebase client initialization failed:', error.message);
        }
    } else if (getApps().length) {
        app = getApps()[0];
        db = getFirestore(app);
        auth = getAuth(app);
    }
}

export const firestore = db;
export const clientAuth = auth;
