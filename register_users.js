// Native fetch is used

const users = ['Alice', 'Bob', 'Charlie'];
const baseUrl = 'http://localhost:3000/api/auth';

async function registerUsers() {
    for (const name of users) {
        console.log(`Registering ${name}...`);
        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'login',
                name: name
            })
        });
        const data = await res.json();
        console.log(`Registered ${name}:`, data);
    }
}

registerUsers();
