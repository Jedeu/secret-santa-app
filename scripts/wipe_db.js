const { clearEmulatorFirestore } = require('./lib/emulator-firestore');

// Emulator only (exits 1 for a non-loopback FIRESTORE_EMULATOR_HOST).
// Clears the whole emulator database (every collection and every year, including
// system/lifecycle). Run only against an emulator you started.
async function wipeDatabase() {
    let exitCode = 0;
    try {
        console.log('\n=== WIPING EMULATOR DATABASE ===\n');

        await clearEmulatorFirestore();
        console.log('emulator database cleared');

        console.log('\n=== DATABASE WIPED CLEAN ===\n');
    } catch (error) {
        console.error('Error wiping database:', error?.message || error);
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

wipeDatabase();
