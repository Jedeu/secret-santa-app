import { firestore } from './firebase';
import { v4 as uuidv4 } from 'uuid';

/**
 * Server-side Firestore operations for the Secret Santa app.
 * Relies on Firestore's built-in client-side caching for performance.
 * No server-side caching in this serverless environment.
 */

// --- Name Normalization ---
// Normalize names to Title Case for consistent storage and querying
function toTitleCase(name) {
    if (!name) return '';
    return name
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

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

// Batch update for pairing
export async function batchUpdateUsers(users) {
    const batch = firestore.batch();

    users.forEach(user => {
        const ref = firestore.collection('users').doc(user.id);
        batch.update(ref, {
            recipientId: user.recipientId,
            gifterId: user.gifterId
        });
    });

    await batch.commit();
}

// --- Participant Management ---

// Ensure all participants from the hardcoded list exist in the database
// This should be called during app initialization
export async function ensureAllParticipants(participants) {
    // For Firestore
    for (const participant of participants) {
        const existing = await getUserByEmail(participant.email);

        if (!existing) {
            const newUser = {
                id: uuidv4(),
                name: participant.name,
                email: participant.email,
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };
            await createUser(newUser);
        }
    }
}

// --- Admin ---

// Firestore allows at most 500 operations per WriteBatch.
const MAX_BATCH_OPERATIONS = 500;

export async function resetDatabase() {
    // Every collection the app writes. Keep in sync with firestore.rules and
    // PUSH_TOKENS_COLLECTION in src/lib/push-server.js.
    const collections = ['users', 'messages', 'lastRead', 'typing', 'reactions', 'pushTokens'];
    for (const collectionName of collections) {
        const snapshot = await firestore.collection(collectionName).get();
        for (let i = 0; i < snapshot.docs.length; i += MAX_BATCH_OPERATIONS) {
            const batch = firestore.batch();
            snapshot.docs.slice(i, i + MAX_BATCH_OPERATIONS).forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }
    }
}
