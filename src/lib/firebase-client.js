import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Client-side Firebase configuration
// These are public API keys and safe to expose in client-side code
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

// Initialize Firebase only once
let app;
let db = null;

if (typeof window !== 'undefined') {
    // Only initialize in browser environment
    if (!getApps().length && firebaseConfig.projectId) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
        } catch (error) {
            console.warn('Firebase client initialization failed:', error.message);
        }
    } else if (getApps().length) {
        app = getApps()[0];
        db = getFirestore(app);
    }
}

export const firestore = db;

// Helper to check if client-side Firestore is available
export const useClientFirestore = () => {
    return !!db;
};
