const { APP_COLLECTIONS, getEmulatorFirestore } = require('./lib/emulator-firestore');

// Emulator only (exits 1 for a non-loopback FIRESTORE_EMULATOR_HOST).
const db = getEmulatorFirestore();

// Prints ids, counts and assignment linkage only (no names, emails or message content).
async function checkAllData() {
    let exitCode = 0;
    try {
        console.log('\n=== CHECKING EMULATOR DATA ===\n');

        const lifecycleSnap = await db.collection('system').doc('lifecycle').get();
        if (lifecycleSnap.exists) {
            const { epoch, state } = lifecycleSnap.data();
            console.log(`system/lifecycle: epoch ${epoch}, state ${state}`);
        } else {
            console.log('system/lifecycle: (missing)');
        }
        console.log('');

        for (const collectionName of APP_COLLECTIONS) {
            const snapshot = await db.collection(collectionName).get();
            console.log(`${collectionName}: ${snapshot.size} documents`);
        }
        console.log('');

        const usersSnapshot = await db.collection('users').get();
        console.log('=== USERS (id -> recipientId / gifterId) ===');
        usersSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            console.log(`  ${doc.id} -> recipient ${data.recipientId || '(none)'} / gifter ${data.gifterId || '(none)'}`);
        });
        console.log('');

        const messagesSnapshot = await db.collection('messages').get();
        console.log('=== MESSAGES (id: fromId -> toId, conversationId) ===');
        messagesSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            console.log(`  ${doc.id}: ${data.fromId} -> ${data.toId}, ${data.conversationId || '(no conversationId)'}`);
        });

        console.log('\n=== DONE ===\n');
    } catch (error) {
        console.error('Error checking data:', error?.message || error);
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

checkAllData();
