/**
 * @jest-environment jsdom
 *
 * Tests for the useUser hook's realtime assignment updates.
 * Verifies that when a user's recipientId/gifterId is updated in Firestore,
 * the local React state updates automatically without requiring a page refresh.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

// Mock callback holders for controlled testing
let mockOnAuthStateCallback = null;
let mockOnSnapshotCallback = null;
let mockOnSnapshotError = null;
let mockUnsubscribeAuth = jest.fn();
let mockUnsubscribeSnapshot = jest.fn();

// Mock Firebase Auth
jest.mock('firebase/auth', () => ({
    onAuthStateChanged: (auth, callback) => {
        mockOnAuthStateCallback = callback;
        return mockUnsubscribeAuth;
    },
}));

// Mock Firebase Firestore
const mockDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockGetDocs = jest.fn();

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(() => 'mockCollection'),
    query: jest.fn(() => 'mockQuery'),
    where: jest.fn(),
    getDocs: (...args) => mockGetDocs(...args),
    limit: jest.fn(),
    doc: (...args) => mockDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    onSnapshot: (docRef, onSuccess, onError) => {
        mockOnSnapshotCallback = onSuccess;
        mockOnSnapshotError = onError;
        return mockUnsubscribeSnapshot;
    },
}));

// Mock firebase-client
jest.mock('@/lib/firebase-client', () => ({
    clientAuth: { _isMock: true },
    firestore: { _isMock: true }
}));

// Mock participants
jest.mock('@/lib/participants', () => ({
    getParticipantName: jest.fn((email) => {
        if (email === 'jed@example.com') return 'Jed';
        if (email === 'louis@example.com') return 'Louis';
        return null;
    })
}));

// Mock uuid
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-123')
}));

describe('useUser Hook - Realtime Assignment Updates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOnAuthStateCallback = null;
        mockOnSnapshotCallback = null;
        mockOnSnapshotError = null;
        mockUnsubscribeAuth = jest.fn();
        mockUnsubscribeSnapshot = jest.fn();
    });

    // Helper to create a mock Firestore query result
    const createMockQueryResult = (userData) => ({
        empty: !userData,
        docs: userData ? [{
            data: () => userData
        }] : []
    });

    test('should update user state when assignment changes in Firestore', async () => {
        // Import after mocks are set up
        const { useUser } = require('@/hooks/useUser');

        const initialUser = {
            id: 'user-1',
            name: 'Jed',
            email: 'jed@example.com',
            recipientId: null,
            gifterId: null
        };

        // Mock Firestore query to return existing user
        mockGetDocs.mockResolvedValue(createMockQueryResult(initialUser));
        mockDoc.mockReturnValue('mockDocRef');

        const { result } = renderHook(() => useUser());

        // Initially loading
        expect(result.current.loading).toBe(true);

        // Simulate Firebase Auth callback (user logged in)
        await act(async () => {
            await mockOnAuthStateCallback({
                uid: 'firebase-uid-1',
                email: 'jed@example.com',
                photoURL: null
            });
        });

        // Wait for user to be set
        await waitFor(() => {
            expect(result.current.user).not.toBeNull();
        });

        expect(result.current.user.id).toBe('user-1');
        expect(result.current.user.gifterId).toBeNull();

        // Now simulate an assignment update via onSnapshot
        // (Louis chooses Jed, so Jed's gifterId becomes Louis's ID)
        await act(async () => {
            mockOnSnapshotCallback({
                exists: () => true,
                data: () => ({
                    ...initialUser,
                    gifterId: 'louis-user-id',
                    recipientId: 'some-recipient-id'
                })
            });
        });

        // Verify the user state was updated
        await waitFor(() => {
            expect(result.current.user.gifterId).toBe('louis-user-id');
        });

        expect(result.current.user.recipientId).toBe('some-recipient-id');
    });

    test('should NOT update user state for non-assignment field changes', async () => {
        const { useUser } = require('@/hooks/useUser');

        const initialUser = {
            id: 'user-1',
            name: 'Jed',
            email: 'jed@example.com',
            recipientId: 'recipient-1',
            gifterId: 'gifter-1',
            image: null
        };

        mockGetDocs.mockResolvedValue(createMockQueryResult(initialUser));
        mockDoc.mockReturnValue('mockDocRef');

        const { result } = renderHook(() => useUser());

        // Simulate login
        await act(async () => {
            await mockOnAuthStateCallback({
                uid: 'firebase-uid-1',
                email: 'jed@example.com',
                photoURL: null
            });
        });

        await waitFor(() => {
            expect(result.current.user).not.toBeNull();
        });

        const prevUser = result.current.user;

        // Simulate an update that only changes non-assignment fields
        await act(async () => {
            mockOnSnapshotCallback({
                exists: () => true,
                data: () => ({
                    ...initialUser,
                    image: 'new-image-url.jpg' // Only image changed
                })
            });
        });

        // User reference should be the same (no re-render triggered)
        // Note: This tests the optimization in the onSnapshot callback
        expect(result.current.user).toBe(prevUser);
    });

    test('should clean up onSnapshot listener on unmount', async () => {
        const { useUser } = require('@/hooks/useUser');

        const initialUser = {
            id: 'user-1',
            name: 'Jed',
            email: 'jed@example.com',
            recipientId: null,
            gifterId: null
        };

        mockGetDocs.mockResolvedValue(createMockQueryResult(initialUser));
        mockDoc.mockReturnValue('mockDocRef');

        const { result, unmount } = renderHook(() => useUser());

        // Simulate login
        await act(async () => {
            await mockOnAuthStateCallback({
                uid: 'firebase-uid-1',
                email: 'jed@example.com',
                photoURL: null
            });
        });

        await waitFor(() => {
            expect(result.current.user).not.toBeNull();
        });

        // Unmount the hook
        unmount();

        // Verify onSnapshot unsubscribe was called
        expect(mockUnsubscribeSnapshot).toHaveBeenCalled();
    });

    test('should handle onSnapshot errors gracefully', async () => {
        const { useUser } = require('@/hooks/useUser');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const initialUser = {
            id: 'user-1',
            name: 'Jed',
            email: 'jed@example.com',
            recipientId: null,
            gifterId: null
        };

        mockGetDocs.mockResolvedValue(createMockQueryResult(initialUser));
        mockDoc.mockReturnValue('mockDocRef');

        const { result } = renderHook(() => useUser());

        // Simulate login
        await act(async () => {
            await mockOnAuthStateCallback({
                uid: 'firebase-uid-1',
                email: 'jed@example.com',
                photoURL: null
            });
        });

        await waitFor(() => {
            expect(result.current.user).not.toBeNull();
        });

        // Simulate an error from onSnapshot
        await act(async () => {
            mockOnSnapshotError(new Error('Permission denied'));
        });

        // User should still be available (error logged but not thrown)
        expect(result.current.user).not.toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
            '[useUser] Error listening to user document:',
            expect.any(Error)
        );

        consoleSpy.mockRestore();
    });
});
