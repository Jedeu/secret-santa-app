import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

/**
 * Get the authenticated user from the session
 * @param {Request} request - The request object
 * @returns {Promise<Object|null>} The authenticated user or null
 */
export async function getAuthenticatedUser(request) {
    const session = await getServerSession(authOptions);
    return session?.user || null;
}

/**
 * Require authentication, throw error if not authenticated
 * @param {Request} request - The request object
 * @returns {Promise<Object>} The authenticated user
 * @throws {Error} If user is not authenticated
 */
export async function requireAuth(request) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        throw new Error('Unauthorized');
    }
    return user;
}

/**
 * Check if a user can access a specific message
 * @param {Object} user - The authenticated user
 * @param {Object} message - The message to check
 * @returns {boolean} True if user can access the message
 */
export function canAccessMessage(user, message) {
    // User can access messages they sent or received
    return message.fromId === user.id || message.toId === user.id;
}
