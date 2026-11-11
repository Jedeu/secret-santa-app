/**
 * Mock for useUser hook to use in tests
 */

// Season published by UserContext for the legacy 2025 exchange while it is open.
// Every mocked useUser() value with a user carries a season.
export const LEGACY_ACTIVE_SEASON = { year: 2025, state: 'active', epoch: 1, closedYears: [] };

// Mock authenticated user
export const mockAuthenticatedUser = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    recipientId: null,
    gifterId: null
};

// Mock useUser implementation for testing
export const mockUseUser = {
    user: null,
    season: null,
    loading: false,
    error: null
};

// Helper to set authenticated user in tests
export function setMockAuthenticatedUser(user = mockAuthenticatedUser, season = LEGACY_ACTIVE_SEASON) {
    mockUseUser.user = user;
    mockUseUser.season = season;
    mockUseUser.loading = false;
    mockUseUser.error = null;
}

// Helper to set loading state
export function setMockUserLoading() {
    mockUseUser.user = null;
    mockUseUser.season = null;
    mockUseUser.loading = true;
    mockUseUser.error = null;
}

// Helper to set unauthenticated state
export function setMockUnauthenticated() {
    mockUseUser.user = null;
    mockUseUser.season = null;
    mockUseUser.loading = false;
    mockUseUser.error = null;
}

// Helper to set access denied error
export function setMockAccessDenied(email = 'denied@example.com') {
    mockUseUser.user = null;
    mockUseUser.season = null;
    mockUseUser.loading = false;
    mockUseUser.error = {
        code: 'ACCESS_DENIED',
        message: `Access denied. Email ${email} is not in the Secret Santa participants list.`
    };
}
