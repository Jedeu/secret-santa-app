/**
 * Shared Firestore emulator helper for local maintenance scripts.
 *
 * - Always targets the Firestore emulator: FIRESTORE_EMULATOR_HOST defaults to
 *   127.0.0.1:8080 and must be a loopback host (127.0.0.1:* or localhost:*),
 *   otherwise the process exits with code 1 before any Firestore call.
 * - Uses the same project id as .firebaserc, src/lib/firebase.js and
 *   src/lib/firebase-client.js so scripts see the data the app sees.
 *
 * CommonJS; Admin SDK only (no '@/' or 'src/' imports).
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const EMULATOR_PROJECT_ID = 'xmasteak-app';
const DEFAULT_EMULATOR_HOST = '127.0.0.1:8080';

// Root (legacy 2025) and global collection names, for diagnostics.
const APP_COLLECTIONS = [
    'authIdentities',
    'participantIndex',
    'users',
    'messages',
    'lastRead',
    'typing',
    'reactions',
    'pushTokens',
];

function isLoopbackHost(host) {
    return typeof host === 'string' && /^(127\.0\.0\.1|localhost):\d+$/.test(host.trim());
}

function ensureEmulatorHost() {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        process.env.FIRESTORE_EMULATOR_HOST = DEFAULT_EMULATOR_HOST;
    }

    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!isLoopbackHost(host)) {
        console.error('Refusing to run: FIRESTORE_EMULATOR_HOST must be 127.0.0.1:<port> or localhost:<port>.');
        process.exit(1);
        // Stop here even if process.exit is stubbed (tests).
        throw new Error('Non-loopback FIRESTORE_EMULATOR_HOST');
    }

    return host;
}

function getEmulatorFirestore() {
    ensureEmulatorHost();

    if (!getApps().length) {
        initializeApp({ projectId: EMULATOR_PROJECT_ID });
    }

    return getFirestore();
}

/**
 * Delete every document in the emulator database (all collections, every year) through
 * the emulator's REST endpoint. Destructive by design; emulator only.
 */
async function clearEmulatorFirestore() {
    const host = ensureEmulatorHost();
    const response = await fetch(
        'http://' + host + '/emulator/v1/projects/' + EMULATOR_PROJECT_ID + '/databases/(default)/documents',
        { method: 'DELETE' }
    );
    if (!response.ok) {
        throw new Error(`Emulator clear failed with status ${response.status}`);
    }
}

module.exports = {
    EMULATOR_PROJECT_ID,
    APP_COLLECTIONS,
    clearEmulatorFirestore,
    getEmulatorFirestore,
    isLoopbackHost,
};
