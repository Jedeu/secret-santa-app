const { getEmulatorFirestore } = require('./lib/emulator-firestore');

// Usage: node scripts/check_messages.js <santaUserId> <recipientUserId>
const [santaUserId, recipientUserId] = process.argv.slice(2);

if (!santaUserId || !recipientUserId) {
    console.error('Usage: node scripts/check_messages.js <santaUserId> <recipientUserId>');
    process.exit(1);
}

// Emulator only (exits 1 for a non-loopback FIRESTORE_EMULATOR_HOST).
const db = getEmulatorFirestore();

// Prints ids, counts and assignment linkage only (no names, emails or message content).
async function checkMessages() {
    let exitCode = 0;
    try {
        console.log('\n=== CHECKING MESSAGES ===\n');

        const expectedConversationId = `santa_${santaUserId}_recipient_${recipientUserId}`;
        console.log('Expected conversationId:', expectedConversationId);

        const [santaSnap, recipientSnap] = await db.getAll(
            db.collection('users').doc(santaUserId),
            db.collection('users').doc(recipientUserId)
        );
        const santa = santaSnap.exists ? santaSnap.data() : null;
        const recipient = recipientSnap.exists ? recipientSnap.data() : null;
        console.log('Santa exists:', !!santa, '| Recipient exists:', !!recipient);
        console.log('Santa.recipientId matches:', santa?.recipientId === recipientUserId);
        console.log('Recipient.gifterId matches:', recipient?.gifterId === santaUserId);
        console.log('');

        const messagesSnapshot = await db.collection('messages').get();
        console.log(`Total messages in database: ${messagesSnapshot.size}`);

        const pairMessages = messagesSnapshot.docs.filter((doc) => {
            const data = doc.data();
            return (data.fromId === santaUserId && data.toId === recipientUserId)
                || (data.fromId === recipientUserId && data.toId === santaUserId);
        });

        console.log(`Messages between the two users: ${pairMessages.length}`);
        pairMessages.forEach((doc, index) => {
            const data = doc.data();
            console.log(`\nMessage ${index + 1}:`);
            console.log('  Document ID:', doc.id);
            console.log('  Direction:', data.fromId === santaUserId ? 'santa -> recipient' : 'recipient -> santa');
            console.log('  Timestamp:', data.timestamp);
            console.log('  ConversationId:', data.conversationId || '(not set)');
            console.log('  Matches expected conversationId:', data.conversationId === expectedConversationId);
        });

        const conversationMessages = messagesSnapshot.docs.filter((doc) => (
            doc.data().conversationId === expectedConversationId
        ));
        console.log(`\nMessages with the expected conversationId: ${conversationMessages.length}`);

        console.log('\n=== DONE ===\n');
    } catch (error) {
        console.error('Error checking messages:', error?.message || error);
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

checkMessages();
