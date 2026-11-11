import { firestore } from './firebase';
import { yearCollectionPath } from './year-paths';
import { assertYearOpen, ensureParticipantProfiles } from './participant-admission';

/**
 * Server-side Firestore helpers for the Secret Santa app (Admin SDK).
 *
 * There is no bulk reset or deletion of year data. Season transitions are the admin
 * Close year / Start new year actions in src/lib/participant-admission.js.
 */

/**
 * Assign pairs atomically: inside one transaction fenced on the open year, reads every
 * user of that year, asks buildUpdates for the new pairs and writes them.
 * buildUpdates(users) returns null (no writes) or [{ id, recipientId, gifterId }].
 */
export async function assignUsersInTransaction(buildUpdates) {
    return firestore.runTransaction(async (tx) => {
        const { year } = await assertYearOpen(tx);
        const usersCollection = firestore.collection(yearCollectionPath(year, 'users').join('/'));
        const snapshot = await tx.get(usersCollection);
        const users = snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            return { ...data, id: data.id ?? doc.id };
        });

        const updates = buildUpdates(users);
        if (!updates) {
            return { usersFound: users.length, updated: 0 };
        }

        updates.forEach((update) => {
            tx.update(usersCollection.doc(update.id), {
                recipientId: update.recipientId,
                gifterId: update.gifterId,
            });
        });

        return { usersFound: users.length, updated: updates.length };
    });
}

/**
 * Ensure every participant on the active year's roster has a profile in that year.
 * Refused in a closed year; conflicts fail closed with PROFILE_CONFLICT.
 *
 * @returns {Promise<{ year: number, created: number, linked: number, existing: number }>}
 */
export async function ensureAllParticipants() {
    return ensureParticipantProfiles();
}
