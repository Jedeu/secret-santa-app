/**
 * Development-only logging utilities.
 *
 * In production, these functions do nothing.
 * In development, they log to the console with appropriate levels.
 */

/**
 * Log info messages (only in development).
 * @param {...any} args - Arguments to log
 */
export function devLog(...args) {
    if (process.env.NODE_ENV === 'development') {
        console.log(...args);
    }
}

/**
 * Log warning messages (only in development).
 * @param {...any} args - Arguments to log
 */
export function devWarn(...args) {
    if (process.env.NODE_ENV === 'development') {
        console.warn(...args);
    }
}

/**
 * Log error messages (always, as errors should be visible in production too).
 * @param {...any} args - Arguments to log
 */
export function logError(...args) {
    console.error(...args);
}
