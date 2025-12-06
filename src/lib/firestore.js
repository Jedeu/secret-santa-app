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

export async function getUserById(id) {
    const snapshot = await firestore.collection('users').where('id', '==', id).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data();
}

export async function getUsersByName(name) {
    // Simple exact match - names are normalized to Title Case
    const snapshot = await firestore.collection('users')
        .where('name', '==', name)
        .limit(1)
        .get();

    return snapshot.empty ? null : snapshot.docs[0].data();
}

// Get placeholder user by name (user without email)
// Used during OAuth sign-in to find and merge placeholder accounts
export async function getPlaceholderUserByName(name) {
    // For Firestore, we need to get all users with this name and filter client-side
    // because Firestore doesn't support querying for null/undefined fields easily
    const snapshot = await firestore.collection('users')
        .where('name', '==', name)
        .get();

    // Find first user without email
    for (const doc of snapshot.docs) {
        const user = doc.data();
        if (!user.email) {
            return user;
        }
    }
    return null;
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

// Alias for getAllUsers - kept for backward compatibility
// Firestore's built-in caching handles read optimization
export async function getAllUsersWithCache() {
    return getAllUsers();
}

// --- Messages ---

export async function getMessages(userId, otherId) {
    // We need messages where (from == userId AND to == otherId) OR (from == otherId AND to == userId)
    // Firestore doesn't support OR queries easily across fields like this without multiple queries.

    const sent = await firestore.collection('messages')
        .where('fromId', '==', userId)
        .where('toId', '==', otherId)
        .get();

    const received = await firestore.collection('messages')
        .where('fromId', '==', otherId)
        .where('toId', '==', userId)
        .get();

    const messages = [];
    sent.forEach(doc => messages.push(doc.data()));
    received.forEach(doc => messages.push(doc.data()));

    // Sort by timestamp
    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export async function getAllMessages() {
    const snapshot = await firestore.collection('messages').get();
    const messages = [];
    snapshot.forEach(doc => messages.push(doc.data()));
    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Alias for getAllMessages - kept for backward compatibility
// Firestore's built-in caching handles read optimization
export async function getAllMessagesWithCache() {
    return getAllMessages();
}

// Get all messages for a specific user (sent or received)
export async function getUserMessages(userId) {
    // Use two queries: messages sent by user and messages received by user
    const sent = await firestore.collection('messages')
        .where('fromId', '==', userId)
        .get();

    const received = await firestore.collection('messages')
        .where('toId', '==', userId)
        .get();

    const messages = [];
    sent.forEach(doc => messages.push(doc.data()));
    received.forEach(doc => messages.push(doc.data()));

    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export async function sendMessage(message) {
    // message: { id, fromId, toId, content, timestamp }
    await firestore.collection('messages').doc(message.id).set(message);
    return message;
}

export async function getUnreadCount(userId, otherId, lastReadAt) {
    // Use Firestore Aggregation Query for efficiency (1 read per 1000 items)
    // We only count messages FROM the other person TO the user that are newer than lastReadAt
    try {
        const snapshot = await firestore.collection('messages')
            .where('fromId', '==', otherId)
            .where('toId', '==', userId)
            .where('timestamp', '>', lastReadAt)
            .count()
            .get();

        return snapshot.data().count;
    } catch (error) {
        console.error('Error counting unread messages, falling back to regular query:', error);
        // Fallback for older SDKs or if count() fails
        const snapshot = await firestore.collection('messages')
            .where('fromId', '==', otherId)
            .where('toId', '==', userId)
            .where('timestamp', '>', lastReadAt)
            .get();

        return snapshot.size;
    }
}

// --- Read Status ---

export async function markAsRead(userId, conversationId) {
    const readRef = firestore.collection('lastRead').doc(`${userId}_${conversationId}`);
    await readRef.set({
        userId,
        conversationId,
        lastReadAt: new Date().toISOString()
    });
}

export async function getLastRead(userId, conversationId) {
    const doc = await firestore.collection('lastRead').doc(`${userId}_${conversationId}`).get();
    if (!doc.exists) return null;
    return doc.data();
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

export async function resetDatabase() {
    // Delete all collections
    const collections = ['users', 'messages', 'lastRead'];
    for (const collectionName of collections) {
        const snapshot = await firestore.collection(collectionName).get();
        const batch = firestore.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    }
}
