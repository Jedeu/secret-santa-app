'use client';

/**
 * Firestore Listener Tracker
 *
 * This module provides utilities for tracking Firestore listener lifecycle
 * to help debug excessive reads. Only logs in development mode.
 *
 * Usage:
 * - Import { logListenerCreated, logListenerDestroyed, getActiveListeners } from this file
 * - Call logListenerCreated('name') when setting up a listener
 * - Call logListenerDestroyed('name') in the cleanup function
 * - Call getActiveListeners() to see all currently active listeners
 */

// Track active listeners by name
const activeListeners = new Map();

// Track total reads (approximate based on listener creation)
let totalListenerCreations = 0;

const isDev = process.env.NODE_ENV === 'development';

/**
 * Log when a Firestore listener is created
 * @param {string} name - Unique name for this listener
 * @param {object} metadata - Optional metadata (query info, etc.)
 */
export function logListenerCreated(name, metadata = {}) {
    if (!isDev) return;

    totalListenerCreations++;

    const existingCount = activeListeners.get(name) || 0;
    activeListeners.set(name, existingCount + 1);

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    console.log(
        `%c[Firestore] %cLISTENER CREATED: %c${name}`,
        'color: #FF5722; font-weight: bold;',
        'color: #4CAF50; font-weight: bold;',
        'color: #2196F3; font-weight: bold;',
        {
            activeCount: activeListeners.get(name),
            totalCreations: totalListenerCreations,
            timestamp,
            ...metadata
        }
    );

    // Warn if same listener created multiple times (potential leak)
    if (existingCount > 0) {
        console.warn(
            `%c[Firestore] WARNING: Listener "${name}" now has ${existingCount + 1} instances. Potential duplicate!`,
            'color: #FF9800; font-weight: bold;'
        );
    }
}

/**
 * Log when a Firestore listener is destroyed
 * @param {string} name - Unique name for this listener
 */
export function logListenerDestroyed(name) {
    if (!isDev) return;

    const existingCount = activeListeners.get(name) || 0;

    if (existingCount > 1) {
        activeListeners.set(name, existingCount - 1);
    } else {
        activeListeners.delete(name);
    }

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    console.log(
        `%c[Firestore] %cLISTENER DESTROYED: %c${name}`,
        'color: #FF5722; font-weight: bold;',
        'color: #f44336; font-weight: bold;',
        'color: #2196F3; font-weight: bold;',
        {
            remainingCount: activeListeners.get(name) || 0,
            timestamp
        }
    );
}

/**
 * Log when a snapshot is received (to track reads)
 * @param {string} name - Listener name
 * @param {number} docCount - Number of documents in the snapshot
 * @param {boolean} fromCache - Whether the data came from cache
 * @param {number} changedCount - Number of actual changed documents (reads charged)
 */
export function logSnapshotReceived(name, docCount, fromCache = false, changedCount = null) {
    if (!isDev) return;

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const source = fromCache ? 'CACHE' : 'SERVER';
    const color = fromCache ? '#9E9E9E' : '#4CAF50';

    // If changedCount is provided, show both total and changed
    const countText = changedCount !== null
        ? `${docCount} total, ${changedCount} changed → ${changedCount} READ${changedCount !== 1 ? 'S' : ''} from ${source}`
        : `${docCount} docs from ${source}`;

    console.log(
        `%c[Firestore] %cSNAPSHOT: %c${name} %c(${countText})`,
        'color: #FF5722; font-weight: bold;',
        `color: ${color};`,
        'color: #2196F3;',
        `color: ${color};`,
        { timestamp }
    );
}

/**
 * Get all currently active listeners
 * @returns {Map} - Map of listener names to their active counts
 */
export function getActiveListeners() {
    return new Map(activeListeners);
}

/**
 * Get total number of active listener instances
 * @returns {number}
 */
export function getActiveListenerCount() {
    let total = 0;
    activeListeners.forEach(count => total += count);
    return total;
}

/**
 * Print a summary of listener state to console
 */
export function printListenerSummary() {
    if (!isDev) return;

    console.log(
        '%c[Firestore] LISTENER SUMMARY',
        'color: #FF5722; font-weight: bold; font-size: 14px;'
    );
    console.log(`Total listener creations this session: ${totalListenerCreations}`);
    console.log(`Currently active listeners: ${getActiveListenerCount()}`);

    if (activeListeners.size > 0) {
        console.table(
            Array.from(activeListeners.entries()).map(([name, count]) => ({
                'Listener Name': name,
                'Active Instances': count
            }))
        );
    } else {
        console.log('No active listeners');
    }
}

// Expose to window for debugging in browser console
if (typeof window !== 'undefined' && isDev) {
    window.__firestoreDebug = {
        getActiveListeners,
        getActiveListenerCount,
        printListenerSummary
    };

    console.log(
        '%c[Firestore] Debug tools available: window.__firestoreDebug.printListenerSummary()',
        'color: #9E9E9E; font-style: italic;'
    );
}
