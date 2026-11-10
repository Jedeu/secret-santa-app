import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { getParticipantName } from '@/lib/participants';

/**
 * Server-side participant admission, lifecycle fencing and reset protocol.
 *
 * Admin SDK only. Must not import '@/lib/firestore' (which imports this module).
 *
 * Server-only collections (the Firestore catch-all rule denies clients):
 * - system/lifecycle:          { epoch, state: 'active'|'resetting', resetId, resetStartedAt, updatedAt }
 * - authIdentities/{authUid}:  { uid, email, userId, epoch, createdAt, updatedAt }
 * - participantIndex/{email}:  { email, userId, epoch, createdAt }
 */

const LIFECYCLE_COLLECTION = 'system';
const LIFECYCLE_DOC = 'lifecycle';
const IDENTITIES_COLLECTION = 'authIdentities';
const INDEX_COLLECTION = 'participantIndex';
const USERS_COLLECTION = 'users';

const ADMISSION_REQUIRED = 'ADMISSION_REQUIRED';

const ERROR_DEFINITIONS = {
    UNAUTHENTICATED: { status: 401, message: 'Unauthorized: Invalid or missing token' },
    ACCESS_DENIED: { status: 403, message: 'Access denied: this account is not on the participant list' },
    EMAIL_NOT_VERIFIED: { status: 403, message: 'Your email address must be verified before you can sign in' },
    PROFILE_CONFLICT: { status: 409, message: 'Your profile could not be set up automatically. Ask an admin for help.' },
    RESET_SUPERSEDED: { status: 409, message: 'Another reset started and replaced this one' },
    RESET_IN_PROGRESS: { status: 503, message: 'A reset is in progress. Try again shortly.' },
    SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable. Try again shortly.' },
    // Internal sentinel: never leaves runFencedTransaction.
    [ADMISSION_REQUIRED]: { status: 503, message: 'Admission required' },
};

export class AdmissionError extends Error {
    constructor(code, message = null) {
        const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.SERVICE_UNAVAILABLE;
        super(message || definition.message);
        this.name = 'AdmissionError';
        this.code = code;
        this.status = definition.status;
        this.isAdmissionError = true;
    }
}

function isAdmissionRequired(error) {
    return error?.isAdmissionError === true && error.code === ADMISSION_REQUIRED;
}

// --- Pure helpers ---

export function toTitleCase(name) {
    if (!name) return '';
    return String(name)
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

export function normalizeEmail(email) {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

export function requiresVerifiedEmail() {
    return process.env.NODE_ENV !== 'development';
}

export function getBearerToken(request) {
    const authHeader = request?.headers?.get?.('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7).trim();
    return token || null;
}

export async function verifyRequestToken(request) {
    const token = getBearerToken(request);
    if (!token) {
        throw new AdmissionError('UNAUTHENTICATED', 'Unauthorized: No token provided');
    }
    if (!adminAuth) {
        throw new AdmissionError('SERVICE_UNAVAILABLE');
    }
    try {
        return await adminAuth.verifyIdToken(token);
    } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : '';
        if (code.startsWith('auth/')) {
            throw new AdmissionError('UNAUTHENTICATED');
        }
        throw error;
    }
}

export function assertAdmissibleToken(decoded) {
    const uid = typeof decoded?.uid === 'string' ? decoded.uid : '';
    if (!uid) {
        throw new AdmissionError('UNAUTHENTICATED');
    }

    const email = normalizeEmail(decoded?.email);
    if (!email || email.includes('/')) {
        throw new AdmissionError('ACCESS_DENIED');
    }

    const name = getParticipantName(email);
    if (!name) {
        throw new AdmissionError('ACCESS_DENIED');
    }

    if (requiresVerifiedEmail() && decoded?.email_verified !== true) {
        throw new AdmissionError('EMAIL_NOT_VERIFIED');
    }

    return { uid, email, name };
}

// --- References ---

function requireFirestore() {
    if (!firestore) {
        throw new AdmissionError('SERVICE_UNAVAILABLE');
    }
    return firestore;
}

function lifecycleRef(db) {
    return db.collection(LIFECYCLE_COLLECTION).doc(LIFECYCLE_DOC);
}

function identityRef(db, uid) {
    return db.collection(IDENTITIES_COLLECTION).doc(uid);
}

function indexRef(db, email) {
    return db.collection(INDEX_COLLECTION).doc(email);
}

function userRef(db, userId) {
    return db.collection(USERS_COLLECTION).doc(userId);
}

function withId(snapshot) {
    const data = snapshot.data() || {};
    return { ...data, id: data.id ?? snapshot.id };
}

// --- Profile resolution shared by admission and seeding ---

/**
 * Resolve the lifecycle for an admission-style write inside a transaction.
 * Missing lifecycle -> will be created at epoch 1 (only when no resetId is given).
 */
function resolveLifecycleForProfile(lifecycleSnap, resetId) {
    if (resetId) {
        const data = lifecycleSnap.exists ? lifecycleSnap.data() : null;
        if (!data || data.state !== 'resetting' || data.resetId !== resetId) {
            throw new AdmissionError('RESET_SUPERSEDED');
        }
        return { epoch: data.epoch, createLifecycle: false };
    }

    if (!lifecycleSnap.exists) {
        return { epoch: 1, createLifecycle: true };
    }

    const data = lifecycleSnap.data();
    if (data.state !== 'active') {
        throw new AdmissionError('RESET_IN_PROGRESS');
    }
    return { epoch: data.epoch, createLifecycle: false };
}

/**
 * Reads (inside tx) needed to resolve a canonical profile for `email`.
 * Returns { kind: 'existing'|'linked'|'created', user, createIndex, createUser }.
 * Throws PROFILE_CONFLICT with no writes.
 */
async function resolveProfileInTransaction(tx, db, { email, name, epoch, indexSnap, oauthId, image }) {
    if (indexSnap.exists) {
        const index = indexSnap.data();
        if (index.epoch !== epoch || typeof index.userId !== 'string' || !index.userId) {
            throw new AdmissionError('PROFILE_CONFLICT');
        }
        const userSnap = await tx.get(userRef(db, index.userId));
        if (!userSnap.exists) {
            throw new AdmissionError('PROFILE_CONFLICT');
        }
        const user = withId(userSnap);
        if (user.email !== email) {
            throw new AdmissionError('PROFILE_CONFLICT');
        }
        return { kind: 'existing', user, createIndex: false, createUser: false };
    }

    const usersSnap = await tx.get(db.collection(USERS_COLLECTION));
    const matches = usersSnap.docs.filter((doc) => normalizeEmail(doc.data()?.email) === email);

    if (matches.length === 0) {
        const user = {
            id: uuidv4(),
            name: toTitleCase(name),
            email,
            oauthId,
            image,
            recipientId: null,
            gifterId: null,
        };
        return { kind: 'created', user, createIndex: true, createUser: true };
    }

    if (matches.length === 1) {
        const doc = matches[0];
        const data = doc.data() || {};
        if (data.email === email && doc.id === (data.id ?? doc.id)) {
            return { kind: 'linked', user: withId(doc), createIndex: true, createUser: false };
        }
    }

    throw new AdmissionError('PROFILE_CONFLICT');
}

function applyProfileWrites(tx, db, { email, epoch, now, createLifecycle, resolution }) {
    if (createLifecycle) {
        tx.create(lifecycleRef(db), {
            epoch,
            state: 'active',
            resetId: null,
            resetStartedAt: null,
            updatedAt: now,
        });
    }
    if (resolution.createUser) {
        tx.create(userRef(db, resolution.user.id), resolution.user);
    }
    if (resolution.createIndex) {
        tx.create(indexRef(db, email), {
            email,
            userId: resolution.user.id,
            epoch,
            createdAt: now,
        });
    }
}

// --- Admission ---

export async function admitParticipant(decoded) {
    const { uid, email, name } = assertAdmissibleToken(decoded);
    const db = requireFirestore();

    return db.runTransaction(async (tx) => {
        const [lifecycleSnap, indexSnap, identitySnap] = await tx.getAll(
            lifecycleRef(db),
            indexRef(db, email),
            identityRef(db, uid)
        );

        const { epoch, createLifecycle } = resolveLifecycleForProfile(lifecycleSnap, null);
        const resolution = await resolveProfileInTransaction(tx, db, {
            email,
            name,
            epoch,
            indexSnap,
            oauthId: uid,
            image: decoded.picture || null,
        });

        const now = new Date().toISOString();
        applyProfileWrites(tx, db, { email, epoch, now, createLifecycle, resolution });

        const previousIdentity = identitySnap.exists ? identitySnap.data() : null;
        tx.set(identityRef(db, uid), {
            uid,
            email,
            userId: resolution.user.id,
            epoch,
            createdAt: previousIdentity?.createdAt ?? now,
            updatedAt: now,
        });

        return { user: resolution.user, created: resolution.kind === 'created', epoch };
    });
}

/**
 * Validity predicate shared by resolveParticipant and runFencedTransaction.
 * Returns the user (with id) when valid; throws RESET_IN_PROGRESS when the lifecycle
 * is not active; returns null when admission is required.
 */
function evaluateAdmission({ lifecycleSnap, identitySnap, userSnap, uid, email }) {
    if (!lifecycleSnap?.exists) return null;
    const lifecycle = lifecycleSnap.data();
    if (lifecycle.state !== 'active') {
        throw new AdmissionError('RESET_IN_PROGRESS');
    }
    if (!identitySnap?.exists) return null;
    const identity = identitySnap.data();
    if (identity.uid !== uid || identity.email !== email || identity.epoch !== lifecycle.epoch) {
        return null;
    }
    if (!userSnap?.exists) return null;
    const user = withId(userSnap);
    if (normalizeEmail(user.email) !== email) return null;
    return { user, epoch: lifecycle.epoch, identity };
}

export async function resolveParticipant(decoded, { verifyIndex = false } = {}) {
    const { uid, email } = assertAdmissibleToken(decoded);
    const db = requireFirestore();

    const refs = [lifecycleRef(db), identityRef(db, uid)];
    if (verifyIndex) refs.push(indexRef(db, email));
    const [lifecycleSnap, identitySnap, indexSnap] = await db.getAll(...refs);

    let valid = null;
    const identityData = identitySnap?.exists ? identitySnap.data() : null;
    if (lifecycleSnap?.exists && identityData && typeof identityData.userId === 'string' && identityData.userId) {
        const userSnap = await userRef(db, identityData.userId).get();
        valid = evaluateAdmission({ lifecycleSnap, identitySnap, userSnap, uid, email });
    } else if (lifecycleSnap?.exists && lifecycleSnap.data().state !== 'active') {
        throw new AdmissionError('RESET_IN_PROGRESS');
    }

    if (valid && verifyIndex) {
        const index = indexSnap?.exists ? indexSnap.data() : null;
        if (!index || index.userId !== valid.identity.userId || index.epoch !== valid.epoch) {
            valid = null;
        }
    }

    if (valid) {
        return { uid, email, user: valid.user, epoch: valid.epoch };
    }

    const admitted = await admitParticipant(decoded);
    return { uid, email, user: admitted.user, epoch: admitted.epoch };
}

export async function runFencedTransaction(decoded, work) {
    const { uid, email } = assertAdmissibleToken(decoded);
    const db = requireFirestore();

    const attempt = () => db.runTransaction(async (tx) => {
        const [lifecycleSnap, identitySnap] = await tx.getAll(lifecycleRef(db), identityRef(db, uid));
        if (lifecycleSnap.exists && lifecycleSnap.data().state !== 'active') {
            throw new AdmissionError('RESET_IN_PROGRESS');
        }
        const identityData = identitySnap.exists ? identitySnap.data() : null;
        if (!lifecycleSnap.exists || !identityData || typeof identityData.userId !== 'string' || !identityData.userId) {
            throw new AdmissionError(ADMISSION_REQUIRED);
        }
        const userSnap = await tx.get(userRef(db, identityData.userId));
        const valid = evaluateAdmission({ lifecycleSnap, identitySnap, userSnap, uid, email });
        if (!valid) {
            throw new AdmissionError(ADMISSION_REQUIRED);
        }
        return work(tx, { uid, email, epoch: valid.epoch, user: valid.user });
    });

    try {
        return await attempt();
    } catch (error) {
        if (!isAdmissionRequired(error)) throw error;
    }

    await admitParticipant(decoded);

    try {
        return await attempt();
    } catch (error) {
        if (isAdmissionRequired(error)) {
            throw new AdmissionError('SERVICE_UNAVAILABLE');
        }
        throw error;
    }
}

// --- Seeding ---

export async function ensureParticipantProfiles(participants, { resetId = null } = {}) {
    const db = requireFirestore();
    const counts = { created: 0, linked: 0, existing: 0 };
    let conflicts = 0;

    for (const participant of participants || []) {
        const email = normalizeEmail(participant?.email);
        if (!email || email.includes('/')) {
            conflicts += 1;
            continue;
        }

        try {
            const kind = await db.runTransaction(async (tx) => {
                const [lifecycleSnap, indexSnap] = await tx.getAll(lifecycleRef(db), indexRef(db, email));
                const { epoch, createLifecycle } = resolveLifecycleForProfile(lifecycleSnap, resetId);
                const resolution = await resolveProfileInTransaction(tx, db, {
                    email,
                    name: participant.name,
                    epoch,
                    indexSnap,
                    oauthId: null,
                    image: null,
                });
                const now = new Date().toISOString();
                applyProfileWrites(tx, db, { email, epoch, now, createLifecycle, resolution });
                return resolution.kind;
            });
            counts[kind] += 1;
        } catch (error) {
            if (error?.isAdmissionError && error.code === 'PROFILE_CONFLICT') {
                conflicts += 1;
                continue;
            }
            throw error;
        }
    }

    if (conflicts > 0) {
        const error = new AdmissionError('PROFILE_CONFLICT');
        error.conflicts = conflicts;
        throw error;
    }

    return counts;
}

// --- Lifecycle / reset protocol ---

export async function beginReset() {
    const db = requireFirestore();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lifecycleRef(db));
        const previous = snap.exists ? snap.data() : null;
        const epoch = (previous?.epoch ?? 0) + 1;
        const resetId = uuidv4();
        const now = new Date().toISOString();
        tx.set(lifecycleRef(db), {
            epoch,
            state: 'resetting',
            resetId,
            resetStartedAt: now,
            updatedAt: now,
        });
        return { resetId, epoch };
    });
}

export async function assertResetOwner(tx, resetId) {
    const db = requireFirestore();
    const snap = await tx.get(lifecycleRef(db));
    const data = snap.exists ? snap.data() : null;
    if (!data || data.state !== 'resetting' || !resetId || data.resetId !== resetId) {
        throw new AdmissionError('RESET_SUPERSEDED');
    }
}

export async function assertLifecycleActive(tx) {
    const db = requireFirestore();
    const snap = await tx.get(lifecycleRef(db));
    if (!snap.exists) {
        throw new AdmissionError('SERVICE_UNAVAILABLE');
    }
    const data = snap.data();
    if (data.state !== 'active') {
        throw new AdmissionError('RESET_IN_PROGRESS');
    }
    return { epoch: data.epoch };
}

export async function completeReset(resetId) {
    const db = requireFirestore();
    await db.runTransaction(async (tx) => {
        await assertResetOwner(tx, resetId);
        tx.update(lifecycleRef(db), {
            state: 'active',
            resetId: null,
            resetStartedAt: null,
            updatedAt: new Date().toISOString(),
        });
    });
}

// --- HTTP mapping ---

export function admissionErrorResponse(error) {
    if (!error?.isAdmissionError || error.code === ADMISSION_REQUIRED) {
        return null;
    }
    return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
    );
}
