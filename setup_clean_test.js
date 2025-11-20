// Create a clean test scenario
const baseUrl = 'http://localhost:3000/api';

async function setupCleanTest() {
    // Clear and recreate users
    console.log('Setting up clean test...\n');

    // Register Emma and Frank
    const emma = await fetch(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            name: 'Emma',
            recipientName: 'Frank'
        })
    }).then(r => r.json());

    const frank = await fetch(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            name: 'Frank',
            recipientName: 'Emma'
        })
    }).then(r => r.json());

    console.log('Created users:');
    console.log('Emma:', emma);
    console.log('Frank:', frank);
    console.log('\nRelationships:');
    console.log('Emma is buying for: Frank');
    console.log('Frank is buying for: Emma');
    console.log('Emma\'s Secret Santa is: Frank');
    console.log('Frank\'s Secret Santa is: Emma\n');

    // Emma sends a message to Frank (her recipient)
    await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromId: emma.id,
            toId: frank.id,
            content: 'Hi Frank! What do you want for Christmas?'
        })
    });
    console.log('✓ Emma → Frank (Emma to her recipient)');

    // Frank sends a message to Emma (his recipient)
    await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fromId: frank.id,
            toId: emma.id,
            content: 'Hi Emma! I love books!'
        })
    });
    console.log('✓ Frank → Emma (Frank to his recipient)');

    console.log('\nIn the public feed:');
    console.log('- Emma\'s Gift Exchange should show:');
    console.log('  * "Secret Santa → Emma" (Frank\'s message, but Frank\'s name hidden)');
    console.log('  * "Emma → Secret Santa" (Emma\'s reply to her Santa)');
    console.log('- Frank\'s Gift Exchange should show:');
    console.log('  * "Secret Santa → Frank" (Emma\'s message, but Emma\'s name hidden)');
    console.log('  * "Frank → Secret Santa" (Frank\'s reply to his Santa)');
}

setupCleanTest();
