/** @jest-environment node */
import { drawRecipientCycle, isCompletePairing } from '@/lib/recipient-draw';

/**
 * Server-only automatic draw: one uniformly shuffled ring. Synthetic ids only.
 */

function ids(n) {
    return Array.from({ length: n }, (_, i) => `id-${i}`);
}

function toProfiles(draw) {
    return [...draw.entries()].map(([id, pair]) => ({ id, ...pair }));
}

/** Ids visited by following recipientId from `start` until it returns (or loops too long). */
function followRing(draw, start) {
    const visited = [start];
    let current = draw.get(start).recipientId;
    while (current !== start && visited.length <= draw.size) {
        visited.push(current);
        current = draw.get(current).recipientId;
    }
    return visited;
}

/** Canonical ring text starting from the first id, e.g. 'a>b>c>d'. */
function ringKey(draw, start) {
    return followRing(draw, start).join('>');
}

/** pickIndex returning the given values in order, recording each argument. */
function scripted(values) {
    const calls = [];
    let position = 0;
    const pickIndex = (maxExclusive) => {
        calls.push(maxExclusive);
        const value = values[position];
        position += 1;
        return value;
    };
    return { pickIndex, calls };
}

describe('drawRecipientCycle', () => {
    test.each([2, 3, 5, 200])('n = %i with the default random source: one complete ring, nobody draws themselves', (n) => {
        const list = ids(n);

        const draw = drawRecipientCycle(list);

        expect(draw.size).toBe(n);
        const profiles = toProfiles(draw);
        expect(isCompletePairing(profiles)).toBe(true);
        profiles.forEach((profile) => {
            expect(profile.recipientId).not.toBe(profile.id);
            expect(profile.gifterId).not.toBe(profile.id);
        });
        list.forEach((id) => {
            const visited = followRing(draw, id);
            expect(visited).toHaveLength(n);
            expect(new Set(visited)).toEqual(new Set(list));
        });
    });

    test('n = 2 is always the mutual pair', () => {
        const draw = drawRecipientCycle(['a', 'b']);

        expect(draw.get('a')).toEqual({ recipientId: 'b', gifterId: 'b' });
        expect(draw.get('b')).toEqual({ recipientId: 'a', gifterId: 'a' });
    });

    test('an injected pickIndex yields the expected ring and is called with i + 1 for i = n-1 … 1', () => {
        const { pickIndex, calls } = scripted([0, 0, 0]);

        // order: [a,b,c,d] -> swap(3,0) [d,b,c,a] -> swap(2,0) [c,b,d,a] -> swap(1,0) [b,c,d,a]
        const draw = drawRecipientCycle(['a', 'b', 'c', 'd'], pickIndex);

        expect(calls).toEqual([4, 3, 2]);
        expect(draw.get('b')).toEqual({ recipientId: 'c', gifterId: 'a' });
        expect(draw.get('c')).toEqual({ recipientId: 'd', gifterId: 'b' });
        expect(draw.get('d')).toEqual({ recipientId: 'a', gifterId: 'c' });
        expect(draw.get('a')).toEqual({ recipientId: 'b', gifterId: 'd' });
    });

    test('choosing j = i at every step keeps the input order as the ring', () => {
        const { pickIndex, calls } = scripted([2, 1]);

        const draw = drawRecipientCycle(['a', 'b', 'c'], pickIndex);

        expect(calls).toEqual([3, 2]);
        expect(ringKey(draw, 'a')).toBe('a>b>c');
        expect(draw.get('a').gifterId).toBe('c');
    });

    test('uniform choices give every ring of four equally often (24 sequences, 6 rings, 4 each)', () => {
        const list = ['a', 'b', 'c', 'd'];
        const counts = new Map();

        for (let j3 = 0; j3 < 4; j3 += 1) {
            for (let j2 = 0; j2 < 3; j2 += 1) {
                for (let j1 = 0; j1 < 2; j1 += 1) {
                    const { pickIndex, calls } = scripted([j3, j2, j1]);
                    const draw = drawRecipientCycle(list, pickIndex);
                    expect(calls).toEqual([4, 3, 2]);
                    expect(isCompletePairing(toProfiles(draw))).toBe(true);
                    const key = ringKey(draw, 'a');
                    counts.set(key, (counts.get(key) || 0) + 1);
                }
            }
        }

        expect(counts.size).toBe(6);
        expect([...counts.values()]).toEqual([4, 4, 4, 4, 4, 4]);
        [...counts.keys()].forEach((key) => {
            expect(key.split('>')).toHaveLength(4);
        });
    });

    test.each([
        ['a non-array', 'a,b'],
        ['one id', ['a']],
        ['an empty-string id', ['a', '']],
        ['a non-string id', ['a', 2]],
        ['duplicate ids', ['a', 'b', 'a']],
    ])('throws for %s', (_label, input) => {
        expect(() => drawRecipientCycle(input)).toThrow('Recipient draw needs at least two distinct ids');
    });

    test.each([
        ['a non-integer', 0.5],
        ['a negative number', -1],
        ['a value above i', 4],
        ['NaN', Number.NaN],
        ['a string', '0'],
    ])('throws when pickIndex returns %s', (_label, value) => {
        expect(() => drawRecipientCycle(['a', 'b', 'c', 'd'], () => value))
            .toThrow('Recipient draw received an invalid random index');
    });

    test('a value above i is rejected even when it is below the previous bound', () => {
        // First call (i = 3) is fine; the second call (i = 2) returns 3.
        const { pickIndex } = scripted([3, 3]);
        expect(() => drawRecipientCycle(['a', 'b', 'c', 'd'], pickIndex))
            .toThrow('Recipient draw received an invalid random index');
    });
});

describe('isCompletePairing', () => {
    const ring = [
        { id: 'a', recipientId: 'b', gifterId: 'c' },
        { id: 'b', recipientId: 'c', gifterId: 'a' },
        { id: 'c', recipientId: 'a', gifterId: 'b' },
    ];

    test('a single ring is complete', () => {
        expect(isCompletePairing(ring)).toBe(true);
    });

    test('two rings are complete (validity is not ring-ness)', () => {
        expect(isCompletePairing([
            { id: 'a', recipientId: 'b', gifterId: 'b' },
            { id: 'b', recipientId: 'a', gifterId: 'a' },
            { id: 'c', recipientId: 'd', gifterId: 'd' },
            { id: 'd', recipientId: 'c', gifterId: 'c' },
        ])).toBe(true);
    });

    test.each([
        ['a self-pair', [
            { id: 'a', recipientId: 'a', gifterId: 'a' },
            { id: 'b', recipientId: 'c', gifterId: 'c' },
            { id: 'c', recipientId: 'b', gifterId: 'b' },
        ]],
        ['a duplicate recipient', [
            { id: 'a', recipientId: 'c', gifterId: 'c' },
            { id: 'b', recipientId: 'c', gifterId: 'a' },
            { id: 'c', recipientId: 'a', gifterId: 'b' },
        ]],
        ['a recipient outside the list', [
            { id: 'a', recipientId: 'b', gifterId: 'c' },
            { id: 'b', recipientId: 'z', gifterId: 'a' },
            { id: 'c', recipientId: 'a', gifterId: 'b' },
        ]],
        ['a gifterId that is not the inverse', [
            { id: 'a', recipientId: 'b', gifterId: 'c' },
            { id: 'b', recipientId: 'c', gifterId: 'c' },
            { id: 'c', recipientId: 'a', gifterId: 'b' },
        ]],
        ['a null recipient', [
            { id: 'a', recipientId: null, gifterId: 'b' },
            { id: 'b', recipientId: 'a', gifterId: null },
        ]],
        ['duplicate ids', [
            { id: 'a', recipientId: 'b', gifterId: 'b' },
            { id: 'b', recipientId: 'a', gifterId: 'a' },
            { id: 'a', recipientId: 'b', gifterId: 'b' },
        ]],
        ['fewer than two profiles', [{ id: 'a', recipientId: 'a', gifterId: 'a' }]],
        ['an empty list', []],
        ['a non-array', null],
    ])('is false for %s', (_label, profiles) => {
        expect(isCompletePairing(profiles)).toBe(false);
    });
});
