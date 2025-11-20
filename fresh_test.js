// Comprehensive fresh test for Secret Santa app
const baseUrl = 'http://localhost:3000/api';

async function runFreshTest() {
    console.log('🎄 STARTING FRESH SECRET SANTA TEST 🎄\n');
    console.log('='.repeat(60));

    // Step 1: Create 4 users with manual assignments
    console.log('\n📝 STEP 1: Creating users and assignments');
    console.log('-'.repeat(60));

    const alice = await fetch(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            name: 'Alice',
            recipientName: 'Bob'
        })
    }).then(r => r.json());
    console.log('✓ Alice registered (buying for Bob)');

    const bob = await fetch(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            name: 'Bob',
            recipientName: 'Charlie'
        })
    }).then(r => r.json());
    console.log('✓ Bob registered (buying for Charlie)');

    const charlie = await fetch(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            name: 'Charlie',
            recipientName: 'Diana'
        })
    }).then(r => r.json());
    console.log('✓ Charlie registered (buying for Diana)');

    const diana = await fetch(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            name: 'Diana',
            recipientName: 'Alice'
        })
    }).then(r => r.json());
    console.log('✓ Diana registered (buying for Alice)');

    console.log('\n🔄 Secret Santa Circle:');
    console.log('  Alice → Bob → Charlie → Diana → Alice');
    console.log('\n🎅 Who is whose Secret Santa:');
    console.log('  Alice\'s Secret Santa: Diana');
    console.log('  Bob\'s Secret Santa: Alice');
    console.log('  Charlie\'s Secret Santa: Bob');
    console.log('  Diana\'s Secret Santa: Charlie');

    // Step 2: Alice sends a message to Bob (her recipient)
    console.log('\n📨 STEP 2: Alice sends message to her recipient (Bob)');
    console.log('-'.repeat(60));
    await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromId: alice.id,
            toId: bob.id,
            content: 'Hi Bob! What would you like for Christmas? 🎁'
        })
    });
    console.log('✓ Message sent: Alice → Bob');
    console.log('  In Bob\'s view: "Secret Santa → Bob"');
    console.log('  In Alice\'s view: "Alice → Bob"');

    // Step 3: Bob (Alice's recipient) replies to his Secret Santa (Alice)
    console.log('\n📬 STEP 3: Bob replies to his Secret Santa');
    console.log('-'.repeat(60));
    await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromId: bob.id,
            toId: alice.id,
            content: 'Hi Santa! I would love a new book! 📚'
        })
    });
    console.log('✓ Message sent: Bob → Alice (his Secret Santa)');
    console.log('  In Bob\'s view: "Bob → Secret Santa"');
    console.log('  In Alice\'s view: "Bob → Alice"');

    // Step 4: Charlie and Diana have a conversation
    console.log('\n💬 STEP 4: Charlie and Diana exchange messages');
    console.log('-'.repeat(60));
    await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromId: charlie.id,
            toId: diana.id,
            content: 'Hey Diana! Do you prefer chocolate or candy? 🍫'
        })
    });
    console.log('✓ Message sent: Charlie → Diana');

    await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromId: diana.id,
            toId: charlie.id,
            content: 'I love chocolate! Thanks for asking! 😊'
        })
    });
    console.log('✓ Message sent: Diana → Charlie (her Secret Santa)');

    console.log('\n✅ TEST SETUP COMPLETE!');
    console.log('='.repeat(60));
    console.log('\n📋 WHAT TO TEST IN THE BROWSER:');
    console.log('\n1. Login as Alice:');
    console.log('   - Should see chat with Bob (her recipient)');
    console.log('   - Should see chat with Secret Santa (Diana, but name hidden)');
    console.log('   - Should see Bob\'s reply: "Hi Santa! I would love a new book!"');

    console.log('\n2. Public Feed - Bob\'s Gift Exchange:');
    console.log('   - Should show: "Secret Santa → Bob: Hi Bob! What would you like..."');
    console.log('   - Should show: "Bob → Secret Santa: Hi Santa! I would love a new book!"');
    console.log('   - Should NOT reveal that Alice is Bob\'s Secret Santa');

    console.log('\n3. Public Feed - Diana\'s Gift Exchange:');
    console.log('   - Should show: "Secret Santa → Diana: Hey Diana! Do you prefer..."');
    console.log('   - Should show: "Diana → Secret Santa: I love chocolate!"');
    console.log('   - Should NOT reveal that Charlie is Diana\'s Secret Santa');

    console.log('\n4. Anonymity Check:');
    console.log('   - NO thread should reveal who the Secret Santa is');
    console.log('   - All messages from gifters should show as "Secret Santa"');
    console.log('\n');
}

runFreshTest().catch(console.error);
