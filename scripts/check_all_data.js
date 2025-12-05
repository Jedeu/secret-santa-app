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

async function checkAllData() {
    try {
        console.log('\n=== CHECKING ALL FIRESTORE DATA ===\n');

        // List all collections
        const collections = await db.listCollections();
        console.log(`Found ${collections.length} collections:`);
        collections.forEach(col => console.log(`  - ${col.id}`));
        console.log('');

        // Check messages collection
        const messagesSnapshot = await db.collection('messages').get();
        console.log(`Messages collection: ${messagesSnapshot.size} documents`);
        if (messagesSnapshot.size > 0) {
            messagesSnapshot.docs.forEach((doc, index) => {
                const data = doc.data();
                console.log(`\n  Message ${index + 1}:`);
                console.log(`    Doc ID: ${doc.id}`);
                console.log(`    From: ${data.fromId}`);
                console.log(`    To: ${data.toId}`);
                console.log(`    Content: ${data.content}`);
                console.log(`    Timestamp: ${data.timestamp}`);
            });
        }
        console.log('');

        // Check users collection
        const usersSnapshot = await db.collection('users').get();
        console.log(`Users collection: ${usersSnapshot.size} documents`);
        if (usersSnapshot.size > 0) {
            usersSnapshot.docs.forEach((doc, index) => {
                const data = doc.data();
                console.log(`  ${index + 1}. ${data.name} (${data.email})`);
            });
        }
        console.log('');

        console.log('=== DONE ===\n');

    } catch (error) {
        console.error('Error checking data:', error);
    } finally {
        process.exit(0);
    }
}

checkAllData();
