const baseUrl = 'http://localhost:3000/api/auth';

async function startExchange() {
    console.log('Starting exchange...');
    const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', name: 'admin' })
    });
    const data = await res.json();
    console.log('Exchange started:', data);
}

startExchange();
