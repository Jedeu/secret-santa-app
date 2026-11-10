import { firestore } from './firebase';
import {
    toTitleCase,
    ensureParticipantProfiles,
    beginReset,
    assertResetOwner,
    assertLifecycleActive,
    completeReset,
} from './participant-admission';

/**
 * Server-side Firestore operations for the Secret Santa app.
 * Relies on Firestore's built-in client-side caching for performance.
 * No server-side caching in this serverless environment.
 */

// Every collection the app writes, in reset-deletion order. Keep in sync with
// firestore.rules, PUSH_TOKENS_COLLECTION in src/lib/push-server.js and
// scripts/lib/emulator-firestore.js. system/lifecycle is never deleted.
export const APP_COLLECTIONS = [
    'authIdentities',
    'participantIndex',
    'users',
    'messages',
    'lastRead',
    'typing',
    'reactions',
    'pushTokens',
];

// Deletes per reset transaction (well under Firestore's 500-write limit).
const RESET_DELETE_BATCH_SIZE = 400;

const noop = async () => {};

// --- Users ---

export async function getUserByEmail(email) {
    const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
    return snapshot.empty ? null : snapshot.docs[0].data();
}

export async function createUser(user) {
    // user object should have { id, name, email, oauthId, image, recipientId, gifterId }
    // Normalize name to Title Case for consistent querying
    const normalizedUser = {
        ...user,
        name: toTitleCase(user.name)
    };

    await firestore.collection('users').doc(normalizedUser.id).set(normalizedUser);
    return normalizedUser;
}

export async function updateUser(userId, data) {
    // Normalize name to Title Case if updating name
    const updateData = { ...data };
    if (data.name) {
        updateData.name = toTitleCase(data.name);
    }

    await firestore.collection('users').doc(userId).update(updateData);
}

export async function getAllUsers() {
    const snapshot = await firestore.collection('users').get();
    const users = [];
    snapshot.forEach(doc => users.push(doc.data()));
    return users;
}

/**
 * Assign pairs atomically: reads every user inside one transaction (fenced on the
 * active lifecycle), asks buildUpdates for the new pairs and writes them.
 * buildUpdates(users) returns null (no writes) or [{ id, recipientId, gifterId }].
 */
export async function assignUsersInTransaction(buildUpdates) {
    return firestore.runTransaction(async (tx) => {
        await assertLifecycleActive(tx);
        const usersCollection = firestore.collection('users');
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

// --- Participant Management ---

// Ensure all participants from the hardcoded list exist in the database.
// Requires an active lifecycle; conflicts fail closed with PROFILE_CONFLICT.
export async function ensureAllParticipants(participants) {
    return ensureParticipantProfiles(participants);
}

// --- Admin ---

async function deleteAppCollections(resetId) {
    for (const collectionName of APP_COLLECTIONS) {
        // Repeat owner-checked delete transactions until the collection is empty.
        let deleted = 0;
        do {
            deleted = await firestore.runTransaction(async (tx) => {
                await assertResetOwner(tx, resetId);
                const snapshot = await tx.get(
                    firestore.collection(collectionName).limit(RESET_DELETE_BATCH_SIZE)
                );
                snapshot.docs.forEach((doc) => tx.delete(doc.ref));
                return snapshot.docs.length;
            });
        } while (deleted > 0);
    }
}

/**
 * Exclusive, fail-closed reset of every app collection. On error the lifecycle stays
 * 'resetting' (no finally); recovery is running reset again. Hooks are test barriers.
 */
export async function resetDatabase({ afterBegin = noop } = {}) {
    const { resetId } = await beginReset();
    await afterBegin();
    await deleteAppCollections(resetId);
    await completeReset(resetId);
}

export async function resetAndReseedParticipants(
    participants,
    { afterBegin = noop, afterDelete = noop, afterReseed = noop } = {}
) {
    const { resetId } = await beginReset();
    await afterBegin();
    await deleteAppCollections(resetId);
    await afterDelete();
    await ensureParticipantProfiles(participants, { resetId });
    await afterReseed();
    await completeReset(resetId);
}
