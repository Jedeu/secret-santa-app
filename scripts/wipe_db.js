const admin = require('firebase-admin');

// Initialize Firebase Admin for Firestore Emulator
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'demo-secret-santa',
    });
}

const db = admin.firestore();
db.settings({
    host: 'localhost:8080',
    ssl: false
});

async function wipeDatabase() {
    try {
        console.log('\n=== WIPING DATABASE ===\n');

        // Delete all messages
        const messagesSnapshot = await db.collection('messages').get();
        console.log(`Deleting ${messagesSnapshot.size} messages...`);

        const messageBatch = db.batch();
        messagesSnapshot.docs.forEach(doc => {
            messageBatch.delete(doc.ref);
        });
        await messageBatch.commit();
        console.log('✓ Messages deleted');

        // Delete all users
        const usersSnapshot = await db.collection('users').get();
        console.log(`Deleting ${usersSnapshot.size} users...`);

        const userBatch = db.batch();
        usersSnapshot.docs.forEach(doc => {
            userBatch.delete(doc.ref);
        });
        await userBatch.commit();
        console.log('✓ Users deleted');

        console.log('\n=== DATABASE WIPED CLEAN ===\n');
        console.log('You can now seed fresh data with: npm run seed:users\n');

    } catch (error) {
        console.error('Error wiping database:', error);
    } finally {
        process.exit(0);
    }
}

wipeDatabase();
