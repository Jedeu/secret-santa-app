import { buildArchiveView, UNSORTED_THREAD_ID } from '@/lib/archive-threads';
import { getConversationId, getLegacyConversationId } from '@/lib/message-utils';

// Synthetic year: Ann -> Ben -> Cal -> Ann (one-way cycle) plus a mutual pair Dee <-> Eve.
const users = [
    { id: 'ann', name: 'Ann', recipientId: 'ben', gifterId: 'cal' },
    { id: 'ben', name: 'Ben', recipientId: 'cal', gifterId: 'ann' },
    { id: 'cal', name: 'Cal', recipientId: 'ann', gifterId: 'ben' },
    { id: 'dee', name: 'Dee', recipientId: 'eve', gifterId: 'eve' },
    { id: 'eve', name: 'Eve', recipientId: 'dee', gifterId: 'dee' },
];

function message(id, fromId, toId, timestamp, extra = {}) {
    return { id, fromId, toId, content: `content ${id}`, timestamp, ...extra };
}

function allThreadMessages(view) {
    return view.threads.flatMap((thread) => thread.messages);
}

function threadById(view, id) {
    return view.threads.find((thread) => thread.id === id);
}

describe('buildArchiveView', () => {
    test('pairings come from the year users, with one pair thread each (listed even without messages)', () => {
        const view = buildArchiveView({ users, messages: [] });

        expect(view.pairings).toHaveLength(5);
        expect(view.pairings).toContainEqual({ santaId: 'ann', recipientId: 'ben', santaName: 'Ann', recipientName: 'Ben' });
        const annBen = threadById(view, getConversationId('ann', 'ben'));
        expect(annBen).toMatchObject({
            kind: 'pair',
            title: "🎁 Ben's gift exchange · Santa: Ann",
            messages: [],
        });
        expect(view.threads.every((thread) => thread.kind === 'pair')).toBe(true);
    });

    test('a mutual pair stays two directional threads', () => {
        const view = buildArchiveView({
            users,
            messages: [
                message('m1', 'dee', 'eve', '2025-12-01T10:00:00.000Z', { conversationId: getConversationId('dee', 'eve') }),
                message('m2', 'eve', 'dee', '2025-12-01T11:00:00.000Z', { conversationId: getConversationId('eve', 'dee') }),
            ],
        });

        const deeToEve = threadById(view, getConversationId('dee', 'eve'));
        const eveToDee = threadById(view, getConversationId('eve', 'dee'));
        expect(deeToEve.messages.map((m) => m.id)).toEqual(['m1']);
        expect(eveToDee.messages.map((m) => m.id)).toEqual(['m2']);
        expect(deeToEve.messages[0].label).toBe('🎅 Dee (Santa)');
        expect(eveToDee.messages[0].label).toBe('🎅 Eve (Santa)');
    });

    test('labels: Santa for the Santa side, the sender name for the recipient side', () => {
        const view = buildArchiveView({
            users,
            messages: [
                message('m1', 'ann', 'ben', '2025-12-01T10:00:00.000Z', { conversationId: getConversationId('ann', 'ben') }),
                message('m2', 'ben', 'ann', '2025-12-01T10:05:00.000Z', { conversationId: getConversationId('ann', 'ben') }),
                // Legacy flag routing.
                message('m3', 'ben', 'cal', '2025-12-01T10:10:00.000Z', { isSantaMsg: true }),
            ],
        });

        const annBen = threadById(view, getConversationId('ann', 'ben'));
        expect(annBen.messages.map((m) => [m.id, m.label])).toEqual([
            ['m1', '🎅 Ann (Santa)'],
            ['m2', 'Ben'],
        ]);
        expect(threadById(view, getConversationId('ben', 'cal')).messages[0].label).toBe('🎅 Ben (Santa)');
    });

    test('ambiguous rows get their own thread and are never labelled Santa', () => {
        // Legacy rows without conversationId or isSantaMsg between the mutual pair are ambiguous.
        const view = buildArchiveView({
            users,
            messages: [
                message('m1', 'dee', 'eve', '2025-12-01T10:00:00.000Z'),
                message('m2', 'eve', 'dee', '2025-12-01T10:01:00.000Z'),
            ],
        });

        const ambiguous = threadById(view, `ambiguous:${getLegacyConversationId('dee', 'eve')}`);
        expect(ambiguous).toMatchObject({ kind: 'ambiguous', title: 'Dee & Eve · direction unknown' });
        expect(ambiguous.messages.map((m) => m.label)).toEqual(['Dee', 'Eve']);
        allThreadMessages(view).forEach((m) => expect(m.label).not.toMatch(/Santa/));
        // Never merged into the pair threads.
        expect(threadById(view, getConversationId('dee', 'eve')).messages).toHaveLength(0);
        expect(threadById(view, getConversationId('eve', 'dee')).messages).toHaveLength(0);
    });

    test('unroutable rows are kept in a single "Other messages" thread, listed last', () => {
        const view = buildArchiveView({
            users,
            messages: [
                message('m1', 'ann', 'ann', '2025-12-01T10:00:00.000Z'),
                message('m2', 'ann', null, '2025-12-01T10:01:00.000Z'),
                message('m3', 'ann', 'ben', '2025-12-01T10:02:00.000Z', { conversationId: getConversationId('cal', 'dee') }),
                message('m4', 'ben', 'cal', '2025-12-02T10:00:00.000Z', { conversationId: getConversationId('ben', 'cal') }),
            ],
        });

        const unsorted = threadById(view, UNSORTED_THREAD_ID);
        expect(unsorted).toMatchObject({ kind: 'unsorted', title: 'Other messages' });
        expect(unsorted.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
        expect(unsorted.messages[0].label).toBe('Ann → Ann');
        expect(unsorted.messages[1].label).toBe('Ann → Unknown');
        expect(view.threads[view.threads.length - 1].id).toBe(UNSORTED_THREAD_ID);
    });

    test('a missing participant is named Unknown', () => {
        const view = buildArchiveView({
            users: [{ id: 'ann', name: 'Ann', recipientId: 'ghost', gifterId: null }],
            messages: [message('m1', 'stranger', 'ann', '2025-12-01T10:00:00.000Z')],
        });

        expect(view.pairings).toEqual([{ santaId: 'ann', recipientId: 'ghost', santaName: 'Ann', recipientName: 'Unknown' }]);
        expect(threadById(view, getConversationId('ann', 'ghost')).title).toBe("🎁 Unknown's gift exchange · Santa: Ann");
        expect(allThreadMessages(view)[0].label).toMatch(/Unknown/);
    });

    test('ordering: messages ascending (invalid last, ties by id); threads by latest, then empty by title, unsorted last', () => {
        const annBenId = getConversationId('ann', 'ben');
        const benCalId = getConversationId('ben', 'cal');
        const view = buildArchiveView({
            users,
            messages: [
                message('b', 'ann', 'ben', '2025-12-01T10:00:00.000Z', { conversationId: annBenId }),
                message('a', 'ann', 'ben', '2025-12-01T10:00:00.000Z', { conversationId: annBenId }),
                message('z', 'ann', 'ben', 'not-a-date', { conversationId: annBenId }),
                message('y', 'ann', 'ben', undefined, { conversationId: annBenId }),
                message('c', 'ann', 'ben', '2025-11-30T09:00:00.000Z', { conversationId: annBenId }),
                message('d', 'ben', 'cal', '2025-12-05T09:00:00.000Z', { conversationId: benCalId }),
                message('u', 'cal', 'cal', '2025-12-31T09:00:00.000Z'),
            ],
        });

        expect(threadById(view, annBenId).messages.map((m) => m.id)).toEqual(['c', 'a', 'b', 'y', 'z']);
        expect(threadById(view, annBenId).latestTimestamp).toBe('2025-12-01T10:00:00.000Z');

        const ids = view.threads.map((thread) => thread.id);
        expect(ids[0]).toBe(benCalId);
        expect(ids[1]).toBe(annBenId);
        expect(ids[ids.length - 1]).toBe(UNSORTED_THREAD_ID);
        const emptyTitles = view.threads.filter((thread) => thread.messages.length === 0).map((thread) => thread.title);
        expect(emptyTitles).toEqual([...emptyTitles].sort((x, y) => x.localeCompare(y)));
    });

    test('invariant: every input message appears in exactly one thread', () => {
        const messages = [
            message('m1', 'ann', 'ben', '2025-12-01T10:00:00.000Z', { conversationId: getConversationId('ann', 'ben') }),
            message('m2', 'dee', 'eve', '2025-12-01T10:00:00.000Z'),
            message('m3', 'ann', 'ann', '2025-12-01T10:00:00.000Z'),
            message('m4', 'ghost', 'ann', 'bad'),
            message('m5', 'ben', 'cal', '2025-12-01T10:00:00.000Z', { isSantaMsg: false }),
        ];
        const view = buildArchiveView({ users, messages });

        const seen = allThreadMessages(view).map((m) => m.id).sort();
        expect(seen).toEqual(messages.map((m) => m.id).sort());
    });

    test('tolerates missing inputs', () => {
        expect(buildArchiveView({ users: null, messages: undefined })).toEqual({ pairings: [], threads: [] });
    });
});
