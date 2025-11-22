/**
 * Jest setup file to configure test environment for Firebase Auth
 */

// Mock Firebase Auth to avoid Node.js compatibility issues
jest.mock('firebase/auth', () => ({
    signInWithPopup: jest.fn(),
    signOut: jest.fn(),
    GoogleAuthProvider: jest.fn(),
    onAuthStateChanged: jest.fn((auth, callback) => {
        // Call callback immediately with null user (not logged in)
        callback(null);
        // Return unsubscribe function
        return jest.fn();
    })
}));

// Mock Firestore functions
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    getDocs: jest.fn(() => Promise.resolve({ empty: true, docs: [] })),
    addDoc: jest.fn(),
    serverTimestamp: jest.fn(),
    onSnapshot: jest.fn((query, callback) => {
        // Return unsubscribe function
        return jest.fn();
    })
}));

// Mock Firebase client lib
jest.mock('@/lib/firebase-client', () => ({
    clientAuth: {
        currentUser: null,
        onAuthStateChanged: jest.fn((callback) => {
            callback(null);
            return jest.fn();
        }),
        signInWithPopup: jest.fn(),
        signOut: jest.fn()
    },
    firestore: {}
}));

// Mock Firebase Admin Auth
jest.mock('@/lib/firebase', () => ({
    firestore: {},
    auth: {
        verifyIdToken: jest.fn()
    }
}));
