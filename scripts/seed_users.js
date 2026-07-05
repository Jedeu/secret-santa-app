const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { v4: uuidv4 } = require('uuid');

// Hardcoded list of Secret Santa participants
const PARTICIPANTS = [
    { name: 'Jed', email: 'jed.piezas@gmail.com' },
    { name: 'Natalie', email: 'ncammarasana@gmail.com' },
    { name: 'Chinh', email: 'chinhhuynhlmft@gmail.com' },
    { name: 'Gaby', email: 'gabrielle@glim.ca' },
    { name: 'Jana', email: 'jana.j.maclaren@gmail.com' },
    { name: 'Peter', email: 'peter.planta@gmail.com' },
    { name: 'Louis', email: 'ldeschner@gmail.com' },
    { name: 'Genevieve', email: 'genevieve.ayukawa@gmail.com' }
];

// Normalize names to Title Case
function toTitleCase(name) {
    if (!name) return '';
    return name
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

async function seedUsers() {
    // Initialize Firebase Admin
    if (!getApps().length) {
        try {
            if (process.env.FIRESTORE_EMULATOR_HOST) {
                // Local Emulator
                initializeApp({
                    projectId: 'xmasteak-app'
                });
                console.log('🔥 Connected to Firestore Emulator at', process.env.FIRESTORE_EMULATOR_HOST);
            } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
                // Production
                initializeApp({
                    credential: cert({
                        projectId: process.env.FIREBASE_PROJECT_ID,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    }),
                });
                console.log('✅ Connected to Production Firebase');
            } else {
                console.error('❌ Error: Missing environment variables.');
                console.error('For local emulator: Set FIRESTORE_EMULATOR_HOST (e.g., localhost:8080)');
                console.error('For production: Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
                process.exit(1);
            }
        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            process.exit(1);
        }
    }

    const db = getFirestore();
    const usersCollection = db.collection('users');

    console.log('🌱 Seeding users...');

    for (const participant of PARTICIPANTS) {
        try {
            // Check if user already exists by email
            const snapshot = await usersCollection.where('email', '==', participant.email).limit(1).get();

            if (!snapshot.empty) {
                console.log(`ℹ️  User already exists: ${participant.name} (${participant.email})`);
                continue;
            }

            // Create new user
            const newUser = {
                id: uuidv4(),
                name: toTitleCase(participant.name),
                email: participant.email,
                oauthId: null,
                image: null,
                recipientId: null,
                gifterId: null
            };

            await usersCollection.doc(newUser.id).set(newUser);
            console.log(`✅ Created user: ${newUser.name} (${newUser.email})`);

        } catch (error) {
            console.error(`❌ Failed to process user ${participant.name}:`, error);
        }
    }

    console.log('✨ Seeding complete!');
}

seedUsers().catch(console.error);
