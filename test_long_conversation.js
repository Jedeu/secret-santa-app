// Script to create a long conversation for testing scrollability

const baseUrl = 'http://localhost:3000/api';

async function createLongConversation() {
    // First, get Alice's info
    const usersRes = await fetch(`${baseUrl}/auth`);
    const users = await usersRes.json();

    const alice = users.find(u => u.name === 'Alice');
    const bob = users.find(u => u.name === 'Bob');

    if (!alice || !bob) {
        console.log('Alice or Bob not found. Available users:', users);
        return;
    }

    console.log(`Creating conversation between Alice (${alice.id}) and Bob (${bob.id})`);

    // Create 30 messages alternating between Alice and Bob
    for (let i = 1; i <= 30; i++) {
        const isAlice = i % 2 === 1;
        const fromId = isAlice ? alice.id : bob.id;
        const toId = isAlice ? bob.id : alice.id;
        const sender = isAlice ? 'Alice' : 'Bob';

        console.log(`Sending message ${i} from ${sender}...`);

        await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromId: fromId,
                toId: toId,
                content: `Test message ${i} from ${sender}. This is to test scrollability of the chat container when there are many messages.`
            })
        });

        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('Done! Created 30 messages.');
}

createLongConversation().catch(console.error);
