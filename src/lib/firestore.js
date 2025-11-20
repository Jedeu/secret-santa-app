import { firestore } from './firebase';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// --- Local DB Fallback Logic ---
const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

function getLocalDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) {
        const initialData = {
            users: [],
            messages: [],
            lastRead: []
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
}

function saveLocalDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Helper to check if firestore is initialized
const useFirestore = () => {
    return !!firestore;
};

// --- Users ---

export async function getUserByEmail(email) {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.users.find(u => u.email === email) || null;
    }
    const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data();
}

export async function getUserById(id) {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.users.find(u => u.id === id) || null;
    }
    const snapshot = await firestore.collection('users').where('id', '==', id).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data();
}

export async function getUsersByName(name) {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.users.find(u => u.name.toLowerCase() === name.toLowerCase()) || null;
    }
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
    if (!useFirestore()) {
        const db = getLocalDB();
        db.users.push(user);
        saveLocalDB(db);
        return user;
    }
    // user object should have { id, name, email, oauthId, image, recipientId, gifterId }
    // We use 'id' as the document ID for easier lookup if we wanted, but let's stick to query by field for consistency with existing structure
    // actually, using user.id as doc ID is better.
    await firestore.collection('users').doc(user.id).set(user);
    return user;
}

export async function updateUser(userId, data) {
    if (!useFirestore()) {
        const db = getLocalDB();
        const index = db.users.findIndex(u => u.id === userId);
        if (index !== -1) {
            db.users[index] = { ...db.users[index], ...data };
            saveLocalDB(db);
        }
        return;
    }
    await firestore.collection('users').doc(userId).update(data);
}

export async function getAllUsers() {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.users;
    }
    const snapshot = await firestore.collection('users').get();
    const users = [];
    snapshot.forEach(doc => users.push(doc.data()));
    return users;
}

// --- Messages ---

export async function getMessages(userId, otherId) {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.messages.filter(msg =>
            (msg.fromId === userId && msg.toId === otherId) ||
            (msg.fromId === otherId && msg.toId === userId)
        ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
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
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
    const snapshot = await firestore.collection('messages').get();
    const messages = [];
    snapshot.forEach(doc => messages.push(doc.data()));
    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export async function sendMessage(message) {
    if (!useFirestore()) {
        const db = getLocalDB();
        db.messages.push(message);
        saveLocalDB(db);
        return message;
    }
    // message: { id, fromId, toId, content, timestamp }
    await firestore.collection('messages').doc(message.id).set(message);
    return message;
}

// --- Read Status ---

export async function markAsRead(userId, conversationId) {
    if (!useFirestore()) {
        const db = getLocalDB();
        const existingIndex = db.lastRead.findIndex(lr => lr.userId === userId && lr.conversationId === conversationId);
        const entry = {
            userId,
            conversationId,
            lastReadAt: new Date().toISOString()
        };

        if (existingIndex !== -1) {
            db.lastRead[existingIndex] = entry;
        } else {
            db.lastRead.push(entry);
        }
        saveLocalDB(db);
        return;
    }
    const readRef = firestore.collection('lastRead').doc(`${userId}_${conversationId}`);
    await readRef.set({
        userId,
        conversationId,
        lastReadAt: new Date().toISOString()
    });
}

export async function getLastRead(userId, conversationId) {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.lastRead.find(lr => lr.userId === userId && lr.conversationId === conversationId) || null;
    }
    const doc = await firestore.collection('lastRead').doc(`${userId}_${conversationId}`).get();
    if (!doc.exists) return null;
    return doc.data();
}

// Batch update for pairing
export async function batchUpdateUsers(users) {
    if (!useFirestore()) {
        const db = getLocalDB();
        users.forEach(user => {
            const index = db.users.findIndex(u => u.id === user.id);
            if (index !== -1) {
                db.users[index].recipientId = user.recipientId;
                db.users[index].gifterId = user.gifterId;
            }
        });
        saveLocalDB(db);
        return;
    }
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

// --- Admin ---

export async function resetDatabase() {
    if (!useFirestore()) {
        const db = {
            users: [],
            messages: [],
            lastRead: []
        };
        saveLocalDB(db);
        return;
    }

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
