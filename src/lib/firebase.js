import admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        // In production (Vercel), these env vars will be set.
        // For local dev, we might need a service account key file or just rely on these vars.
        // If vars are missing, this might fail, so we wrap in try/catch or check vars.

        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
            });
        } else {
            console.warn("Firebase environment variables missing. Skipping Firebase Admin initialization.");
        }
    } catch (error) {
        console.error('Firebase admin initialization error', error.stack);
    }
}

export const firestore = admin.apps.length ? admin.firestore() : null;
