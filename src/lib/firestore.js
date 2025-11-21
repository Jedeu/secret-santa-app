import { firestore } from './firebase';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// --- Cache Layer ---
// Simple in-memory cache to reduce Firestore reads during authentication
const userCache = new Map();
const CACHE_TTL = 60000; // 1 minute

// Server-side cache for collections (public feed optimization)
let allUsersCache = null;
let allUsersCacheTime = 0;
let allMessagesCache = null;
let allMessagesCacheTime = 0;
const COLLECTION_CACHE_TTL = 5000; // 5 seconds for public feed data

function getCachedUser(key) {
    const cached = userCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    return null;
}

function setCachedUser(key, data) {
    userCache.set(key, { data, timestamp: Date.now() });
}

function clearUserCache() {
    userCache.clear();
    // Also clear collection caches when users change
    allUsersCache = null;
    allUsersCacheTime = 0;
}

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
    try {
        return JSON.parse(data);
    } catch (e) {
        // If the JSON is corrupted, reset to a clean structure
        const initialData = { users: [], messages: [], lastRead: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
        return initialData;
    }
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

    // Check cache first
    const cacheKey = `email:${email}`;
    const cached = getCachedUser(cacheKey);
    if (cached !== null) {
        return cached;
    }

    const snapshot = await firestore.collection('users').where('email', '==', email).limit(1).get();
    const user = snapshot.empty ? null : snapshot.docs[0].data();

    // Cache the result
    setCachedUser(cacheKey, user);
    return user;
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

    // Check cache first
    const cacheKey = `name:${name}`;
    const cached = getCachedUser(cacheKey);
    if (cached !== null) {
        return cached;
    }

    // Simple exact match - names are normalized to Title Case
    const snapshot = await firestore.collection('users')
        .where('name', '==', name)
        .limit(1)
        .get();

    const user = snapshot.empty ? null : snapshot.docs[0].data();

    // Cache the result
    setCachedUser(cacheKey, user);
    return user;
}

// Get placeholder user by name (user without email)
// Used during OAuth sign-in to find and merge placeholder accounts
export async function getPlaceholderUserByName(name) {
    if (!useFirestore()) {
        const db = getLocalDB();
        // Find first user with matching name (case-insensitive) and no email
        return db.users.find(u =>
            u.name.toLowerCase() === name.toLowerCase() && !u.email
        ) || null;
    }

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
    if (!useFirestore()) {
        const db = getLocalDB();
        db.users.push(user);
        saveLocalDB(db);
        return user;
    }
    // user object should have { id, name, email, oauthId, image, recipientId, gifterId }
    // Normalize name to Title Case for consistent querying
    const normalizedUser = {
        ...user,
        name: toTitleCase(user.name)
    };

    await firestore.collection('users').doc(normalizedUser.id).set(normalizedUser);

    // Clear cache since we added a new user
    clearUserCache();

    return normalizedUser;
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

    // Normalize name to Title Case if updating name
    const updateData = { ...data };
    if (data.name) {
        updateData.name = toTitleCase(data.name);
    }

    await firestore.collection('users').doc(userId).update(updateData);

    // Clear cache since user data changed
    clearUserCache();
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

// Cached version for public feed (reduces reads when multiple users view feed simultaneously)
export async function getAllUsersWithCache() {
    if (!useFirestore()) {
        return getAllUsers();
    }

    const now = Date.now();
    if (allUsersCache && (now - allUsersCacheTime) < COLLECTION_CACHE_TTL) {
        return allUsersCache;
    }

    const users = await getAllUsers();
    allUsersCache = users;
    allUsersCacheTime = now;
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

// Cached version for public feed (reduces reads when multiple users view feed simultaneously)
export async function getAllMessagesWithCache() {
    if (!useFirestore()) {
        return getAllMessages();
    }

    const now = Date.now();
    if (allMessagesCache && (now - allMessagesCacheTime) < COLLECTION_CACHE_TTL) {
        return allMessagesCache;
    }

    const messages = await getAllMessages();
    allMessagesCache = messages;
    allMessagesCacheTime = now;
    return messages;
}

// Get all messages for a specific user (sent or received)
export async function getUserMessages(userId) {
    if (!useFirestore()) {
        const db = getLocalDB();
        return db.messages.filter(msg =>
            msg.fromId === userId || msg.toId === userId
        ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

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
    if (!useFirestore()) {
        const db = getLocalDB();
        db.messages.push(message);
        saveLocalDB(db);
        return message;
    }
    // message: { id, fromId, toId, content, timestamp }
    await firestore.collection('messages').doc(message.id).set(message);

    // Clear message cache so public feed shows new message immediately
    allMessagesCache = null;
    allMessagesCacheTime = 0;

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

// --- Participant Management ---

// Ensure all participants from the hardcoded list exist in the database
// This should be called during app initialization
export async function ensureAllParticipants(participants) {
    if (!useFirestore()) {
        const db = getLocalDB();

        for (const participant of participants) {
            // Check if user already exists by email
            const existing = db.users.find(u => u.email === participant.email);

            if (!existing) {
                // Create the user
                const newUser = {
                    id: uuidv4(),
                    name: participant.name,
                    email: participant.email,
                    oauthId: null, // Will be set when they log in
                    image: null,   // Will be set when they log in
                    recipientId: null,
                    gifterId: null
                };
                db.users.push(newUser);
            }
        }

        saveLocalDB(db);
        return;
    }

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
