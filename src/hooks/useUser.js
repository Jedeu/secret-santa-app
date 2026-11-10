'use client';
import { useUserContext } from '@/context/UserContext';

/**
 * Read the single auth/profile owner (UserProvider in src/context/UserContext.js).
 *
 * @returns {{ user, authUid, authEmail, loading, error, notice, refreshUser }}
 *   - user: Firestore user object (UUID-based id, not Firebase uid), resolved by /api/auth/bootstrap
 *   - authUid: Firebase Auth uid once the profile is ready
 *   - authEmail: signed-in Firebase Auth email (available while loading)
 *   - loading: auth/profile resolution in progress
 *   - error: { code, message } (ACCESS_DENIED, EMAIL_NOT_VERIFIED, PROFILE_CONFLICT, BOOTSTRAP_FAILED, ...)
 *   - notice: 'RESET_IN_PROGRESS' while an admin reset is running
 *   - refreshUser: re-run the bootstrap
 */
export function useUser() {
    return useUserContext();
}
