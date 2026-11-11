/**
 * Admin-side helpers for emulator-backed integration tests (no production hooks).
 *
 * - clearEmulatorFirestore(): deletes every document of the emulator project (all
 *   collections, every year). Loopback hosts only.
 * - snapshotCollections(db, paths): sorted { path, id, data } rows for deep equality.
 * - syntheticParticipantsModule(): full replacement for '@/lib/participants' with
 *   synthetic rosters (2025 = a, b, c, d; 2026 = a, b, c; 2027 = a, b, e).
 * - interceptNextTransaction(db, { afterWork, failAfterWork }): test-only wrapper around
 *   the next db.runTransaction call.
 */

import http from 'node:http';

const EMULATOR_PROJECT_ID = 'xmasteak-app';
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost):\d+$/;

function httpDelete(url) {
    return new Promise((resolve, reject) => {
        const request = http.request(url, { method: 'DELETE' }, (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end();
    });
}

export async function clearEmulatorFirestore() {
    const host = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').trim();
    if (!LOOPBACK_HOST.test(host)) {
        throw new Error('Refusing to clear Firestore: FIRESTORE_EMULATOR_HOST must be a loopback emulator host.');
    }
    const status = await httpDelete(
        `http://${host}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`
    );
    if (status < 200 || status >= 300) {
        throw new Error(`Emulator clear failed with status ${status}`);
    }
}

export async function snapshotCollections(db, paths) {
    const rows = [];
    for (const path of paths) {
        const snapshot = await db.collection(path).get();
        snapshot.docs.forEach((doc) => {
            rows.push({ path, id: doc.id, data: doc.data() });
        });
    }
    return rows.sort((a, b) => {
        const left = `${a.path}/${a.id}`;
        const right = `${b.path}/${b.id}`;
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    });
}

export function syntheticParticipantsModule() {
    const person = (name) => ({ name, email: `${name.toLowerCase()}@example.test` });
    const alpha = person('Alpha');
    const bravo = person('Bravo');
    const charlie = person('Charlie');
    const delta = person('Delta');
    const echo = person('Echo');

    const PARTICIPANTS = [alpha, bravo, charlie, delta, echo];
    const YEAR_ROSTERS = {
        2025: [alpha, bravo, charlie, delta],
        2026: [alpha, bravo, charlie],
        2027: [alpha, bravo, echo],
    };

    const years = () => Object.keys(YEAR_ROSTERS).map(Number).sort((a, b) => a - b);
    const getRoster = (year) => (Number.isInteger(year) && YEAR_ROSTERS[year] ? YEAR_ROSTERS[year] : null);
    const getRosterName = (year, email) => {
        if (typeof email !== 'string' || !email) return null;
        const found = (getRoster(year) || []).find((p) => p.email.toLowerCase() === email.toLowerCase());
        return found ? found.name : null;
    };
    const getRosterEmail = (year, name) => {
        if (typeof name !== 'string' || !name) return null;
        const found = (getRoster(year) || []).find((p) => p.name.toLowerCase() === name.toLowerCase());
        return found ? found.email : null;
    };
    const getRosterNames = (year) => (getRoster(year) || []).map((p) => p.name);
    const isKnownParticipantEmail = (email) => years().some((year) => getRosterName(year, email) !== null);
    const getNextRosterYear = (year) => years().find((configured) => configured > year) ?? null;

    return {
        __esModule: true,
        PARTICIPANTS,
        YEAR_ROSTERS,
        getRoster,
        getRosterName,
        getRosterEmail,
        getRosterNames,
        isKnownParticipantEmail,
        getNextRosterYear,
    };
}

/**
 * Spy on db.runTransaction once: the next call delegates to the real method with a
 * decorated callback that runs the original work, awaits afterWork(), then throws
 * failAfterWork if given (so the transaction rolls back). Later calls are untouched.
 */
export function interceptNextTransaction(db, { afterWork = null, failAfterWork = null } = {}) {
    const original = db.runTransaction.bind(db);
    const spy = jest.spyOn(db, 'runTransaction');
    spy.mockImplementationOnce((callback, ...rest) => original(async (tx) => {
        const result = await callback(tx);
        if (afterWork) {
            await afterWork();
        }
        if (failAfterWork) {
            throw failAfterWork;
        }
        return result;
    }, ...rest));
    return spy;
}

export function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
