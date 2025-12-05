const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

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

const LOUIS_ID = '5dfc2873-2b9a-41ea-ba99-e3183a790c37';
const JED_ID = 'd682a601-d636-45aa-a141-2073534c9354';

async function testMessageRouting() {
    try {
        console.log('\n=== TESTING MESSAGE ROUTING ===\n');

        // Generate the conversationId the same way the app does
        const conversationId = `santa_${LOUIS_ID}_recipient_${JED_ID}`;
        console.log('ConversationId:', conversationId);
        console.log('');

        // Create a test message from Louis to Jed (as if Louis sent it from his Recipient tab)
        const testMessage = {
            id: uuidv4(),
            fromId: LOUIS_ID,
            toId: JED_ID,
            content: 'Test message from Louis to Jed',
            timestamp: new Date().toISOString(),
            conversationId: conversationId
        };

        console.log('Creating test message:');
        console.log('  From: Louis');
        console.log('  To: Jed');
        console.log('  Content:', testMessage.content);
        console.log('  ConversationId:', testMessage.conversationId);
        console.log('');

        // Add message to Firestore
        const docRef = await db.collection('messages').add(testMessage);
        console.log('Message created with document ID:', docRef.id);
        console.log('');

        // Verify the message was saved
        const doc = await docRef.get();
        if (doc.exists) {
            console.log('✓ Message successfully saved to Firestore');
            console.log('');

            // Now query to verify it can be retrieved
            const messagesSnapshot = await db.collection('messages')
                .where('conversationId', '==', conversationId)
                .get();

            console.log(`Messages with conversationId "${conversationId}": ${messagesSnapshot.size}`);

            if (messagesSnapshot.size > 0) {
                console.log('✓ Message can be retrieved by conversationId');
            } else {
                console.log('✗ Message NOT found by conversationId query');
            }
        } else {
            console.log('✗ Message was NOT saved');
        }

        console.log('\n=== TEST COMPLETE ===');
        console.log('\nNext steps:');
        console.log('1. Open the app as Jed');
        console.log('2. Check the "Santa" tab');
        console.log('3. You should see the test message from Louis');
        console.log('');

    } catch (error) {
        console.error('Error during test:', error);
    } finally {
        process.exit(0);
    }
}

testMessageRouting();
