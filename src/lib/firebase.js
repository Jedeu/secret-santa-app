import admin from 'firebase-admin';

// Connect to emulators in development
if (process.env.NODE_ENV === 'development') {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    console.log('🔥 Server: Configured to use Firebase Emulators');
}

if (!admin.apps.length) {
    try {
        // In production (Vercel), these env vars will be set.
        // For local dev, we might need a service account key file or just rely on these vars.
        // If vars are missing, this might fail, so we wrap in try/catch or check vars.

        // In dev mode with emulators, we don't strictly need creds, but it's good practice to have a project ID
        if (process.env.NODE_ENV === 'development') {
            admin.initializeApp({
                projectId: 'xmasteak-app'
            });
            console.log('✅ Server: Firebase Admin initialized for emulator');
        } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
            });
            console.log('✅ Server: Firebase Admin initialized for production');
        } else {
            console.warn("Firebase environment variables missing. Skipping Firebase Admin initialization.");
        }
    } catch (error) {
        console.error('Firebase admin initialization error', error.stack);
    }
}

export const firestore = admin.apps.length ? admin.firestore() : null;
export const auth = admin.apps.length ? admin.auth() : null;
