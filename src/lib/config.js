/**
 * Application configuration constants
 */

/**
 * List of admin email addresses with elevated privileges
 * Admins can:
 * - Initialize participants
 * - Assign Secret Santa pairs
 * - Reset the entire application
 */
export const ADMIN_EMAILS = ['jed.piezas@gmail.com'];

/**
 * Check if an email address has admin privileges
 *
 * @param {string} email - The email address to check
 * @returns {boolean} - True if the email is an admin, false otherwise
 */
export function isAdmin(email) {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
}
