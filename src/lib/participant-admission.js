import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth as adminAuth, firestore } from '@/lib/firebase';
import { isAdmin } from '@/lib/config';
import { getRoster, getRosterName, isKnownParticipantEmail } from '@/lib/participants';
import {
    LEGACY_YEAR,
    YEAR_COLLECTIONS,
    isValidYear,
    interpretLifecycle,
    yearCollectionPath,
} from '@/lib/year-paths';

/**
 * Server-side participant admission, lifecycle fencing and the annual Close / Start
 * transitions.
 *
 * Admin SDK only. Must not import '@/lib/firestore' (which imports this module).
 *
 * Server-written collections (clients cannot write them):
 * - system/lifecycle:          { epoch, state: 'active'|'closed', year, closedYears,
 *                                startedAt, closedAt, updatedAt } (see interpretLifecycle)
 * - authIdentities/{authUid}:  { uid, email, userId, epoch, createdAt, updatedAt }
 * - participantIndex/{email}:  { email, userId, epoch, createdAt }
 *
 * Profiles live in the year's `users` collection (root for 2025, years/{year}/users
 * afterwards). The epoch bumps only on Start; the year number is the idempotency and
 * staleness token of a transition.
 */

const LIFECYCLE_COLLECTION = 'system';
const LIFECYCLE_DOC = 'lifecycle';
const IDENTITIES_COLLECTION = 'authIdentities';
const INDEX_COLLECTION = 'participantIndex';

const MIN_ROSTER_SIZE = 2;
const MAX_ROSTER_SIZE = 200;

const ADMISSION_REQUIRED = 'ADMISSION_REQUIRED';

const ERROR_DEFINITIONS = {
    UNAUTHENTICATED: { status: 401, message: 'Unauthorized: Invalid or missing token' },
    ACCESS_DENIED: { status: 403, message: 'Access denied: this account is not on the participant list' },
    EMAIL_NOT_VERIFIED: { status: 403, message: 'Your email address must be verified before you can sign in' },
    ADMIN_REQUIRED: { status: 403, message: 'Unauthorized: Admin access required' },
    PROFILE_CONFLICT: { status: 409, message: 'Your profile could not be set up automatically. Ask an admin for help.' },
    YEAR_CLOSED: { status: 409, message: "This year's exchange is closed and read-only." },
    CLIENT_UPDATE_REQUIRED: {
        status: 409,
        message: 'A new version of the app is available. Reload the page (or close and reopen the app) to continue.',
    },
    YEAR_NOT_CLOSED: { status: 409, message: 'The current year must be closed before the next one can start.' },
    YEAR_MISMATCH: { status: 409, message: 'The exchange year does not match. Check the current state and try again.' },
    STALE_REQUEST: { status: 409, message: 'A later year has already started.' },
    ROSTER_NOT_CONFIGURED: { status: 409, message: 'No valid roster is configured for that year.' },
    YEAR_NOT_EMPTY: { status: 409, message: 'That year already has data.' },
    INVALID_YEAR: { status: 400, message: 'Invalid year.' },
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

/**
 * Token-only checks (no Firestore read): uid, canonical email without '/', the email
 * is on some roster, and a verified email outside development.
 */
export function assertAdmissibleToken(decoded) {
    const uid = typeof decoded?.uid === 'string' ? decoded.uid : '';
    if (!uid) {
        throw new AdmissionError('UNAUTHENTICATED');
    }

    const email = normalizeEmail(decoded?.email);
    if (!email || email.includes('/')) {
        throw new AdmissionError('ACCESS_DENIED');
    }

    if (!isKnownParticipantEmail(email)) {
        throw new AdmissionError('ACCESS_DENIED');
    }

    if (requiresVerifiedEmail() && decoded?.email_verified !== true) {
        throw new AdmissionError('EMAIL_NOT_VERIFIED');
    }

    return { uid, email };
}

/**
 * Admin route guard: valid token, verified email outside development, admin email.
 */
export async function verifyAdminRequest(request) {
    const decoded = await verifyRequestToken(request);
    if (requiresVerifiedEmail() && decoded?.email_verified !== true) {
        throw new AdmissionError('EMAIL_NOT_VERIFIED');
    }
    if (!isAdmin(normalizeEmail(decoded?.email))) {
        throw new AdmissionError('ADMIN_REQUIRED');
    }
    return decoded;
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

function yearCollection(db, year, name) {
    return db.collection(yearCollectionPath(year, name).join('/'));
}

function yearUsers(db, year) {
    return yearCollection(db, year, 'users');
}

function userRef(db, year, id) {
    return yearUsers(db, year).doc(id);
}

function withId(snapshot) {
    const data = snapshot.data() || {};
    return { ...data, id: data.id ?? snapshot.id };
}

// --- Lifecycle ---

/**
 * Interpretation plus `createLifecycle` (true only for a missing document, which the
 * caller creates at epoch 1). An unavailable lifecycle -> SERVICE_UNAVAILABLE, so no
 * path ever overwrites it.
 */
function resolveLifecycle(snap) {
    const lifecycle = interpretLifecycle(snap?.exists ? snap.data() : null);
    if (!lifecycle.valid) {
        throw new AdmissionError('SERVICE_UNAVAILABLE');
    }
    return {
        ...lifecycle,
        epoch: lifecycle.epoch ?? 1,
        createLifecycle: !lifecycle.exists,
    };
}

function lifecycleSummary(lifecycle) {
    return {
        year: lifecycle.year,
        state: lifecycle.state,
        epoch: lifecycle.epoch,
        closedYears: [...lifecycle.closedYears],
    };
}

/**
 * Inside a transaction: the open year, or 503 (missing/unavailable) / YEAR_CLOSED.
 */
export async function assertYearOpen(tx) {
    const db = requireFirestore();
    const snap = await tx.get(lifecycleRef(db));
    if (!snap.exists) {
        throw new AdmissionError('SERVICE_UNAVAILABLE');
    }
    const lifecycle = interpretLifecycle(snap.data());
    if (!lifecycle.valid) {
        throw new AdmissionError('SERVICE_UNAVAILABLE');
    }
    if (lifecycle.state !== 'active') {
        throw new AdmissionError('YEAR_CLOSED');
    }
    return { epoch: lifecycle.epoch, year: lifecycle.year };
}

// --- Profile resolution shared by admission and seeding ---

/**
 * Reads (inside tx) needed to resolve a canonical profile for `email` in `year`.
 * Returns { kind: 'existing'|'linked'|'created', user, createIndex, createUser }.
 * Throws PROFILE_CONFLICT, or ACCESS_DENIED in a closed year without a profile, with
 * no writes.
 */
async function resolveProfileInTransaction(tx, db, { year, state, email, name, epoch, indexSnap, oauthId, image }) {
    const index = indexSnap?.exists ? indexSnap.data() : null;
    // A row from an earlier epoch is inert and treated as absent.
    const indexIsCurrent = !!index
        && index.epoch === epoch
        && typeof index.userId === 'string'
        && index.userId.length > 0;

    if (indexIsCurrent) {
        const userSnap = await tx.get(userRef(db, year, index.userId));
        if (!userSnap.exists) {
            throw new AdmissionError('PROFILE_CONFLICT');
        }
        const user = withId(userSnap);
        if (user.email !== email) {
            throw new AdmissionError('PROFILE_CONFLICT');
        }
        return { kind: 'existing', user, createIndex: false, createUser: false };
    }

    const usersSnap = await tx.get(yearUsers(db, year));
    const matches = usersSnap.docs.filter((doc) => normalizeEmail(doc.data()?.email) === email);

    if (matches.length === 0) {
        if (state === 'closed') {
            // A closed year never gains a profile.
            throw new AdmissionError('ACCESS_DENIED');
        }
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

function applyProfileWrites(tx, db, { year, email, epoch, now, createLifecycle, resolution }) {
    if (createLifecycle) {
        tx.create(lifecycleRef(db), {
            epoch: 1,
            state: 'active',
            year: LEGACY_YEAR,
            closedYears: [],
            startedAt: null,
            closedAt: null,
            updatedAt: now,
        });
    }
    if (resolution.createUser) {
        tx.create(userRef(db, year, resolution.user.id), resolution.user);
    }
    if (resolution.createIndex) {
        tx.set(indexRef(db, email), {
            email,
            userId: resolution.user.id,
            epoch,
            createdAt: now,
        });
    }
}

function rosterNameFor(lifecycle, email) {
    const name = getRosterName(lifecycle.year, email);
    if (!name) {
        throw new AdmissionError('ACCESS_DENIED');
    }
    return name;
}

// --- Admission ---

export async function admitParticipant(decoded, { requireLegacyYear = false } = {}) {
    const { uid, email } = assertAdmissibleToken(decoded);
    const db = requireFirestore();

    return db.runTransaction(async (tx) => {
        const [lifecycleSnap, indexSnap, identitySnap] = await tx.getAll(
            lifecycleRef(db),
            indexRef(db, email),
            identityRef(db, uid)
        );

        const lifecycle = resolveLifecycle(lifecycleSnap);
        if (requireLegacyYear && lifecycle.year !== LEGACY_YEAR) {
            throw new AdmissionError('CLIENT_UPDATE_REQUIRED');
        }
        const name = rosterNameFor(lifecycle, email);

        const resolution = await resolveProfileInTransaction(tx, db, {
            year: lifecycle.year,
            state: lifecycle.state,
            email,
            name,
            epoch: lifecycle.epoch,
            indexSnap,
            oauthId: uid,
            image: decoded.picture || null,
        });

        const now = new Date().toISOString();
        applyProfileWrites(tx, db, {
            year: lifecycle.year,
            email,
            epoch: lifecycle.epoch,
            now,
            createLifecycle: lifecycle.createLifecycle,
            resolution,
        });

        const previousIdentity = identitySnap.exists ? identitySnap.data() : null;
        tx.set(identityRef(db, uid), {
            uid,
            email,
            userId: resolution.user.id,
            epoch: lifecycle.epoch,
            createdAt: previousIdentity?.createdAt ?? now,
            updatedAt: now,
        });

        return {
            user: resolution.user,
            created: resolution.kind === 'created',
            ...lifecycleSummary(lifecycle),
        };
    });
}

/**
 * Validity predicate shared by resolveParticipant and runFencedTransaction.
 * Returns { user, identity } when the identity is current for this lifecycle, else null.
 */
function evaluateAdmission({ lifecycle, identity, userSnap, uid, email }) {
    if (!identity) return null;
    if (identity.uid !== uid || identity.email !== email || identity.epoch !== lifecycle.epoch) {
        return null;
    }
    if (!userSnap?.exists) return null;
    const user = withId(userSnap);
    if (normalizeEmail(user.email) !== email) return null;
    return { user, identity };
}

function identityUserId(identity) {
    return identity && typeof identity.userId === 'string' && identity.userId ? identity.userId : null;
}

export async function resolveParticipant(decoded, { verifyIndex = false, requireLegacyYear = false } = {}) {
    const { uid, email } = assertAdmissibleToken(decoded);
    const db = requireFirestore();

    const refs = [lifecycleRef(db), identityRef(db, uid)];
    if (verifyIndex) refs.push(indexRef(db, email));
    const [lifecycleSnap, identitySnap, indexSnap] = await db.getAll(...refs);

    const lifecycle = resolveLifecycle(lifecycleSnap);
    if (requireLegacyYear && lifecycle.year !== LEGACY_YEAR) {
        throw new AdmissionError('CLIENT_UPDATE_REQUIRED');
    }
    rosterNameFor(lifecycle, email);

    let valid = null;
    const identity = identitySnap?.exists ? identitySnap.data() : null;
    const userId = identityUserId(identity);
    if (!lifecycle.createLifecycle && userId) {
        const userSnap = await userRef(db, lifecycle.year, userId).get();
        valid = evaluateAdmission({ lifecycle, identity, userSnap, uid, email });
    }

    if (valid && verifyIndex) {
        const index = indexSnap?.exists ? indexSnap.data() : null;
        if (!index || index.userId !== valid.identity.userId || index.epoch !== lifecycle.epoch) {
            valid = null;
        }
    }

    if (valid) {
        return { uid, email, user: valid.user, ...lifecycleSummary(lifecycle) };
    }

    const admitted = await admitParticipant(decoded, { requireLegacyYear });
    return {
        uid,
        email,
        user: admitted.user,
        year: admitted.year,
        state: admitted.state,
        epoch: admitted.epoch,
        closedYears: admitted.closedYears,
    };
}

/**
 * Run `work(tx, { uid, email, epoch, year, state, user })` inside a transaction fenced on
 * the lifecycle and the caller's admission. Order: unavailable -> 503; roster check;
 * closed and !allowClosed -> YEAR_CLOSED (before any admission write); identity/profile
 * validity -> admit once and retry.
 */
export async function runFencedTransaction(decoded, work, { allowClosed = false } = {}) {
    const { uid, email } = assertAdmissibleToken(decoded);
    const db = requireFirestore();

    const attempt = () => db.runTransaction(async (tx) => {
        const [lifecycleSnap, identitySnap] = await tx.getAll(lifecycleRef(db), identityRef(db, uid));
        const lifecycle = resolveLifecycle(lifecycleSnap);
        rosterNameFor(lifecycle, email);
        if (lifecycle.state === 'closed' && !allowClosed) {
            throw new AdmissionError('YEAR_CLOSED');
        }

        const identity = identitySnap.exists ? identitySnap.data() : null;
        const userId = identityUserId(identity);
        if (lifecycle.createLifecycle || !userId) {
            throw new AdmissionError(ADMISSION_REQUIRED);
        }
        const userSnap = await tx.get(userRef(db, lifecycle.year, userId));
        const valid = evaluateAdmission({ lifecycle, identity, userSnap, uid, email });
        if (!valid) {
            throw new AdmissionError(ADMISSION_REQUIRED);
        }
        return work(tx, {
            uid,
            email,
            epoch: lifecycle.epoch,
            year: lifecycle.year,
            state: lifecycle.state,
            user: valid.user,
        });
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

/**
 * Seed the active year's roster. One lifecycle read fixes the year and roster; each
 * roster entry is then resolved in its own transaction that re-reads the lifecycle.
 *
 * @returns {Promise<{ year: number, created: number, linked: number, existing: number }>}
 */
export async function ensureParticipantProfiles() {
    const db = requireFirestore();
    const initial = resolveLifecycle(await lifecycleRef(db).get());
    if (initial.state === 'closed') {
        throw new AdmissionError('YEAR_CLOSED');
    }
    const year = initial.year;
    const roster = getRoster(year);
    if (!roster) {
        throw new AdmissionError('ROSTER_NOT_CONFIGURED');
    }

    const counts = { created: 0, linked: 0, existing: 0 };
    let conflicts = 0;

    for (const participant of roster) {
        const email = normalizeEmail(participant?.email);
        if (!email || email.includes('/')) {
            conflicts += 1;
            continue;
        }

        try {
            const kind = await db.runTransaction(async (tx) => {
                const [lifecycleSnap, indexSnap] = await tx.getAll(lifecycleRef(db), indexRef(db, email));
                const lifecycle = resolveLifecycle(lifecycleSnap);
                if (lifecycle.year !== year) {
                    throw new AdmissionError('YEAR_MISMATCH');
                }
                if (lifecycle.state !== 'active') {
                    throw new AdmissionError('YEAR_CLOSED');
                }
                const resolution = await resolveProfileInTransaction(tx, db, {
                    year,
                    state: lifecycle.state,
                    email,
                    name: participant.name,
                    epoch: lifecycle.epoch,
                    indexSnap,
                    oauthId: null,
                    image: null,
                });
                const now = new Date().toISOString();
                applyProfileWrites(tx, db, {
                    year,
                    email,
                    epoch: lifecycle.epoch,
                    now,
                    createLifecycle: lifecycle.createLifecycle,
                    resolution,
                });
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

    return { year, ...counts };
}

// --- Year transitions ---

/**
 * Close year Y in one transaction on system/lifecycle. Idempotent.
 *
 * @returns {Promise<{ year, state, epoch, closedYears, changed }>} the lifecycle after the call
 */
export async function closeYear({ year } = {}) {
    if (!isValidYear(year)) {
        throw new AdmissionError('INVALID_YEAR');
    }
    const db = requireFirestore();

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lifecycleRef(db));
        const current = interpretLifecycle(snap.exists ? snap.data() : null);
        if (!current.valid) {
            throw new AdmissionError('SERVICE_UNAVAILABLE');
        }

        if (year > current.year) {
            throw new AdmissionError('YEAR_MISMATCH');
        }
        if (year < current.year) {
            if (current.closedYears.includes(year)) {
                return { ...lifecycleSummary(current), changed: false };
            }
            throw new AdmissionError('YEAR_MISMATCH');
        }
        if (current.state === 'closed') {
            return { ...lifecycleSummary(current), changed: false };
        }

        const now = new Date().toISOString();
        const closedYears = [...new Set([...current.closedYears, year])].sort((a, b) => a - b);
        const next = {
            epoch: current.epoch ?? 1,
            state: 'closed',
            year,
            closedYears,
            startedAt: current.startedAt,
            closedAt: now,
            updatedAt: now,
        };
        tx.set(lifecycleRef(db), next);

        return {
            year,
            state: 'closed',
            epoch: next.epoch,
            closedYears: [...closedYears],
            changed: true,
        };
    });
}

function isValidRoster(roster) {
    if (!Array.isArray(roster)) return false;
    if (roster.length < MIN_ROSTER_SIZE || roster.length > MAX_ROSTER_SIZE) return false;

    const emails = new Set();
    const names = new Set();
    for (const participant of roster) {
        const email = participant?.email;
        const name = participant?.name;
        if (typeof email !== 'string' || !email || email !== normalizeEmail(email) || email.includes('/')) {
            return false;
        }
        if (typeof name !== 'string' || !name.trim()) {
            return false;
        }
        const nameKey = name.trim().toLowerCase();
        if (emails.has(email) || names.has(nameKey)) {
            return false;
        }
        emails.add(email);
        names.add(nameKey);
    }
    return true;
}

/**
 * Start targetYear after fromYear in one transaction: create one profile per roster
 * entry in the empty target namespace, point each participantIndex row at it at the new
 * epoch, and activate the target year. Idempotent.
 *
 * @returns {Promise<{ year, state, epoch, closedYears, changed, participants }>}
 */
export async function startNewYear({ fromYear, targetYear } = {}) {
    if (!isValidYear(fromYear) || !isValidYear(targetYear) || targetYear <= fromYear) {
        throw new AdmissionError('INVALID_YEAR');
    }

    const roster = getRoster(targetYear);
    if (!isValidRoster(roster)) {
        throw new AdmissionError('ROSTER_NOT_CONFIGURED');
    }

    // Built before the transaction so a retried callback reuses the same ids.
    const profiles = roster.map((participant) => ({
        id: uuidv4(),
        name: toTitleCase(participant.name),
        email: participant.email,
        oauthId: null,
        image: null,
        recipientId: null,
        gifterId: null,
    }));

    const db = requireFirestore();

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lifecycleRef(db));
        const current = interpretLifecycle(snap.exists ? snap.data() : null);
        if (!current.valid) {
            throw new AdmissionError('SERVICE_UNAVAILABLE');
        }

        if (current.year === targetYear) {
            return { ...lifecycleSummary(current), changed: false, participants: null };
        }
        if (current.year > targetYear) {
            throw new AdmissionError('STALE_REQUEST');
        }
        if (current.year !== fromYear) {
            throw new AdmissionError('YEAR_MISMATCH');
        }
        if (current.state !== 'closed') {
            throw new AdmissionError('YEAR_NOT_CLOSED');
        }

        for (const name of YEAR_COLLECTIONS) {
            const existing = await tx.get(yearCollection(db, targetYear, name).limit(1));
            if (!existing.empty) {
                throw new AdmissionError('YEAR_NOT_EMPTY');
            }
        }

        const epoch = current.epoch + 1;
        const now = new Date().toISOString();

        profiles.forEach((profile) => {
            tx.create(userRef(db, targetYear, profile.id), profile);
            tx.set(indexRef(db, profile.email), {
                email: profile.email,
                userId: profile.id,
                epoch,
                createdAt: now,
            });
        });

        tx.set(lifecycleRef(db), {
            epoch,
            state: 'active',
            year: targetYear,
            closedYears: [...current.closedYears],
            startedAt: now,
            closedAt: null,
            updatedAt: now,
        });

        return {
            year: targetYear,
            state: 'active',
            epoch,
            closedYears: [...current.closedYears],
            changed: true,
            participants: profiles.length,
        };
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
