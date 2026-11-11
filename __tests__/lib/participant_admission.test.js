import {
    AdmissionError,
    admissionErrorResponse,
    admitParticipant,
    assertAdmissibleToken,
    assertYearOpen,
    closeYear,
    ensureParticipantProfiles,
    normalizeEmail,
    resolveParticipant,
    runFencedTransaction,
    startNewYear,
    toTitleCase,
    verifyAdminRequest,
} from '@/lib/participant-admission';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { ADMIN_EMAILS } from '@/lib/config';

jest.mock('@/lib/firebase', () => ({
    firestore: {},
    auth: { verifyIdToken: jest.fn() },
}));

// Synthetic rosters (no real participant data). Tests may add years to mockRosters.
const mockRosters = {};

jest.mock('@/lib/participants', () => {
    const years = () => Object.keys(mockRosters).map(Number).sort((a, b) => a - b);
    const getRoster = (year) => (Number.isInteger(year) && mockRosters[year] ? mockRosters[year] : null);
    const getRosterName = (year, email) => {
        if (typeof email !== 'string' || !email) return null;
        const found = (getRoster(year) || []).find((p) => String(p.email).toLowerCase() === email.toLowerCase());
        return found ? found.name : null;
    };
    return {
        getRoster,
        getRosterName,
        getRosterEmail: (year, name) => {
            const found = (getRoster(year) || []).find((p) => String(p.name).toLowerCase() === String(name).toLowerCase());
            return found ? found.email : null;
        },
        getRosterNames: (year) => (getRoster(year) || []).map((p) => p.name),
        isKnownParticipantEmail: (email) => years().some((year) => getRosterName(year, email) !== null),
        getNextRosterYear: (year) => years().find((configured) => configured > year) ?? null,
    };
});

const MEMBER_P = { name: 'member', email: 'member@example.test' };
const SECOND_P = { name: 'second', email: 'second@example.test' };
const THIRD_P = { name: 'third', email: 'third@example.test' };

function resetRosters() {
    Object.keys(mockRosters).forEach((key) => delete mockRosters[key]);
    mockRosters[2025] = [MEMBER_P, SECOND_P, THIRD_P];
    mockRosters[2026] = [MEMBER_P, SECOND_P];
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Minimal in-memory Admin Firestore with buffered transactional writes.
 * Collection names may contain '/' (years/2026/users); queries support limit().
 * Mutates `target` so the module's imported `firestore` binding sees it.
 */
function installFakeDb(target, initial = {}) {
    const data = {};
    Object.entries(initial).forEach(([path, value]) => { data[path] = clone(value); });
    const state = { writes: 0, dropWrites: false };

    const snap = (path, id) => {
        const value = data[path];
        return { id, exists: value !== undefined, data: () => clone(value) };
    };
    const docRef = (collectionPath, id) => ({
        __type: 'doc',
        path: `${collectionPath}/${id}`,
        id,
        get: async () => snap(`${collectionPath}/${id}`, id),
    });
    const querySnap = (name, limit = null) => {
        const prefix = `${name}/`;
        let docs = Object.keys(data)
            .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .sort()
            .map((path) => snap(path, path.slice(prefix.length)));
        if (limit !== null) docs = docs.slice(0, limit);
        return { docs, empty: docs.length === 0, size: docs.length };
    };
    const collectionRef = (name) => ({
        __type: 'collection',
        name,
        limitValue: null,
        doc: (id) => docRef(name, id),
        get: async () => querySnap(name),
        limit: (n) => ({ __type: 'collection', name, limitValue: n, get: async () => querySnap(name, n) }),
    });

    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, {
        collection: jest.fn(collectionRef),
        getAll: jest.fn(async (...refs) => refs.map((ref) => snap(ref.path, ref.id))),
        runTransaction: jest.fn(async (fn) => {
            const pending = [];
            const tx = {
                get: async (ref) => (ref.__type === 'collection' ? querySnap(ref.name, ref.limitValue) : snap(ref.path, ref.id)),
                getAll: async (...refs) => refs.map((ref) => snap(ref.path, ref.id)),
                create: (ref, value) => pending.push(['create', ref, value]),
                set: (ref, value) => pending.push(['set', ref, value]),
                update: (ref, value) => pending.push(['update', ref, value]),
                delete: (ref) => pending.push(['delete', ref]),
            };
            const result = await fn(tx);
            if (!state.dropWrites) {
                pending.forEach(([op, ref, value]) => {
                    if (op === 'create' && data[ref.path] !== undefined) {
                        throw new Error(`already exists: ${ref.path}`);
                    }
                    if (op === 'update') {
                        data[ref.path] = { ...data[ref.path], ...clone(value) };
                    } else if (op === 'delete') {
                        delete data[ref.path];
                    } else {
                        data[ref.path] = clone(value);
                    }
                    state.writes += 1;
                });
            }
            return result;
        }),
    });

    return { data, state };
}

function paths(data, prefix) {
    return Object.keys(data).filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
}

const MEMBER = { uid: 'auth-uid-1', email: 'member@example.test', email_verified: true, picture: 'https://example.test/p.png' };
const THIRD = { uid: 'auth-uid-3', email: 'third@example.test', email_verified: true };
const ACTIVE_2025 = { 'system/lifecycle': { epoch: 1, state: 'active', year: 2025, closedYears: [], startedAt: null, closedAt: null } };
const CLOSED_2025 = { 'system/lifecycle': { epoch: 1, state: 'closed', year: 2025, closedYears: [2025], startedAt: null, closedAt: '2025-12-31T00:00:00.000Z' } };
const ACTIVE_2026 = { 'system/lifecycle': { epoch: 2, state: 'active', year: 2026, closedYears: [2025], startedAt: '2026-11-01T00:00:00.000Z', closedAt: null } };
const RESETTING = { 'system/lifecycle': { epoch: 2, state: 'resetting', resetId: 'r', resetStartedAt: 'now' } };

function captureError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('participant-admission', () => {
    let savedNodeEnv;

    beforeEach(() => {
        jest.clearAllMocks();
        resetRosters();
        savedNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        process.env.NODE_ENV = savedNodeEnv;
    });

    describe('pure helpers', () => {
        test('normalizeEmail trims and lowercases; non-strings become empty', () => {
            expect(normalizeEmail('  Member@Example.TEST ')).toBe('member@example.test');
            expect(normalizeEmail(undefined)).toBe('');
        });

        test('toTitleCase', () => {
            expect(toTitleCase('alice smith')).toBe('Alice Smith');
        });

        test('assertAdmissibleToken rejects emails containing a slash', () => {
            const error = captureError(() => assertAdmissibleToken({ uid: 'u', email: 'a/b@example.test', email_verified: true }));
            expect(error).toMatchObject({ code: 'ACCESS_DENIED' });
        });

        test('assertAdmissibleToken requires a uid', () => {
            const error = captureError(() => assertAdmissibleToken({ email: MEMBER.email, email_verified: true }));
            expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
        });

        test('assertAdmissibleToken rejects an email on no roster', () => {
            const error = captureError(() => assertAdmissibleToken({ uid: 'u', email: 'outsider@example.test', email_verified: true }));
            expect(error).toMatchObject({ code: 'ACCESS_DENIED' });
        });

        test('assertAdmissibleToken returns the normalized identity; any roster counts', () => {
            expect(assertAdmissibleToken({ ...MEMBER, email: ' Member@Example.test ' }))
                .toEqual({ uid: 'auth-uid-1', email: 'member@example.test' });
            // On the 2025 roster only: still a known participant at token level.
            expect(assertAdmissibleToken(THIRD)).toEqual({ uid: 'auth-uid-3', email: 'third@example.test' });
        });

        test.each([
            ['UNAUTHENTICATED', 401],
            ['ACCESS_DENIED', 403],
            ['EMAIL_NOT_VERIFIED', 403],
            ['ADMIN_REQUIRED', 403],
            ['PROFILE_CONFLICT', 409],
            ['YEAR_CLOSED', 409],
            ['CLIENT_UPDATE_REQUIRED', 409],
            ['YEAR_NOT_CLOSED', 409],
            ['YEAR_MISMATCH', 409],
            ['STALE_REQUEST', 409],
            ['ROSTER_NOT_CONFIGURED', 409],
            ['YEAR_NOT_EMPTY', 409],
            ['INVALID_YEAR', 400],
            ['SERVICE_UNAVAILABLE', 503],
        ])('%s maps to %i', async (code, status) => {
            const response = admissionErrorResponse(new AdmissionError(code));
            expect(response.status).toBe(status);
            expect((await response.json()).code).toBe(code);
        });

        test('user-facing messages for the new codes', () => {
            expect(new AdmissionError('YEAR_CLOSED').message).toBe("This year's exchange is closed and read-only.");
            expect(new AdmissionError('CLIENT_UPDATE_REQUIRED').message)
                .toBe('A new version of the app is available. Reload the page (or close and reopen the app) to continue.');
        });

        test('admissionErrorResponse ignores other errors', () => {
            expect(admissionErrorResponse(new Error('boom'))).toBeNull();
        });
    });

    describe('admin guards', () => {
        function request(token = 'admin-token') {
            return { headers: { get: (name) => (name === 'Authorization' && token ? `Bearer ${token}` : null) } };
        }

        test('verifyAdminRequest: no token -> UNAUTHENTICATED', async () => {
            await expect(verifyAdminRequest(request(null))).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
        });

        test('verifyAdminRequest: a non-admin -> ADMIN_REQUIRED', async () => {
            adminAuth.verifyIdToken.mockResolvedValue({ uid: 'u', email: MEMBER.email, email_verified: true });
            await expect(verifyAdminRequest(request())).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
        });

        test('verifyAdminRequest: an unverified admin outside development -> EMAIL_NOT_VERIFIED', async () => {
            adminAuth.verifyIdToken.mockResolvedValue({ uid: 'a', email: ADMIN_EMAILS[0], email_verified: false });
            await expect(verifyAdminRequest(request())).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
        });

        test('verifyAdminRequest: a verified admin passes', async () => {
            const decoded = { uid: 'a', email: ADMIN_EMAILS[0].toUpperCase(), email_verified: true };
            adminAuth.verifyIdToken.mockResolvedValue(decoded);
            await expect(verifyAdminRequest(request())).resolves.toBe(decoded);
        });
    });

    describe('admitParticipant', () => {
        test('outsider is rejected with zero writes', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_2025);

            await expect(admitParticipant({ uid: 'x', email: 'outsider@example.test', email_verified: true }))
                .rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
            expect(state.writes).toBe(0);
        });

        test('unverified email is rejected with zero writes outside development', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_2025);

            await expect(admitParticipant({ ...MEMBER, email_verified: false }))
                .rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });
            expect(state.writes).toBe(0);
        });

        test.each([
            ['resetting', RESETTING],
            ['a null year', { 'system/lifecycle': { epoch: 1, state: 'active', year: null } }],
            ['a missing epoch', { 'system/lifecycle': { state: 'active' } }],
            ['duplicate closedYears', { 'system/lifecycle': { epoch: 2, state: 'active', year: 2026, closedYears: [2025, 2025] } }],
        ])('an unavailable lifecycle (%s) -> 503 SERVICE_UNAVAILABLE with zero writes', async (_label, initial) => {
            const { data, state } = installFakeDb(firestore, initial);
            const before = clone(data);

            await expect(admitParticipant(MEMBER)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            expect(state.writes).toBe(0);
            expect(data).toEqual(before);
        });

        test('first admission creates the lifecycle, profile, index and identity', async () => {
            const { data } = installFakeDb(firestore);

            const result = await admitParticipant(MEMBER);

            expect(result).toMatchObject({ created: true, epoch: 1, year: 2025, state: 'active', closedYears: [] });
            const { user } = result;
            expect(data['system/lifecycle']).toEqual({
                epoch: 1,
                state: 'active',
                year: 2025,
                closedYears: [],
                startedAt: null,
                closedAt: null,
                updatedAt: expect.any(String),
            });
            expect(data[`users/${user.id}`]).toEqual({
                id: user.id,
                name: 'Member',
                email: 'member@example.test',
                oauthId: 'auth-uid-1',
                image: 'https://example.test/p.png',
                recipientId: null,
                gifterId: null,
            });
            expect(data['participantIndex/member@example.test']).toMatchObject({ userId: user.id, epoch: 1 });
            expect(data['authIdentities/auth-uid-1']).toMatchObject({
                uid: 'auth-uid-1', email: 'member@example.test', userId: user.id, epoch: 1,
            });
        });

        test('linking an existing profile keeps its UUID and never writes the users doc', async () => {
            const existing = {
                id: 'legacy-uuid', name: 'Member', email: 'member@example.test',
                oauthId: null, image: null, recipientId: 'someone', gifterId: null,
            };
            const { data } = installFakeDb(firestore, { ...ACTIVE_2025, 'users/legacy-uuid': existing });

            const { user, created } = await admitParticipant(MEMBER);

            expect(created).toBe(false);
            expect(user.id).toBe('legacy-uuid');
            expect(data['users/legacy-uuid']).toEqual(existing);
            expect(data['participantIndex/member@example.test']).toMatchObject({ userId: 'legacy-uuid' });
            expect(paths(data, 'users/')).toEqual(['users/legacy-uuid']);
        });

        test.each([
            ['two matching profiles', {
                'users/a': { id: 'a', email: 'member@example.test' },
                'users/b': { id: 'b', email: 'member@example.test' },
            }],
            ['noncanonical casing', {
                'users/a': { id: 'a', email: 'Member@Example.test' },
            }],
            ['doc id / id field mismatch', {
                'users/a': { id: 'b', email: 'member@example.test' },
            }],
            ['a current index pointing at a missing user', {
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'gone', epoch: 1 },
            }],
            ['a current index pointing at another email', {
                'users/other': { id: 'other', email: 'second@example.test' },
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'other', epoch: 1 },
            }],
        ])('%s -> PROFILE_CONFLICT with zero writes', async (_label, extra) => {
            const { state } = installFakeDb(firestore, { ...ACTIVE_2025, ...extra });

            await expect(admitParticipant(MEMBER)).rejects.toMatchObject({ code: 'PROFILE_CONFLICT', status: 409 });
            expect(state.writes).toBe(0);
        });

        test('a stale-epoch index row is treated as absent and overwritten', async () => {
            const { data } = installFakeDb(firestore, {
                ...ACTIVE_2026,
                'users/old-2025': { id: 'old-2025', email: 'member@example.test' },
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'old-2025', epoch: 1 },
            });

            const { user, created, year } = await admitParticipant(MEMBER);

            expect(created).toBe(true);
            expect(year).toBe(2026);
            expect(user.id).not.toBe('old-2025');
            expect(data[`years/2026/users/${user.id}`]).toMatchObject({ email: 'member@example.test', recipientId: null });
            expect(data['participantIndex/member@example.test']).toMatchObject({ userId: user.id, epoch: 2 });
            expect(data['users/old-2025']).toEqual({ id: 'old-2025', email: 'member@example.test' });
        });

        test('in 2026 an existing years/2026 profile is linked', async () => {
            const { data } = installFakeDb(firestore, {
                ...ACTIVE_2026,
                'years/2026/users/u26': { id: 'u26', name: 'Member', email: 'member@example.test' },
            });

            const { user, created } = await admitParticipant(MEMBER);

            expect(created).toBe(false);
            expect(user.id).toBe('u26');
            expect(paths(data, 'years/2026/users/')).toEqual(['years/2026/users/u26']);
            expect(paths(data, 'users/')).toEqual([]);
        });

        test('a member not on the active year roster -> ACCESS_DENIED with zero writes', async () => {
            const { state } = installFakeDb(firestore, {
                ...ACTIVE_2026,
                'users/t25': { id: 't25', email: 'third@example.test' },
            });

            await expect(admitParticipant(THIRD)).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
            expect(state.writes).toBe(0);
        });

        test('closed year: an existing profile is linked (identity and index only, no users write)', async () => {
            const existing = { id: 'm25', name: 'Member', email: 'member@example.test', recipientId: 'x', gifterId: 'y' };
            const { data } = installFakeDb(firestore, { ...CLOSED_2025, 'users/m25': existing });

            const result = await admitParticipant(MEMBER);

            expect(result).toMatchObject({ created: false, state: 'closed', year: 2025, user: { id: 'm25' } });
            expect(data['users/m25']).toEqual(existing);
            expect(paths(data, 'users/')).toEqual(['users/m25']);
            expect(data['authIdentities/auth-uid-1']).toMatchObject({ userId: 'm25', epoch: 1 });
            expect(data['participantIndex/member@example.test']).toMatchObject({ userId: 'm25', epoch: 1 });
            expect(data['system/lifecycle']).toEqual(CLOSED_2025['system/lifecycle']);
        });

        test('closed year: no profile -> ACCESS_DENIED and nothing is created', async () => {
            const { state } = installFakeDb(firestore, CLOSED_2025);

            await expect(admitParticipant(MEMBER)).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
            expect(state.writes).toBe(0);
        });

        test('requireLegacyYear: 2026 -> CLIENT_UPDATE_REQUIRED before any write; 2025 is admitted', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_2026);
            await expect(admitParticipant(MEMBER, { requireLegacyYear: true }))
                .rejects.toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED', status: 409 });
            expect(state.writes).toBe(0);

            installFakeDb(firestore, ACTIVE_2025);
            await expect(admitParticipant(MEMBER, { requireLegacyYear: true })).resolves.toMatchObject({ year: 2025 });
        });

        test('re-admission preserves the identity createdAt and moves it to the current epoch', async () => {
            const { data } = installFakeDb(firestore, {
                'system/lifecycle': { epoch: 2, state: 'active', year: 2026, closedYears: [2025] },
                'years/2026/users/u1': { id: 'u1', email: 'member@example.test' },
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'u1', epoch: 2 },
                'authIdentities/auth-uid-1': {
                    uid: 'auth-uid-1', email: 'member@example.test', userId: 'u0', epoch: 1,
                    createdAt: '2025-12-01T00:00:00.000Z', updatedAt: '2025-12-01T00:00:00.000Z',
                },
            });

            await admitParticipant(MEMBER);

            expect(data['authIdentities/auth-uid-1']).toMatchObject({
                userId: 'u1',
                epoch: 2,
                createdAt: '2025-12-01T00:00:00.000Z',
            });
        });
    });

    describe('resolveParticipant', () => {
        const admitted = {
            'system/lifecycle': { epoch: 2, state: 'active', year: 2026, closedYears: [2025] },
            'years/2026/users/u1': { id: 'u1', email: 'member@example.test' },
            'participantIndex/member@example.test': { email: 'member@example.test', userId: 'u1', epoch: 2 },
            'authIdentities/auth-uid-1': { uid: 'auth-uid-1', email: 'member@example.test', userId: 'u1', epoch: 2 },
        };

        test('a valid admission resolves without a transaction and reports the season', async () => {
            installFakeDb(firestore, admitted);

            const result = await resolveParticipant(MEMBER, { verifyIndex: true });

            expect(result).toMatchObject({
                uid: 'auth-uid-1',
                email: 'member@example.test',
                epoch: 2,
                year: 2026,
                state: 'active',
                closedYears: [2025],
                user: { id: 'u1' },
            });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('an epoch-mismatched identity triggers admission', async () => {
            const { data } = installFakeDb(firestore, {
                ...admitted,
                'authIdentities/auth-uid-1': { ...admitted['authIdentities/auth-uid-1'], epoch: 1 },
            });

            const result = await resolveParticipant(MEMBER, { verifyIndex: true });

            expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
            expect(result.user.id).toBe('u1');
            expect(data['authIdentities/auth-uid-1'].epoch).toBe(2);
        });

        test('an unavailable lifecycle -> SERVICE_UNAVAILABLE', async () => {
            installFakeDb(firestore, { ...admitted, ...RESETTING });

            await expect(resolveParticipant(MEMBER)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('requireLegacyYear in 2026 -> CLIENT_UPDATE_REQUIRED with no transaction', async () => {
            installFakeDb(firestore, admitted);

            await expect(resolveParticipant(MEMBER, { verifyIndex: true, requireLegacyYear: true }))
                .rejects.toMatchObject({ code: 'CLIENT_UPDATE_REQUIRED' });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('a member not on the active roster -> ACCESS_DENIED with no transaction', async () => {
            installFakeDb(firestore, admitted);

            await expect(resolveParticipant(THIRD)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('a closed year resolves the existing admission', async () => {
            installFakeDb(firestore, {
                ...CLOSED_2025,
                'users/u1': { id: 'u1', email: 'member@example.test' },
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'u1', epoch: 1 },
                'authIdentities/auth-uid-1': { uid: 'auth-uid-1', email: 'member@example.test', userId: 'u1', epoch: 1 },
            });

            await expect(resolveParticipant(MEMBER, { verifyIndex: true }))
                .resolves.toMatchObject({ state: 'closed', year: 2025, closedYears: [2025], user: { id: 'u1' } });
        });
    });

    describe('runFencedTransaction', () => {
        test('admission required on the first attempt -> admits, then retries once; ctx carries the year', async () => {
            installFakeDb(firestore, ACTIVE_2025);
            const work = jest.fn(async (tx, ctx) => ctx.user.id);

            const userId = await runFencedTransaction(MEMBER, work);

            expect(work).toHaveBeenCalledTimes(1);
            expect(work.mock.calls[0][1]).toMatchObject({
                uid: 'auth-uid-1', email: 'member@example.test', epoch: 1, year: 2025, state: 'active',
            });
            expect(typeof userId).toBe('string');
            // attempt (fails) + admission + retry
            expect(firestore.runTransaction).toHaveBeenCalledTimes(3);
        });

        test('a second admission-required failure -> SERVICE_UNAVAILABLE', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_2025);
            state.dropWrites = true; // admission "commits" nothing
            const work = jest.fn();

            await expect(runFencedTransaction(MEMBER, work)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
            expect(work).not.toHaveBeenCalled();
        });

        test('an unavailable lifecycle is not retried', async () => {
            installFakeDb(firestore, RESETTING);

            await expect(runFencedTransaction(MEMBER, jest.fn())).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
            expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
        });

        test('a closed year -> YEAR_CLOSED before any admission write', async () => {
            const { state } = installFakeDb(firestore, {
                ...CLOSED_2025,
                'users/u1': { id: 'u1', email: 'member@example.test' },
            });
            const work = jest.fn();

            await expect(runFencedTransaction(MEMBER, work)).rejects.toMatchObject({ code: 'YEAR_CLOSED', status: 409 });
            expect(work).not.toHaveBeenCalled();
            expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
            expect(state.writes).toBe(0);
        });

        test('allowClosed runs the work in a closed year', async () => {
            installFakeDb(firestore, {
                ...CLOSED_2025,
                'users/u1': { id: 'u1', email: 'member@example.test' },
                'authIdentities/auth-uid-1': { uid: 'auth-uid-1', email: 'member@example.test', userId: 'u1', epoch: 1 },
            });
            const work = jest.fn(async (tx, ctx) => ctx);

            const ctx = await runFencedTransaction(MEMBER, work, { allowClosed: true });

            expect(ctx).toMatchObject({ state: 'closed', year: 2025, epoch: 1, user: { id: 'u1' } });
            expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
        });

        test('a member not on the active roster -> ACCESS_DENIED', async () => {
            installFakeDb(firestore, ACTIVE_2026);

            await expect(runFencedTransaction(THIRD, jest.fn())).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
        });

        test('in 2026 the profile is read from years/2026/users', async () => {
            installFakeDb(firestore, {
                ...ACTIVE_2026,
                'years/2026/users/u1': { id: 'u1', email: 'member@example.test' },
                'authIdentities/auth-uid-1': { uid: 'auth-uid-1', email: 'member@example.test', userId: 'u1', epoch: 2 },
            });

            const ctx = await runFencedTransaction(MEMBER, async (tx, context) => context);

            expect(ctx).toMatchObject({ year: 2026, epoch: 2, user: { id: 'u1' } });
        });
    });

    describe('ensureParticipantProfiles', () => {
        test('creates the active roster profiles without an identity', async () => {
            const { data } = installFakeDb(firestore, ACTIVE_2025);

            const result = await ensureParticipantProfiles();

            expect(result).toEqual({ year: 2025, created: 3, linked: 0, existing: 0 });
            const users = paths(data, 'users/').map((path) => data[path]);
            expect(users).toHaveLength(3);
            users.forEach((user) => {
                expect(user.oauthId).toBeNull();
                expect(user.image).toBeNull();
            });
            expect(users.map((user) => user.name).sort()).toEqual(['Member', 'Second', 'Third']);
            expect(Object.keys(data).some((path) => path.startsWith('authIdentities/'))).toBe(false);
        });

        test('a missing lifecycle is created at epoch 1 for 2025', async () => {
            const { data } = installFakeDb(firestore);

            await ensureParticipantProfiles();

            expect(data['system/lifecycle']).toMatchObject({ epoch: 1, state: 'active', year: 2025, closedYears: [] });
        });

        test('in 2026 seeds the 2026 roster into years/2026/users', async () => {
            const { data } = installFakeDb(firestore, ACTIVE_2026);

            const result = await ensureParticipantProfiles();

            expect(result).toEqual({ year: 2026, created: 2, linked: 0, existing: 0 });
            expect(paths(data, 'years/2026/users/')).toHaveLength(2);
            expect(paths(data, 'users/')).toEqual([]);
        });

        test('counts conflicts and throws PROFILE_CONFLICT after processing all participants', async () => {
            const { data } = installFakeDb(firestore, {
                ...ACTIVE_2025,
                'users/a': { id: 'a', email: 'member@example.test' },
                'users/b': { id: 'b', email: 'member@example.test' },
            });

            await expect(ensureParticipantProfiles())
                .rejects.toMatchObject({ code: 'PROFILE_CONFLICT', conflicts: 1 });
            // The non-conflicting participants were still processed.
            expect(data['participantIndex/second@example.test']).toBeDefined();
            expect(data['participantIndex/third@example.test']).toBeDefined();
        });

        test('a closed year -> YEAR_CLOSED with zero writes', async () => {
            const { state } = installFakeDb(firestore, CLOSED_2025);

            await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'YEAR_CLOSED' });
            expect(state.writes).toBe(0);
        });

        test('an unavailable lifecycle -> SERVICE_UNAVAILABLE', async () => {
            installFakeDb(firestore, RESETTING);

            await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('no roster for the active year -> ROSTER_NOT_CONFIGURED', async () => {
            installFakeDb(firestore, {
                'system/lifecycle': { epoch: 3, state: 'active', year: 2027, closedYears: [2025, 2026] },
            });

            await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'ROSTER_NOT_CONFIGURED' });
        });

        test('the year changing mid-run -> YEAR_MISMATCH', async () => {
            const { data } = installFakeDb(firestore, ACTIVE_2025);
            const realRun = firestore.runTransaction.getMockImplementation();
            firestore.runTransaction.mockImplementationOnce(async (fn) => {
                data['system/lifecycle'] = clone(ACTIVE_2026['system/lifecycle']);
                return realRun(fn);
            });

            await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'YEAR_MISMATCH' });
            expect(paths(data, 'users/')).toEqual([]);
        });

        test('the year closing mid-run -> YEAR_CLOSED', async () => {
            const { data } = installFakeDb(firestore, ACTIVE_2025);
            const realRun = firestore.runTransaction.getMockImplementation();
            firestore.runTransaction.mockImplementationOnce(async (fn) => {
                data['system/lifecycle'] = clone(CLOSED_2025['system/lifecycle']);
                return realRun(fn);
            });

            await expect(ensureParticipantProfiles()).rejects.toMatchObject({ code: 'YEAR_CLOSED' });
            expect(paths(data, 'users/')).toEqual([]);
        });
    });

    describe('assertYearOpen', () => {
        async function inTransaction() {
            return firestore.runTransaction((tx) => assertYearOpen(tx));
        }

        test('an open year returns its epoch and year', async () => {
            installFakeDb(firestore, ACTIVE_2026);
            await expect(inTransaction()).resolves.toEqual({ epoch: 2, year: 2026 });
        });

        test.each([
            ['missing', {}, 'SERVICE_UNAVAILABLE'],
            ['unavailable', RESETTING, 'SERVICE_UNAVAILABLE'],
            ['closed', CLOSED_2025, 'YEAR_CLOSED'],
        ])('%s -> %s', async (_label, initial, code) => {
            installFakeDb(firestore, initial);
            await expect(inTransaction()).rejects.toMatchObject({ code });
        });
    });

    describe('closeYear', () => {
        test('closes the open year in place: same epoch, year listed, closedAt set', async () => {
            const { data } = installFakeDb(firestore, ACTIVE_2026);

            const result = await closeYear({ year: 2026 });

            expect(result).toEqual({ year: 2026, state: 'closed', epoch: 2, closedYears: [2025, 2026], changed: true });
            expect(data['system/lifecycle']).toEqual({
                epoch: 2,
                state: 'closed',
                year: 2026,
                closedYears: [2025, 2026],
                startedAt: '2026-11-01T00:00:00.000Z',
                closedAt: expect.any(String),
                updatedAt: expect.any(String),
            });
        });

        test('a missing lifecycle is created closed at epoch 1', async () => {
            const { data } = installFakeDb(firestore);

            await expect(closeYear({ year: 2025 })).resolves.toMatchObject({ changed: true, epoch: 1, closedYears: [2025] });
            expect(data['system/lifecycle']).toMatchObject({ epoch: 1, state: 'closed', year: 2025, closedYears: [2025], startedAt: null });
        });

        test('an already closed year -> changed false with zero writes', async () => {
            const { state } = installFakeDb(firestore, CLOSED_2025);

            await expect(closeYear({ year: 2025 })).resolves.toMatchObject({ changed: false, state: 'closed' });
            expect(state.writes).toBe(0);
        });

        test('an earlier listed year -> changed false; an unlisted earlier or a later year -> YEAR_MISMATCH', async () => {
            installFakeDb(firestore, ACTIVE_2026);
            await expect(closeYear({ year: 2025 })).resolves.toMatchObject({ changed: false, year: 2026, state: 'active' });

            const { state } = installFakeDb(firestore, ACTIVE_2026);
            await expect(closeYear({ year: 2027 })).rejects.toMatchObject({ code: 'YEAR_MISMATCH' });

            installFakeDb(firestore, { 'system/lifecycle': { epoch: 3, state: 'active', year: 2028, closedYears: [2025, 2026] } });
            await expect(closeYear({ year: 2027 })).rejects.toMatchObject({ code: 'YEAR_MISMATCH' });
            expect(state.writes).toBe(0);
        });

        test.each([2024, '2025', null, 2025.5])('an invalid year %p -> INVALID_YEAR with no transaction', async (year) => {
            installFakeDb(firestore, ACTIVE_2025);
            await expect(closeYear({ year })).rejects.toMatchObject({ code: 'INVALID_YEAR', status: 400 });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test('an unavailable lifecycle -> 503 with zero writes', async () => {
            const { state } = installFakeDb(firestore, RESETTING);
            await expect(closeYear({ year: 2025 })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            expect(state.writes).toBe(0);
        });
    });

    describe('startNewYear', () => {
        test('creates one profile per roster entry, points the index at them and activates the year', async () => {
            const { data } = installFakeDb(firestore, {
                ...CLOSED_2025,
                'users/old': { id: 'old', email: 'member@example.test' },
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'old', epoch: 1 },
                'participantIndex/third@example.test': { email: 'third@example.test', userId: 'old-third', epoch: 1 },
            });

            const result = await startNewYear({ fromYear: 2025, targetYear: 2026 });

            expect(result).toEqual({ year: 2026, state: 'active', epoch: 2, closedYears: [2025], changed: true, participants: 2 });
            expect(data['system/lifecycle']).toEqual({
                epoch: 2,
                state: 'active',
                year: 2026,
                closedYears: [2025],
                startedAt: expect.any(String),
                closedAt: null,
                updatedAt: expect.any(String),
            });
            const profiles = paths(data, 'years/2026/users/').map((path) => data[path]);
            expect(profiles.map((p) => p.email).sort()).toEqual(['member@example.test', 'second@example.test']);
            profiles.forEach((profile) => {
                expect(profile).toMatchObject({ oauthId: null, image: null, recipientId: null, gifterId: null });
                expect(data[`participantIndex/${profile.email}`]).toMatchObject({ userId: profile.id, epoch: 2 });
            });
            expect(profiles.map((p) => p.name).sort()).toEqual(['Member', 'Second']);
            // History and the excluded member's inert row are untouched.
            expect(data['users/old']).toEqual({ id: 'old', email: 'member@example.test' });
            expect(data['participantIndex/third@example.test']).toMatchObject({ epoch: 1 });
        });

        test('the target year already active -> changed false with participants null and zero writes', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_2026);

            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 }))
                .resolves.toEqual({ year: 2026, state: 'active', epoch: 2, closedYears: [2025], changed: false, participants: null });
            expect(state.writes).toBe(0);
        });

        test.each([
            ['fromYear invalid', 2024, 2026],
            ['fromYear a string', '2025', 2026],
            ['targetYear equal', 2025, 2025],
            ['targetYear earlier', 2026, 2025],
        ])('%s -> INVALID_YEAR with no transaction', async (_label, fromYear, targetYear) => {
            installFakeDb(firestore, CLOSED_2025);
            await expect(startNewYear({ fromYear, targetYear })).rejects.toMatchObject({ code: 'INVALID_YEAR', status: 400 });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test.each([
            ['missing', null],
            ['too small', [MEMBER_P]],
            ['too large', Array.from({ length: 201 }, (_, i) => ({ name: `p${i}`, email: `p${i}@example.test` }))],
            ['non-canonical email', [MEMBER_P, { name: 'upper', email: 'Upper@example.test' }]],
            ['email with a slash', [MEMBER_P, { name: 'slash', email: 'a/b@example.test' }]],
            ['duplicate email', [MEMBER_P, { name: 'other', email: MEMBER_P.email }]],
            ['duplicate name', [MEMBER_P, { name: 'MEMBER', email: 'other@example.test' }]],
        ])('roster %s -> ROSTER_NOT_CONFIGURED with no transaction', async (_label, roster) => {
            if (roster) mockRosters[2027] = roster;
            installFakeDb(firestore, {
                'system/lifecycle': { epoch: 2, state: 'closed', year: 2026, closedYears: [2025, 2026] },
            });

            await expect(startNewYear({ fromYear: 2026, targetYear: 2027 }))
                .rejects.toMatchObject({ code: 'ROSTER_NOT_CONFIGURED', status: 409 });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
        });

        test.each([
            ['a later year is active', { epoch: 3, state: 'active', year: 2027, closedYears: [2025, 2026] }, 2025, 2026, 'STALE_REQUEST'],
            ['the from year is not the current year', { epoch: 1, state: 'closed', year: 2025, closedYears: [2025] }, 2026, 2027, 'YEAR_MISMATCH'],
            ['the from year is still active', { epoch: 2, state: 'active', year: 2026, closedYears: [2025] }, 2026, 2027, 'YEAR_NOT_CLOSED'],
        ])('%s -> refused with zero writes', async (_label, lifecycle, fromYear, targetYear, code) => {
            mockRosters[2027] = [MEMBER_P, SECOND_P];
            const { state } = installFakeDb(firestore, { 'system/lifecycle': lifecycle });

            await expect(startNewYear({ fromYear, targetYear })).rejects.toMatchObject({ code, status: 409 });
            expect(state.writes).toBe(0);
        });

        test('a missing lifecycle -> YEAR_NOT_CLOSED', async () => {
            const { state } = installFakeDb(firestore);
            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 })).rejects.toMatchObject({ code: 'YEAR_NOT_CLOSED' });
            expect(state.writes).toBe(0);
        });

        test('an unavailable lifecycle -> 503 with zero writes', async () => {
            const { state } = installFakeDb(firestore, RESETTING);
            await expect(startNewYear({ fromYear: 2025, targetYear: 2026 }))
                .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            expect(state.writes).toBe(0);
        });

        test.each(['users', 'messages', 'reactions', 'lastRead', 'typing'])(
            'a document in years/2026/%s -> YEAR_NOT_EMPTY with zero writes',
            async (name) => {
                const { state } = installFakeDb(firestore, { ...CLOSED_2025, [`years/2026/${name}/x`]: { marker: true } });

                await expect(startNewYear({ fromYear: 2025, targetYear: 2026 }))
                    .rejects.toMatchObject({ code: 'YEAR_NOT_EMPTY', status: 409 });
                expect(state.writes).toBe(0);
            }
        );
    });
});
