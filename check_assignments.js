// Check current user assignments
const baseUrl = 'http://localhost:3000/api/auth';

async function checkAssignments() {
    const res = await fetch(baseUrl);
    const users = await res.json();

    console.log('Current assignments:');
    users.forEach(user => {
        const recipient = users.find(u => u.id === user.recipientId);
        const gifter = users.find(u => u.id === user.gifterId);
        console.log(`${user.name}:`);
        console.log(`  - Buying for: ${recipient?.name || 'None'}`);
        console.log(`  - Getting gift from: ${gifter?.name || 'None'}`);
    });
}

checkAssignments();
