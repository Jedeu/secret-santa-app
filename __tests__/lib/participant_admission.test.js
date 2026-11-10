import {
    AdmissionError,
    admissionErrorResponse,
    admitParticipant,
    assertAdmissibleToken,
    ensureParticipantProfiles,
    normalizeEmail,
    resolveParticipant,
    runFencedTransaction,
    toTitleCase,
} from '@/lib/participant-admission';
import { firestore } from '@/lib/firebase';

jest.mock('@/lib/firebase', () => ({
    firestore: {},
    auth: { verifyIdToken: jest.fn() },
}));

// Synthetic participant list (no real participant data).
jest.mock('@/lib/participants', () => {
    const list = {
        'member@example.test': 'Member',
        'second@example.test': 'Second',
    };
    return {
        getParticipantName: (email) => list[String(email).toLowerCase()] || null,
    };
});

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Minimal in-memory Admin Firestore with buffered transactional writes.
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
    const docRef = (collection, id) => ({
        __type: 'doc',
        path: `${collection}/${id}`,
        id,
        get: async () => snap(`${collection}/${id}`, id),
    });
    const querySnap = (name) => {
        const docs = Object.keys(data)
            .filter((path) => path.split('/').length === 2 && path.startsWith(`${name}/`))
            .map((path) => snap(path, path.split('/')[1]));
        return { docs, empty: docs.length === 0, size: docs.length };
    };
    const collectionRef = (name) => ({
        __type: 'collection',
        name,
        doc: (id) => docRef(name, id),
        get: async () => querySnap(name),
    });

    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, {
        collection: jest.fn(collectionRef),
        getAll: jest.fn(async (...refs) => refs.map((ref) => snap(ref.path, ref.id))),
        runTransaction: jest.fn(async (fn) => {
            const pending = [];
            const tx = {
                get: async (ref) => (ref.__type === 'collection' ? querySnap(ref.name) : snap(ref.path, ref.id)),
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

const MEMBER = { uid: 'auth-uid-1', email: 'member@example.test', email_verified: true, picture: 'https://example.test/p.png' };
const ACTIVE_EPOCH_1 = { 'system/lifecycle': { epoch: 1, state: 'active', resetId: null, resetStartedAt: null } };

describe('participant-admission', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('pure helpers', () => {
        test('normalizeEmail trims and lowercases; non-strings become empty', () => {
            expect(normalizeEmail('  Member@Example.TEST ')).toBe('member@example.test');
            expect(normalizeEmail(undefined)).toBe('');
        });

        test('toTitleCase', () => {
            expect(toTitleCase('alice smith')).toBe('Alice Smith');
        });

        function captureError(fn) {
            try {
                fn();
            } catch (error) {
                return error;
            }
            return null;
        }

        test('assertAdmissibleToken rejects emails containing a slash', () => {
            const error = captureError(() => assertAdmissibleToken({ uid: 'u', email: 'a/b@example.test', email_verified: true }));
            expect(error).toMatchObject({ code: 'ACCESS_DENIED' });
        });

        test('assertAdmissibleToken requires a uid', () => {
            const error = captureError(() => assertAdmissibleToken({ email: MEMBER.email, email_verified: true }));
            expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
        });

        test('assertAdmissibleToken returns the normalized identity', () => {
            expect(assertAdmissibleToken({ ...MEMBER, email: ' Member@Example.test ' }))
                .toEqual({ uid: 'auth-uid-1', email: 'member@example.test', name: 'Member' });
        });

        test.each([
            ['UNAUTHENTICATED', 401],
            ['ACCESS_DENIED', 403],
            ['EMAIL_NOT_VERIFIED', 403],
            ['PROFILE_CONFLICT', 409],
            ['RESET_SUPERSEDED', 409],
            ['RESET_IN_PROGRESS', 503],
            ['SERVICE_UNAVAILABLE', 503],
        ])('%s maps to %i', async (code, status) => {
            const response = admissionErrorResponse(new AdmissionError(code));
            expect(response.status).toBe(status);
            expect((await response.json()).code).toBe(code);
        });

        test('admissionErrorResponse ignores other errors', () => {
            expect(admissionErrorResponse(new Error('boom'))).toBeNull();
        });
    });

    describe('admitParticipant', () => {
        test('outsider is rejected with zero writes', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_EPOCH_1);

            await expect(admitParticipant({ uid: 'x', email: 'outsider@example.test', email_verified: true }))
                .rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
            expect(firestore.runTransaction).not.toHaveBeenCalled();
            expect(state.writes).toBe(0);
        });

        test('unverified email is rejected with zero writes outside development', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_EPOCH_1);

            await expect(admitParticipant({ ...MEMBER, email_verified: false }))
                .rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });
            expect(state.writes).toBe(0);
        });

        test('resetting lifecycle -> 503 RESET_IN_PROGRESS with zero writes', async () => {
            const { state } = installFakeDb(firestore, {
                'system/lifecycle': { epoch: 2, state: 'resetting', resetId: 'r', resetStartedAt: 'now' },
            });

            await expect(admitParticipant(MEMBER)).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS', status: 503 });
            expect(state.writes).toBe(0);
        });

        test('first admission creates lifecycle, profile, index and identity', async () => {
            const { data } = installFakeDb(firestore);

            const { user, created } = await admitParticipant(MEMBER);

            expect(created).toBe(true);
            expect(data['system/lifecycle']).toMatchObject({ epoch: 1, state: 'active' });
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
            const { data } = installFakeDb(firestore, { ...ACTIVE_EPOCH_1, 'users/legacy-uuid': existing });

            const { user, created } = await admitParticipant(MEMBER);

            expect(created).toBe(false);
            expect(user.id).toBe('legacy-uuid');
            expect(data['users/legacy-uuid']).toEqual(existing);
            expect(data['participantIndex/member@example.test']).toMatchObject({ userId: 'legacy-uuid' });
            expect(Object.keys(data).filter((path) => path.startsWith('users/'))).toEqual(['users/legacy-uuid']);
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
            ['index pointing at a missing user', {
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'gone', epoch: 1 },
            }],
        ])('%s -> PROFILE_CONFLICT with zero writes', async (_label, extra) => {
            const { state } = installFakeDb(firestore, { ...ACTIVE_EPOCH_1, ...extra });

            await expect(admitParticipant(MEMBER)).rejects.toMatchObject({ code: 'PROFILE_CONFLICT', status: 409 });
            expect(state.writes).toBe(0);
        });

        test('re-admission preserves the identity createdAt and moves it to the current epoch', async () => {
            const { data } = installFakeDb(firestore, {
                'system/lifecycle': { epoch: 2, state: 'active' },
                'users/u1': { id: 'u1', email: 'member@example.test' },
                'participantIndex/member@example.test': { email: 'member@example.test', userId: 'u1', epoch: 2 },
                'authIdentities/auth-uid-1': {
                    uid: 'auth-uid-1', email: 'member@example.test', userId: 'u1', epoch: 1,
                    createdAt: '2025-12-01T00:00:00.000Z', updatedAt: '2025-12-01T00:00:00.000Z',
                },
            });

            await admitParticipant(MEMBER);

            expect(data['authIdentities/auth-uid-1']).toMatchObject({
                epoch: 2,
                createdAt: '2025-12-01T00:00:00.000Z',
            });
        });
    });

    describe('resolveParticipant', () => {
        const admitted = {
            'system/lifecycle': { epoch: 2, state: 'active' },
            'users/u1': { id: 'u1', email: 'member@example.test' },
            'participantIndex/member@example.test': { email: 'member@example.test', userId: 'u1', epoch: 2 },
            'authIdentities/auth-uid-1': { uid: 'auth-uid-1', email: 'member@example.test', userId: 'u1', epoch: 2 },
        };

        test('a valid admission resolves without a transaction', async () => {
            installFakeDb(firestore, admitted);

            const result = await resolveParticipant(MEMBER, { verifyIndex: true });

            expect(result).toMatchObject({ uid: 'auth-uid-1', email: 'member@example.test', epoch: 2, user: { id: 'u1' } });
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

        test('resetting lifecycle -> RESET_IN_PROGRESS', async () => {
            installFakeDb(firestore, { ...admitted, 'system/lifecycle': { epoch: 3, state: 'resetting' } });

            await expect(resolveParticipant(MEMBER)).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS' });
        });
    });

    describe('runFencedTransaction', () => {
        test('admission required on the first attempt -> admits, then retries once', async () => {
            installFakeDb(firestore, ACTIVE_EPOCH_1);
            const work = jest.fn(async (tx, ctx) => ctx.user.id);

            const userId = await runFencedTransaction(MEMBER, work);

            expect(work).toHaveBeenCalledTimes(1);
            expect(work.mock.calls[0][1]).toMatchObject({ uid: 'auth-uid-1', email: 'member@example.test', epoch: 1 });
            expect(typeof userId).toBe('string');
            // attempt (fails) + admission + retry
            expect(firestore.runTransaction).toHaveBeenCalledTimes(3);
        });

        test('a second admission-required failure -> SERVICE_UNAVAILABLE', async () => {
            const { state } = installFakeDb(firestore, ACTIVE_EPOCH_1);
            state.dropWrites = true; // admission "commits" nothing
            const work = jest.fn();

            await expect(runFencedTransaction(MEMBER, work)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
            expect(work).not.toHaveBeenCalled();
        });

        test('RESET_IN_PROGRESS is not retried', async () => {
            installFakeDb(firestore, { 'system/lifecycle': { epoch: 2, state: 'resetting' } });

            await expect(runFencedTransaction(MEMBER, jest.fn())).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS' });
            expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
        });
    });

    describe('ensureParticipantProfiles', () => {
        const participants = [
            { name: 'member', email: 'member@example.test' },
            { name: 'second', email: 'second@example.test' },
        ];

        test('creates missing profiles without an identity', async () => {
            const { data } = installFakeDb(firestore, ACTIVE_EPOCH_1);

            const counts = await ensureParticipantProfiles(participants);

            expect(counts).toEqual({ created: 2, linked: 0, existing: 0 });
            const users = Object.entries(data).filter(([path]) => path.startsWith('users/')).map(([, user]) => user);
            expect(users).toHaveLength(2);
            users.forEach((user) => {
                expect(user.oauthId).toBeNull();
                expect(user.image).toBeNull();
            });
            expect(users.map((user) => user.name).sort()).toEqual(['Member', 'Second']);
            expect(Object.keys(data).some((path) => path.startsWith('authIdentities/'))).toBe(false);
        });

        test('counts conflicts and throws PROFILE_CONFLICT after processing all participants', async () => {
            const { data } = installFakeDb(firestore, {
                ...ACTIVE_EPOCH_1,
                'users/a': { id: 'a', email: 'member@example.test' },
                'users/b': { id: 'b', email: 'member@example.test' },
            });

            await expect(ensureParticipantProfiles(participants))
                .rejects.toMatchObject({ code: 'PROFILE_CONFLICT', conflicts: 1 });
            // The non-conflicting participant was still processed.
            expect(data['participantIndex/second@example.test']).toBeDefined();
        });

        test('a reset id requires a matching resetting lifecycle', async () => {
            installFakeDb(firestore, { 'system/lifecycle': { epoch: 2, state: 'resetting', resetId: 'reset-new' } });

            await expect(ensureParticipantProfiles(participants, { resetId: 'reset-old' }))
                .rejects.toMatchObject({ code: 'RESET_SUPERSEDED' });
        });

        test('without a reset id an inactive lifecycle -> RESET_IN_PROGRESS', async () => {
            installFakeDb(firestore, { 'system/lifecycle': { epoch: 2, state: 'resetting', resetId: 'r' } });

            await expect(ensureParticipantProfiles(participants)).rejects.toMatchObject({ code: 'RESET_IN_PROGRESS' });
        });
    });
});
