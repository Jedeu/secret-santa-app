/**
 * Participant registry and per-year rosters.
 *
 * - PARTICIPANTS: registry of every known participant ({ name, email }).
 * - YEAR_ROSTERS: who takes part in each year. A year with no roster cannot be
 *   started and admits nobody. A later year is added by a reviewed edit plus deploy.
 */

export const PARTICIPANTS = [
    { name: 'Jed', email: 'jed.piezas@gmail.com' },
    { name: 'Natalie', email: 'ncammarasana@gmail.com' },
    { name: 'Chinh', email: 'chinhhuynhlmft@gmail.com' },
    { name: 'Gaby', email: 'gabrielle@glim.ca' },
    { name: 'Jana', email: 'jana.j.maclaren@gmail.com' },
    { name: 'Peter', email: 'peter.planta@gmail.com' },
    { name: 'Louis', email: 'ldeschner@gmail.com' },
    { name: 'Genevieve', email: 'genevieve.ayukawa@gmail.com' }
];

export const YEAR_ROSTERS = {
    2025: PARTICIPANTS,
    2026: PARTICIPANTS.filter((participant) => participant.name !== 'Jana'),
};

function configuredYears() {
    return Object.keys(YEAR_ROSTERS)
        .map(Number)
        .filter((year) => Number.isInteger(year))
        .sort((a, b) => a - b);
}

/**
 * Roster for a year, or null when not configured.
 */
export function getRoster(year) {
    if (!Number.isInteger(year)) return null;
    const roster = Object.prototype.hasOwnProperty.call(YEAR_ROSTERS, year) ? YEAR_ROSTERS[year] : null;
    return Array.isArray(roster) ? roster : null;
}

/**
 * Name for an email on a year's roster (case-insensitive), or null.
 */
export function getRosterName(year, email) {
    if (typeof email !== 'string' || !email) return null;
    const needle = email.toLowerCase();
    const participant = (getRoster(year) || []).find(
        (p) => typeof p?.email === 'string' && p.email.toLowerCase() === needle
    );
    return participant?.name || null;
}

/**
 * Email for a name on a year's roster (case-insensitive), or null.
 */
export function getRosterEmail(year, name) {
    if (typeof name !== 'string' || !name) return null;
    const needle = name.toLowerCase();
    const participant = (getRoster(year) || []).find(
        (p) => typeof p?.name === 'string' && p.name.toLowerCase() === needle
    );
    return participant?.email || null;
}

/**
 * Names on a year's roster; [] when not configured.
 */
export function getRosterNames(year) {
    return (getRoster(year) || []).map((p) => p.name);
}

/**
 * True when the email is on any configured roster (case-insensitive).
 */
export function isKnownParticipantEmail(email) {
    if (typeof email !== 'string' || !email) return false;
    return configuredYears().some((year) => getRosterName(year, email) !== null);
}

/**
 * Smallest configured roster year greater than `year`, or null.
 */
export function getNextRosterYear(year) {
    if (typeof year !== 'number' || Number.isNaN(year)) return null;
    return configuredYears().find((configured) => configured > year) ?? null;
}
