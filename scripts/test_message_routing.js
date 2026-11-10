const { v4: uuidv4 } = require('uuid');
const { getEmulatorFirestore } = require('./lib/emulator-firestore');

// Usage: node scripts/test_message_routing.js <santaUserId> <recipientUserId>
const [santaUserId, recipientUserId] = process.argv.slice(2);

if (!santaUserId || !recipientUserId) {
    console.error('Usage: node scripts/test_message_routing.js <santaUserId> <recipientUserId>');
    process.exit(1);
}

// Emulator only (exits 1 for a non-loopback FIRESTORE_EMULATOR_HOST).
const db = getEmulatorFirestore();

// Prints ids, counts and assignment linkage only.
async function testMessageRouting() {
    let exitCode = 0;
    try {
        console.log('\n=== TESTING MESSAGE ROUTING ===\n');

        // Same rule as /api/messages/send: santa -> recipient requires a reciprocal assignment.
        const [santaSnap, recipientSnap] = await db.getAll(
            db.collection('users').doc(santaUserId),
            db.collection('users').doc(recipientUserId)
        );
        const santa = santaSnap.exists ? santaSnap.data() : null;
        const recipient = recipientSnap.exists ? recipientSnap.data() : null;

        if (!santa || !recipient
            || santa.recipientId !== recipientUserId
            || recipient.gifterId !== santaUserId) {
            console.error('Refusing to write: the users are not reciprocally assigned as santa -> recipient.');
            console.error('Santa exists:', !!santa, '| Recipient exists:', !!recipient);
            console.error('Santa.recipientId matches:', santa?.recipientId === recipientUserId);
            console.error('Recipient.gifterId matches:', recipient?.gifterId === santaUserId);
            exitCode = 1;
            return;
        }

        const conversationId = `santa_${santaUserId}_recipient_${recipientUserId}`;
        console.log('ConversationId:', conversationId);

        const messageId = uuidv4();
        const testMessage = {
            id: messageId,
            fromId: santaUserId,
            toId: recipientUserId,
            content: 'Routing test message',
            timestamp: new Date().toISOString(),
            conversationId,
        };

        const docRef = db.collection('messages').doc(messageId);
        await docRef.create(testMessage);
        console.log('Message created with document ID:', messageId);

        const doc = await docRef.get();
        if (!doc.exists) {
            console.log('✗ Message was NOT saved');
            exitCode = 1;
            return;
        }
        console.log('✓ Message saved');

        const messagesSnapshot = await db.collection('messages')
            .where('conversationId', '==', conversationId)
            .get();
        console.log(`Messages with this conversationId: ${messagesSnapshot.size}`);
        console.log(messagesSnapshot.size > 0
            ? '✓ Message can be retrieved by conversationId'
            : '✗ Message NOT found by conversationId query');

        console.log('\n=== TEST COMPLETE ===');
        console.log('\nNext step: sign in as the recipient and open the Santa tab.\n');
    } catch (error) {
        console.error('Error during test:', error?.message || error);
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

testMessageRouting();
