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

/**
 * Seed a users/{userId} profile. Unless `admitted: false`, also seed an active
 * system/lifecycle (epoch 1) and an authIdentities/{userId} admission record, so the
 * test auth uid (=== userId, see authedDb) is an admitted participant under the rules.
 */
export async function seedUser(testEnv, userId, email, name = userId, { admitted = true } = {}) {
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
        if (admitted) {
            await setDoc(doc(db, 'system', 'lifecycle'), { epoch: 1, state: 'active' });
            await setDoc(doc(db, 'authIdentities', userId), { uid: userId, email, userId, epoch: 1 });
        }
    });
}

/**
 * Seed (or remap) an admission record: authIdentities/{authUid} -> userId at `epoch`.
 */
export async function seedIdentity(testEnv, authUid, userId, email, epoch = 1) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'authIdentities', authUid), { uid: authUid, email, userId, epoch });
    });
}

export async function seedDoc(testEnv, collectionName, docId, data) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, collectionName, docId), data);
    });
}
