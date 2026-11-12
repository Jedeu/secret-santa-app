import { DRAW_MODE_AUTO, getRevealState, hasDrawMode } from '@/lib/recipient-reveal';

/**
 * Pure reveal-state rules shared by the client and the server. Synthetic ids only.
 */

const BASE = { id: 'alpha-2026', name: 'Alpha', email: 'alpha@example.test', recipientId: 'bravo-2026', gifterId: 'charlie-2026' };
const AUTO = { ...BASE, drawMode: 'auto', revealAckRecipientId: null, revealAckAt: null };

describe('getRevealState', () => {
    test.each([
        ['null', null, 'manual'],
        ['undefined', undefined, 'manual'],
        ['a profile without drawMode', BASE, 'manual'],
        ['a manual profile without a recipient', { ...BASE, recipientId: null, gifterId: null }, 'manual'],
        ['drawMode: null', { ...BASE, drawMode: null }, 'manual'],
        ['drawMode: "other"', { ...AUTO, drawMode: 'other' }, 'invalid'],
        ['drawMode: "other" even when acknowledged', { ...AUTO, drawMode: 'other', revealAckRecipientId: AUTO.recipientId }, 'invalid'],
        ['an auto profile with a null recipient', { ...AUTO, recipientId: null }, 'invalid'],
        ['an auto profile with an empty recipient', { ...AUTO, recipientId: '' }, 'invalid'],
        ['an auto profile with a null Santa', { ...AUTO, gifterId: null }, 'invalid'],
        ['an auto profile with a self recipient', { ...AUTO, recipientId: AUTO.id }, 'invalid'],
        ['an auto profile with a self Santa', { ...AUTO, gifterId: AUTO.id }, 'invalid'],
        ['an auto profile without an id', { ...AUTO, id: '' }, 'invalid'],
        ['pending with revealAckRecipientId null', AUTO, 'pending'],
        ['pending with the ack fields absent', { ...BASE, drawMode: 'auto' }, 'pending'],
        ['pending with a different acknowledged id', { ...AUTO, revealAckRecipientId: 'delta-2026', revealAckAt: '2026-11-01T00:00:00.000Z' }, 'pending'],
        ['acknowledged', { ...AUTO, revealAckRecipientId: AUTO.recipientId, revealAckAt: '2026-11-01T00:00:00.000Z' }, 'acknowledged'],
        ['acknowledged without a time', { ...AUTO, revealAckRecipientId: AUTO.recipientId }, 'acknowledged'],
    ])('%s -> %s', (_label, user, expected) => {
        expect(getRevealState(user)).toBe(expected);
    });

    test('DRAW_MODE_AUTO is "auto"', () => {
        expect(DRAW_MODE_AUTO).toBe('auto');
    });
});

describe('hasDrawMode', () => {
    test.each([
        ['absent', BASE, false],
        ['null', { ...BASE, drawMode: null }, false],
        ['"auto"', { ...BASE, drawMode: 'auto' }, true],
        ['"other"', { ...BASE, drawMode: 'other' }, true],
        ['a null user', null, false],
        ['an undefined user', undefined, false],
    ])('%s -> %s', (_label, user, expected) => {
        expect(hasDrawMode(user)).toBe(expected);
    });
});
