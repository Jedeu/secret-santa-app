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

const LOUIS_ID = '5dfc2873-2b9a-41ea-ba99-e3183a790c37';
const JED_ID = 'd682a601-d636-45aa-a141-2073534c9354';

async function checkMessages() {
    try {
        console.log('\n=== CHECKING MESSAGES ===\n');

        // Expected conversationId
        const expectedConversationId = `santa_${LOUIS_ID}_recipient_${JED_ID}`;
        console.log('Expected conversationId:', expectedConversationId);
        console.log('');

        // Get all messages
        const messagesSnapshot = await db.collection('messages').get();
        console.log(`Total messages in database: ${messagesSnapshot.size}`);
        console.log('');

        // Filter messages involving Louis and Jed
        const louisJedMessages = messagesSnapshot.docs.filter(doc => {
            const data = doc.data();
            return (data.fromId === LOUIS_ID && data.toId === JED_ID) ||
                   (data.fromId === JED_ID && data.toId === LOUIS_ID);
        });

        console.log(`Messages between Louis and Jed: ${louisJedMessages.length}`);
        console.log('');

        if (louisJedMessages.length > 0) {
            console.log('=== MESSAGE DETAILS ===');
            louisJedMessages.forEach((doc, index) => {
                const data = doc.data();
                console.log(`\nMessage ${index + 1}:`);
                console.log('  Document ID:', doc.id);
                console.log('  Message ID:', data.id);
                console.log('  From:', data.fromId === LOUIS_ID ? 'Louis' : 'Jed');
                console.log('  To:', data.toId === LOUIS_ID ? 'Louis' : 'Jed');
                console.log('  Content:', data.content);
                console.log('  Timestamp:', data.timestamp);
                console.log('  ConversationId:', data.conversationId || '(not set)');
                console.log('  Matches expected conversationId:', data.conversationId === expectedConversationId);
            });
        }

        // Check for messages with the expected conversationId
        const conversationMessages = messagesSnapshot.docs.filter(doc => {
            return doc.data().conversationId === expectedConversationId;
        });

        console.log(`\n=== MESSAGES WITH EXPECTED CONVERSATION ID ===`);
        console.log(`Messages with conversationId "${expectedConversationId}": ${conversationMessages.length}`);

        if (conversationMessages.length > 0) {
            conversationMessages.forEach((doc, index) => {
                const data = doc.data();
                console.log(`\nMessage ${index + 1}:`);
                console.log('  From:', data.fromId === LOUIS_ID ? 'Louis' : (data.fromId === JED_ID ? 'Jed' : 'Unknown'));
                console.log('  Content:', data.content);
                console.log('  Timestamp:', data.timestamp);
            });
        }

        console.log('\n=== DONE ===\n');

    } catch (error) {
        console.error('Error checking messages:', error);
    } finally {
        process.exit(0);
    }
}

checkMessages();
