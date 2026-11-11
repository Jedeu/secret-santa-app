/**
 * Year storage layout and lifecycle interpretation.
 *
 * Pure module (no Firebase SDK import), shared by the client and the server.
 *
 * - 2025 (legacy) lives in the root collections `users`, `messages`, `lastRead`,
 *   `typing`, `reactions`.
 * - Every later year Y lives in `years/{Y}/…` with the same five collection names and
 *   document shapes (there is no `years/{Y}` parent document).
 * - `system/lifecycle` is interpreted by `interpretLifecycle`; anything outside the
 *   documented shape is `unavailable` and the server writes nothing.
 */

export const LEGACY_YEAR = 2025;
const MAX_YEAR = 9999;

export const YEAR_COLLECTIONS = ['users', 'messages', 'lastRead', 'typing', 'reactions'];
export const GLOBAL_COLLECTIONS = ['authIdentities', 'participantIndex', 'pushTokens'];

const LIFECYCLE_STATES = ['active', 'closed'];

export function isValidYear(year) {
    return Number.isInteger(year) && year >= LEGACY_YEAR && year <= MAX_YEAR;
}

/**
 * Path segments of a year-scoped collection.
 * 2025 -> [name]; any later year -> ['years', String(year), name].
 * Throws on an invalid year or an unknown collection name.
 */
export function yearCollectionPath(year, name) {
    if (!isValidYear(year)) {
        throw new Error(`Invalid year: ${year}`);
    }
    if (!YEAR_COLLECTIONS.includes(name)) {
        throw new Error(`Unknown year collection: ${name}`);
    }
    return year === LEGACY_YEAR ? [name] : ['years', String(year), name];
}

/**
 * Path segments of a document in a year-scoped collection.
 */
export function yearDocPath(year, name, id) {
    return [...yearCollectionPath(year, name), id];
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function unavailable() {
    return {
        exists: true,
        valid: false,
        state: 'unavailable',
        year: null,
        epoch: null,
        closedYears: [],
        startedAt: null,
        closedAt: null,
    };
}

function isStrictlyAscendingYears(list) {
    if (!Array.isArray(list)) return false;
    for (let i = 0; i < list.length; i += 1) {
        if (!isValidYear(list[i])) return false;
        if (i > 0 && list[i] <= list[i - 1]) return false;
    }
    return true;
}

/**
 * Interpret the `system/lifecycle` document data (null/undefined when it does not exist).
 * Each field is validated independently; a missing `year` never changes how `state` is read.
 *
 * @param {object|null|undefined} data
 * @returns {{ exists: boolean, valid: boolean, state: 'active'|'closed'|'unavailable',
 *   year: number|null, epoch: number|null, closedYears: number[],
 *   startedAt: string|null, closedAt: string|null }}
 */
export function interpretLifecycle(data) {
    // 1. Missing document: legacy 2025, active, not yet created (first admission or
    //    Close creates it at epoch 1).
    if (data === null || data === undefined) {
        return {
            exists: false,
            valid: true,
            state: 'active',
            year: LEGACY_YEAR,
            epoch: null,
            closedYears: [],
            startedAt: null,
            closedAt: null,
        };
    }

    if (typeof data !== 'object' || Array.isArray(data)) {
        return unavailable();
    }

    // 2. State must be exactly 'active' or 'closed' (a legacy 'resetting' is unavailable).
    if (!LIFECYCLE_STATES.includes(data.state)) {
        return unavailable();
    }

    // 3. Epoch must be an integer >= 1.
    if (!Number.isInteger(data.epoch) || data.epoch < 1) {
        return unavailable();
    }

    // 4./5. Absent year = 2025; a present year must be a valid integer year.
    let year = LEGACY_YEAR;
    if (hasOwn(data, 'year')) {
        if (!isValidYear(data.year)) {
            return unavailable();
        }
        year = data.year;
    }

    // 6./7. Absent closedYears = []; a present list must be strictly ascending valid years.
    let closedYears = [];
    if (hasOwn(data, 'closedYears')) {
        if (!isStrictlyAscendingYears(data.closedYears)) {
            return unavailable();
        }
        closedYears = [...data.closedYears];
    }

    // 8. State/membership consistency; nothing listed above the current year.
    const listed = closedYears.includes(year);
    if (data.state === 'closed' && !listed) return unavailable();
    if (data.state === 'active' && listed) return unavailable();
    if (closedYears.some((closedYear) => closedYear > year)) return unavailable();

    // 9. A year after 2025 needs an earlier closed year.
    if (year > LEGACY_YEAR && !closedYears.some((closedYear) => closedYear < year)) {
        return unavailable();
    }

    // 10. Valid.
    return {
        exists: true,
        valid: true,
        state: data.state,
        year,
        epoch: data.epoch,
        closedYears,
        startedAt: data.startedAt ?? null,
        closedAt: data.closedAt ?? null,
    };
}

/**
 * Comparable identity of a lifecycle value: 'invalid' for an unavailable document,
 * otherwise `${year}:${state}:${epoch}`.
 */
export function lifecycleKey(value) {
    if (!value || value.valid === false) {
        return 'invalid';
    }
    return `${value.year}:${value.state}:${value.epoch}`;
}
