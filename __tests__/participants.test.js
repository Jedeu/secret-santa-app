/**
 * Tests for participants.js - hardcoded participant list and helper functions
 */

import {
    PARTICIPANTS,
    getParticipantEmail,
    getParticipantName,
    getParticipantNames
} from '@/lib/participants';

describe('Participants Configuration', () => {
    describe('PARTICIPANTS constant', () => {
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

    describe('getParticipantEmail', () => {
        test('should return email for valid participant name', () => {
            expect(getParticipantEmail('Jed')).toBe('jed.piezas@gmail.com');
            expect(getParticipantEmail('Natalie')).toBe('ncammarasana@gmail.com');
        });

        test('should be case-insensitive', () => {
            expect(getParticipantEmail('jed')).toBe('jed.piezas@gmail.com');
            expect(getParticipantEmail('JED')).toBe('jed.piezas@gmail.com');
            expect(getParticipantEmail('natalie')).toBe('ncammarasana@gmail.com');
        });

        test('should return null for non-existent participant', () => {
            expect(getParticipantEmail('Unknown')).toBeNull();
            expect(getParticipantEmail('')).toBeNull();
        });
    });

    describe('getParticipantName', () => {
        test('should return name for valid email', () => {
            expect(getParticipantName('jed.piezas@gmail.com')).toBe('Jed');
            expect(getParticipantName('ncammarasana@gmail.com')).toBe('Natalie');
        });

        test('should be case-insensitive', () => {
            expect(getParticipantName('JED.PIEZAS@GMAIL.COM')).toBe('Jed');
            expect(getParticipantName('NCAMMARASANA@GMAIL.COM')).toBe('Natalie');
        });

        test('should return null for non-existent email', () => {
            expect(getParticipantName('unknown@example.com')).toBeNull();
            expect(getParticipantName('')).toBeNull();
        });
    });

    describe('getParticipantNames', () => {
        test('should return array of all participant names', () => {
            const names = getParticipantNames();
            expect(names).toHaveLength(8);
            expect(names).toEqual([
                'Jed', 'Natalie', 'Chinh', 'Gaby',
                'Jana', 'Peter', 'Louis', 'Genevieve'
            ]);
        });
    });
});
