'use client';
import { useUserContext } from '@/context/UserContext';

/**
 * Read the single auth/profile owner (UserProvider in src/context/UserContext.js).
 *
 * @returns {{ user, authUid, authEmail, season, loading, error, refreshUser, acknowledgeReveal }}
 *   - user: Firestore user object of the active year (UUID-based id, not Firebase uid),
 *     resolved by /api/auth/bootstrap
 *   - authUid: Firebase Auth uid once the profile is ready
 *   - authEmail: signed-in Firebase Auth email (available while loading)
 *   - season: { year, state: 'active'|'closed', epoch, closedYears } once ready, else null
 *   - loading: auth/profile resolution in progress
 *   - error: { code, message } (ACCESS_DENIED, EMAIL_NOT_VERIFIED, PROFILE_CONFLICT,
 *     CLIENT_UPDATE_REQUIRED, LIFECYCLE_MISMATCH, BOOTSTRAP_FAILED, ...)
 *   - refreshUser: re-run the bootstrap
 *   - acknowledgeReveal: confirm the one-time recipient reveal on the server; resolves
 *     `{ status }` and never rejects
 */
export function useUser() {
    return useUserContext();
}
