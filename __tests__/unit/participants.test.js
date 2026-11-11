/**
 * Tests for participants.js - participant registry, per-year rosters and helpers.
 * Lookups use the source entries; no email literal appears here.
 */

import {
    PARTICIPANTS,
    YEAR_ROSTERS,
    getRoster,
    getRosterName,
    getRosterEmail,
    getRosterNames,
    isKnownParticipantEmail,
    getNextRosterYear,
} from '@/lib/participants';

describe('Participants Configuration', () => {
    describe('PARTICIPANTS registry', () => {
        test('should have exactly 8 participants', () => {
            expect(PARTICIPANTS).toHaveLength(8);
        });

        test('should include all expected participants', () => {
            const names = PARTICIPANTS.map(p => p.name);
            expect(names).toEqual([
                'Jed', 'Natalie', 'Chinh', 'Gaby',
                'Jana', 'Peter', 'Louis', 'Genevieve'
            ]);
        });

        test('should have valid email for each participant', () => {
            PARTICIPANTS.forEach(participant => {
                expect(participant.email).toBeTruthy();
                expect(participant.email).toContain('@');
            });
        });

        test('every email is canonical: trimmed, lowercase and free of "/" (usable as a participantIndex doc id)', () => {
            PARTICIPANTS.forEach(participant => {
                expect(participant.email).toBe(participant.email.trim().toLowerCase());
                expect(participant.email).not.toContain('/');
            });
        });

        test('should have unique emails', () => {
            const emails = PARTICIPANTS.map(p => p.email);
            const uniqueEmails = new Set(emails);
            expect(uniqueEmails.size).toBe(PARTICIPANTS.length);
        });

        test('should have unique names', () => {
            const names = PARTICIPANTS.map(p => p.name);
            const uniqueNames = new Set(names);
            expect(uniqueNames.size).toBe(PARTICIPANTS.length);
        });
    });

    describe('YEAR_ROSTERS', () => {
        test('the 2025 roster equals the registry', () => {
            expect(getRoster(2025)).toEqual(PARTICIPANTS);
            expect(YEAR_ROSTERS[2025]).toBe(PARTICIPANTS);
        });

        test('the 2026 roster is the registry without the entry named Jana', () => {
            const expected = PARTICIPANTS.filter((participant) => participant.name !== 'Jana');
            expect(getRoster(2026)).toEqual(expected);
            expect(getRoster(2026)).toHaveLength(PARTICIPANTS.length - 1);
            expect(getRosterNames(2026)).not.toContain('Jana');
        });

        test('every configured roster is valid for Start: 2..200 canonical, unique entries', () => {
            Object.keys(YEAR_ROSTERS).map(Number).forEach((year) => {
                const roster = getRoster(year);
                expect(roster.length).toBeGreaterThanOrEqual(2);
                expect(roster.length).toBeLessThanOrEqual(200);
                expect(new Set(roster.map((p) => p.email)).size).toBe(roster.length);
                expect(new Set(roster.map((p) => p.name.toLowerCase())).size).toBe(roster.length);
                roster.forEach((p) => expect(p.email).toBe(p.email.trim().toLowerCase()));
            });
        });
    });

    describe('roster lookups', () => {
        test('round-trips name and email for every roster entry (case-insensitive)', () => {
            [2025, 2026].forEach((year) => {
                getRoster(year).forEach((participant) => {
                    expect(getRosterName(year, participant.email)).toBe(participant.name);
                    expect(getRosterName(year, participant.email.toUpperCase())).toBe(participant.name);
                    expect(getRosterEmail(year, participant.name)).toBe(participant.email);
                    expect(getRosterEmail(year, participant.name.toLowerCase())).toBe(participant.email);
                });
            });
        });

        test('getRosterNames lists the roster names in order', () => {
            expect(getRosterNames(2025)).toEqual(PARTICIPANTS.map((p) => p.name));
        });

        test('a participant excluded from a year is absent from that year only', () => {
            const excluded = PARTICIPANTS.find((participant) => participant.name === 'Jana');
            expect(getRosterName(2026, excluded.email)).toBeNull();
            expect(getRosterEmail(2026, excluded.name)).toBeNull();
            expect(getRosterName(2025, excluded.email)).toBe(excluded.name);
        });

        test('an unconfigured year gives null and []', () => {
            expect(getRoster(2024)).toBeNull();
            expect(getRoster(2099)).toBeNull();
            expect(getRoster('2025')).toBeNull();
            expect(getRosterNames(2099)).toEqual([]);
            expect(getRosterName(2099, PARTICIPANTS[0].email)).toBeNull();
            expect(getRosterEmail(2099, PARTICIPANTS[0].name)).toBeNull();
        });

        test('unknown or empty lookups give null', () => {
            expect(getRosterName(2025, 'unknown@example.test')).toBeNull();
            expect(getRosterName(2025, '')).toBeNull();
            expect(getRosterName(2025, undefined)).toBeNull();
            expect(getRosterEmail(2025, 'Unknown')).toBeNull();
            expect(getRosterEmail(2025, '')).toBeNull();
        });
    });

    describe('isKnownParticipantEmail', () => {
        test('true for any email on any roster, case-insensitive', () => {
            PARTICIPANTS.forEach((participant) => {
                expect(isKnownParticipantEmail(participant.email)).toBe(true);
                expect(isKnownParticipantEmail(participant.email.toUpperCase())).toBe(true);
            });
        });

        test('false for unknown, empty or non-string values', () => {
            expect(isKnownParticipantEmail('unknown@example.test')).toBe(false);
            expect(isKnownParticipantEmail('')).toBe(false);
            expect(isKnownParticipantEmail(null)).toBe(false);
        });
    });

    describe('getNextRosterYear', () => {
        test('smallest configured year after the given year, or null', () => {
            expect(getNextRosterYear(2024)).toBe(2025);
            expect(getNextRosterYear(2025)).toBe(2026);
            expect(getNextRosterYear(2026)).toBeNull();
        });
    });
});
