const { APP_COLLECTIONS, getEmulatorFirestore } = require('./lib/emulator-firestore');

// Emulator only (exits 1 for a non-loopback FIRESTORE_EMULATOR_HOST).
const db = getEmulatorFirestore();

const MAX_BATCH_OPERATIONS = 400;

async function deleteCollection(collectionName) {
    let deleted = 0;
    let snapshot;
    do {
        snapshot = await db.collection(collectionName).limit(MAX_BATCH_OPERATIONS).get();
        if (snapshot.empty) break;
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        deleted += snapshot.size;
    } while (snapshot.size > 0);
    return deleted;
}

async function wipeDatabase() {
    let exitCode = 0;
    try {
        console.log('\n=== WIPING EMULATOR DATABASE ===\n');

        for (const collectionName of APP_COLLECTIONS) {
            const deleted = await deleteCollection(collectionName);
            console.log(`✓ ${collectionName}: deleted ${deleted} documents`);
        }

        // Advance the lifecycle epoch so any stale admission/push state is fenced off.
        const lifecycleRef = db.collection('system').doc('lifecycle');
        const lifecycleSnap = await lifecycleRef.get();
        const previousEpoch = lifecycleSnap.exists ? (lifecycleSnap.data().epoch || 0) : 0;
        const epoch = previousEpoch + 1;
        await lifecycleRef.set({
            epoch,
            state: 'active',
            resetId: null,
            resetStartedAt: null,
            updatedAt: new Date().toISOString(),
        });
        console.log(`✓ system/lifecycle: epoch ${epoch}, active`);

        console.log('\n=== DATABASE WIPED CLEAN ===\n');
    } catch (error) {
        console.error('Error wiping database:', error?.message || error);
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

wipeDatabase();
