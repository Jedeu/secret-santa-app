import { firestore } from './firebase';
import { v4 as uuidv4 } from 'uuid';

// Helper to check if firestore is initialized
const checkFirestore = () => {
    if (!firestore) {
        throw new Error('Firestore is not initialized. Check environment variables.');
    }
};

// --- Users ---

export async function getUserByEmail(email) {
    checkFirestore();
    const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data();
}

export async function getUserById(id) {
    checkFirestore();
    const snapshot = await firestore.collection('users').where('id', '==', id).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data();
}

export async function getUsersByName(name) {
    checkFirestore();
    // Note: This is case-sensitive by default in Firestore. 
    // For true case-insensitive search, we'd need a normalized field (e.g., name_lower).
    // For now, we'll fetch all and filter in memory if the list is small (which it is: 8 users).
    // Or we can just rely on exact match if that's acceptable, but the original code used toLowerCase().

    // Since we only have 8 users, fetching all is fine.
    const snapshot = await firestore.collection('users').get();
    const users = [];
    snapshot.forEach(doc => users.push(doc.data()));
    return users.filter(u => u.name.toLowerCase() === name.toLowerCase())[0] || null;
}

export async function createUser(user) {
    checkFirestore();
    // user object should have { id, name, email, oauthId, image, recipientId, gifterId }
    // We use 'id' as the document ID for easier lookup if we wanted, but let's stick to query by field for consistency with existing structure
    // actually, using user.id as doc ID is better.
    await firestore.collection('users').doc(user.id).set(user);
    return user;
}

export async function updateUser(userId, data) {
    checkFirestore();
    await firestore.collection('users').doc(userId).update(data);
}

export async function getAllUsers() {
    checkFirestore();
    const snapshot = await firestore.collection('users').get();
    const users = [];
    snapshot.forEach(doc => users.push(doc.data()));
    return users;
}

// --- Messages ---

export async function getMessages(userId, otherId) {
    checkFirestore();
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
    checkFirestore();
    const snapshot = await firestore.collection('messages').get();
    const messages = [];
    snapshot.forEach(doc => messages.push(doc.data()));
    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export async function sendMessage(message) {
    checkFirestore();
    // message: { id, fromId, toId, content, timestamp }
    await firestore.collection('messages').doc(message.id).set(message);
    return message;
}

// --- Read Status ---

export async function markAsRead(userId, conversationId) {
    checkFirestore();
    const readRef = firestore.collection('lastRead').doc(`${userId}_${conversationId}`);
    await readRef.set({
        userId,
        conversationId,
        lastReadAt: new Date().toISOString()
    });
}

export async function getLastRead(userId, conversationId) {
    checkFirestore();
    const doc = await firestore.collection('lastRead').doc(`${userId}_${conversationId}`).get();
    if (!doc.exists) return null;
    return doc.data();
}

// Batch update for pairing
export async function batchUpdateUsers(users) {
    checkFirestore();
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
