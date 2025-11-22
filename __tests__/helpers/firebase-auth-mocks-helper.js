/**
 * Mock helpers for Firebase Auth in tests
 * This file provides mock implementations to replace NextAuth mocks
 */

// Mock Firebase Admin Auth
export const mockAdminAuth = {
    verifyIdToken: jest.fn()
};

// Mock Firebase Client Auth
export const mockClientAuth = {
    currentUser: null,
    onAuthStateChanged: jest.fn(),
    signInWithPopup: jest.fn(),
    signOut: jest.fn()
};

// Mock Firestore
export const mockFirestore = {
    collection: jest.fn(),
    where: jest.fn(),
    getDocs: jest.fn(),
    query: jest.fn(),
    limit: jest.fn()
};

/**
 * Helper to mock a Firebase Admin verifyIdToken response
 * Use this instead of getServerSession mocks
 */
export function mockVerifyIdToken(email) {
    mockAdminAuth.verifyIdToken.mockResolvedValue({
        uid: 'test-uid',
        email: email,
        email_verified: true
    });
}

/**
 * Helper to mock Firebase Admin verifyIdToken rejection
 */
export function mockVerifyIdTokenRejection(error = { code: 'auth/argument-error' }) {
    mockAdminAuth.verifyIdToken.mockRejectedValue(error);
}

/**
 * Helper to create a mock request with Authorization header
 */
export function createMockRequestWithAuth(email = 'jed.piezas@gmail.com', body = {}) {
    const fakeToken = `fake-token-for-${email}`;
    mockVerifyIdToken(email);

    return {
        headers: new Map([['Authorization', `Bearer ${fakeToken}`]]),
        json: async () => body
    };
}

/**
 * Helper to create a mock request without auth
 */
export function createMockRequestWithoutAuth(body = {}) {
    return {
        headers: new Map(),
        json: async () => body
    };
}

// Reset all mocks
export function resetAuthMocks() {
    mockAdminAuth.verifyIdToken.mockReset();
    mockClientAuth.onAuthStateChanged.mockReset();
    mockClientAuth.signInWithPopup.mockReset();
    mockClientAuth.signOut.mockReset();
}
