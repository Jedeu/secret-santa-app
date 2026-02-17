import fs from 'fs';
import path from 'path';
import net from 'net';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const { doc, setDoc } = jest.requireActual('firebase/firestore');

function uniqueProjectId(scope) {
    const nonce = Math.random().toString(36).slice(2, 8);
    return `secret-santa-${scope}-${Date.now()}-${nonce}`;
}

export async function createRulesTestEnv(scope) {
    const rulesPath = path.join(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    return initializeTestEnvironment({
        projectId: uniqueProjectId(scope),
        firestore: {
            host: '127.0.0.1',
            port: 8080,
            rules,
        },
    });
}

export async function assertFirestoreEmulatorReachable(host = '127.0.0.1', port = 8080) {
    const isReachable = await new Promise((resolve) => {
        const socket = net.createConnection({ host, port });

        const cleanup = (reachable) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(reachable);
        };

        socket.setTimeout(500);
        socket.once('connect', () => cleanup(true));
        socket.once('timeout', () => cleanup(false));
        socket.once('error', () => cleanup(false));
    });

    if (!isReachable) {
        throw new Error(
            `Firestore emulator is not reachable at ${host}:${port}. Start it with \"npm run emulators\" before running integration rules tests.`
        );
    }
}

export function authedDb(testEnv, userId, email) {
    return testEnv.authenticatedContext(userId, { email }).firestore();
}

export async function seedUser(testEnv, userId, email, name = userId) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'users', userId), {
            id: userId,
            name,
            email,
            oauthId: null,
            image: null,
            recipientId: null,
            gifterId: null,
        });
    });
}

export async function seedDoc(testEnv, collectionName, docId, data) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, collectionName, docId), data);
    });
}
