import {
    GLOBAL_COLLECTIONS,
    LEGACY_YEAR,
    YEAR_COLLECTIONS,
    interpretLifecycle,
    isValidYear,
    lifecycleKey,
    yearCollectionPath,
    yearDocPath,
} from '@/lib/year-paths';

describe('year-paths', () => {
    describe('constants and year validity', () => {
        test('legacy year and collection lists', () => {
            expect(LEGACY_YEAR).toBe(2025);
            expect(YEAR_COLLECTIONS).toEqual(['users', 'messages', 'lastRead', 'typing', 'reactions']);
            expect(GLOBAL_COLLECTIONS).toEqual(['authIdentities', 'participantIndex', 'pushTokens']);
        });

        test.each([
            [2025, true],
            [2026, true],
            [9999, true],
            [2024, false],
            [10000, false],
            [2025.5, false],
            ['2025', false],
            [null, false],
            [undefined, false],
            [NaN, false],
        ])('isValidYear(%p) -> %p', (year, expected) => {
            expect(isValidYear(year)).toBe(expected);
        });
    });

    describe('path table', () => {
        test.each(YEAR_COLLECTIONS)('2025 %s lives at the root', (name) => {
            expect(yearCollectionPath(2025, name)).toEqual([name]);
            expect(yearDocPath(2025, name, 'doc-1')).toEqual([name, 'doc-1']);
        });

        test.each(YEAR_COLLECTIONS)('2026 %s lives under years/2026', (name) => {
            expect(yearCollectionPath(2026, name)).toEqual(['years', '2026', name]);
            expect(yearDocPath(2026, name, 'doc-1')).toEqual(['years', '2026', name, 'doc-1']);
        });

        test('a later year uses its own namespace', () => {
            expect(yearCollectionPath(2031, 'messages')).toEqual(['years', '2031', 'messages']);
        });

        test.each([2024, '2026', 2026.1, null])('throws on invalid year %p', (year) => {
            expect(() => yearCollectionPath(year, 'users')).toThrow();
            expect(() => yearDocPath(year, 'users', 'x')).toThrow();
        });

        test.each(['pushTokens', 'authIdentities', 'system', '', 'users/x'])('throws on non-year collection %p', (name) => {
            expect(() => yearCollectionPath(2026, name)).toThrow();
        });
    });

    describe('interpretLifecycle', () => {
        const unavailable = {
            exists: true,
            valid: false,
            state: 'unavailable',
        };

        test('row 1: a missing document is valid legacy 2025, active, without an epoch', () => {
            expect(interpretLifecycle(null)).toEqual({
                exists: false,
                valid: true,
                state: 'active',
                year: 2025,
                epoch: null,
                closedYears: [],
                startedAt: null,
                closedAt: null,
            });
            expect(interpretLifecycle(undefined)).toMatchObject({ exists: false, valid: true });
        });

        test.each([
            ['missing', { epoch: 1 }],
            ['resetting', { epoch: 1, state: 'resetting' }],
            ['other', { epoch: 1, state: 'open' }],
            ['wrong case', { epoch: 1, state: 'Active' }],
        ])('row 2: state %s -> unavailable', (_label, data) => {
            expect(interpretLifecycle(data)).toMatchObject(unavailable);
        });

        test.each([
            ['missing', { state: 'active' }],
            ['a string', { state: 'active', epoch: '1' }],
            ['fractional', { state: 'active', epoch: 1.5 }],
            ['zero', { state: 'active', epoch: 0 }],
            ['negative', { state: 'active', epoch: -2 }],
        ])('row 3: epoch %s -> unavailable', (_label, data) => {
            expect(interpretLifecycle(data)).toMatchObject(unavailable);
        });

        test('row 4: an absent year means 2025 (state is read independently)', () => {
            expect(interpretLifecycle({ epoch: 3, state: 'active' })).toMatchObject({
                valid: true, year: 2025, state: 'active', epoch: 3, closedYears: [],
            });
            expect(interpretLifecycle({ epoch: 3, state: 'closed', closedYears: [2025] })).toMatchObject({
                valid: true, year: 2025, state: 'closed',
            });
        });

        test.each([
            ['null', null],
            ['a string', '2026'],
            ['below 2025', 2024],
            ['above 9999', 10000],
            ['fractional', 2026.5],
        ])('row 5: a present year that is %s -> unavailable', (_label, year) => {
            expect(interpretLifecycle({ epoch: 1, state: 'active', year, closedYears: [2025] })).toMatchObject(unavailable);
        });

        test('row 6: absent closedYears means []', () => {
            expect(interpretLifecycle({ epoch: 1, state: 'active', year: 2025 })).toMatchObject({ valid: true, closedYears: [] });
        });

        test.each([
            ['not a list', 2025],
            ['null', null],
            ['a string element', ['2025']],
            ['out of range', [2024]],
            ['non-integer', [2025.5]],
            ['duplicates', [2025, 2025]],
            ['descending', [2026, 2025]],
        ])('row 7: closedYears %s -> unavailable', (_label, closedYears) => {
            expect(interpretLifecycle({ epoch: 2, state: 'active', year: 2027, closedYears })).toMatchObject(unavailable);
        });

        test.each([
            ['closed without its year listed', { epoch: 1, state: 'closed', year: 2025, closedYears: [] }],
            ['active with its year listed', { epoch: 1, state: 'active', year: 2025, closedYears: [2025] }],
            ['a listed year above year', { epoch: 1, state: 'active', year: 2025, closedYears: [2026] }],
        ])('row 8: %s -> unavailable', (_label, data) => {
            expect(interpretLifecycle(data)).toMatchObject(unavailable);
        });

        test('row 9: a year after 2025 with no earlier listed year -> unavailable', () => {
            expect(interpretLifecycle({ epoch: 2, state: 'active', year: 2026, closedYears: [] })).toMatchObject(unavailable);
            expect(interpretLifecycle({ epoch: 2, state: 'active', year: 2026 })).toMatchObject(unavailable);
            expect(interpretLifecycle({ epoch: 2, state: 'closed', year: 2026, closedYears: [2026] })).toMatchObject(unavailable);
        });

        test('row 10: valid documents are returned as stored; absent timestamps are null', () => {
            expect(interpretLifecycle({
                epoch: 2,
                state: 'active',
                year: 2026,
                closedYears: [2025],
                startedAt: '2026-11-01T00:00:00.000Z',
                updatedAt: '2026-11-01T00:00:00.000Z',
            })).toEqual({
                exists: true,
                valid: true,
                state: 'active',
                year: 2026,
                epoch: 2,
                closedYears: [2025],
                startedAt: '2026-11-01T00:00:00.000Z',
                closedAt: null,
            });

            expect(interpretLifecycle({ epoch: 3, state: 'closed', year: 2027, closedYears: [2025, 2026, 2027] }))
                .toMatchObject({ valid: true, state: 'closed', year: 2027, closedYears: [2025, 2026, 2027], startedAt: null });

            // A skipped year is still valid metadata (2026 listed, 2027 never ran).
            expect(interpretLifecycle({ epoch: 3, state: 'active', year: 2028, closedYears: [2025, 2026] }))
                .toMatchObject({ valid: true, year: 2028 });
        });

        test('the returned closedYears is a copy', () => {
            const data = { epoch: 2, state: 'active', year: 2026, closedYears: [2025] };
            const result = interpretLifecycle(data);
            result.closedYears.push(2030);
            expect(data.closedYears).toEqual([2025]);
        });
    });

    describe('lifecycleKey', () => {
        test('valid values are keyed by year, state and epoch', () => {
            expect(lifecycleKey(interpretLifecycle({ epoch: 1, state: 'active' }))).toBe('2025:active:1');
            expect(lifecycleKey(interpretLifecycle({ epoch: 2, state: 'active', year: 2026, closedYears: [2025] })))
                .toBe('2026:active:2');
            expect(lifecycleKey({ year: 2025, state: 'closed', epoch: 1, closedYears: [2025] })).toBe('2025:closed:1');
        });

        test('an unavailable value is "invalid"', () => {
            expect(lifecycleKey(interpretLifecycle({ epoch: 1, state: 'resetting' }))).toBe('invalid');
        });

        test('a missing document interprets without an epoch', () => {
            expect(lifecycleKey(interpretLifecycle(null))).toBe('2025:active:null');
        });
    });
});
