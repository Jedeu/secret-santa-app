
import {
    getConversationId,
    filterMessages,
    buildAssignmentMap,
    buildViewerAssignmentMap,
    resolveMessageConversation,
    resolveAuthorizedConversationId,
    matchesStoredMessage,
    getLatestMessageTimestamp,
} from '../../src/lib/message-utils';

describe('Message Routing Logic', () => {
    const JED_ID = 'jed_id';
    const LOUIS_ID = 'louis_id';

    // Scenario: Jed is Santa to Louis, AND Louis is Santa to Jed.
    // Conversation 1: Jed (Santa) -> Louis (Recipient)
    const CONV_JED_SANTA = getConversationId(JED_ID, LOUIS_ID); // santa_jed_recipient_louis

    // Conversation 2: Louis (Santa) -> Jed (Recipient)
    const CONV_LOUIS_SANTA = getConversationId(LOUIS_ID, JED_ID); // santa_louis_recipient_jed

    test('getConversationId generates correct IDs', () => {
        expect(CONV_JED_SANTA).toBe(`santa_${JED_ID}_recipient_${LOUIS_ID}`);
        expect(CONV_LOUIS_SANTA).toBe(`santa_${LOUIS_ID}_recipient_${JED_ID}`);
    });

    test('filterMessages correctly routes new messages with conversationId', () => {
        const messages = [
            { id: '1', fromId: JED_ID, toId: LOUIS_ID, conversationId: CONV_JED_SANTA, timestamp: '2023-01-01' },
            { id: '2', fromId: LOUIS_ID, toId: JED_ID, conversationId: CONV_JED_SANTA, timestamp: '2023-01-02' }, // Reply in Conv 1
            { id: '3', fromId: LOUIS_ID, toId: JED_ID, conversationId: CONV_LOUIS_SANTA, timestamp: '2023-01-03' }, // Message in Conv 2
        ];

        // Filter for Conversation 1 (Jed is Santa)
        const conv1Messages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_JED_SANTA);
        expect(conv1Messages).toHaveLength(2);
        expect(conv1Messages.map(m => m.id)).toEqual(['1', '2']);

        // Filter for Conversation 2 (Louis is Santa)
        const conv2Messages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_LOUIS_SANTA);
        expect(conv2Messages).toHaveLength(1);
        expect(conv2Messages.map(m => m.id)).toEqual(['3']);
    });

    test('filterMessages assigns legacy messages to one canonical conversation', () => {
        const messages = [
            { id: 'legacy1', fromId: JED_ID, toId: LOUIS_ID, timestamp: '2023-01-01' },
            { id: 'new1', fromId: JED_ID, toId: LOUIS_ID, conversationId: CONV_JED_SANTA, timestamp: '2023-01-02' },
        ];

        // Conv 1 (canonical for this pair when sorted ascending: jed_id, louis_id)
        const conv1Messages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_JED_SANTA);
        expect(conv1Messages).toContainEqual(expect.objectContaining({ id: 'legacy1' }));
        expect(conv1Messages).toContainEqual(expect.objectContaining({ id: 'new1' }));

        // Conv 2 should not duplicate legacy messages
        const conv2Messages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_LOUIS_SANTA);
        expect(conv2Messages).not.toContainEqual(expect.objectContaining({ id: 'legacy1' }));
        expect(conv2Messages).not.toContainEqual(expect.objectContaining({ id: 'new1' })); // New message shouldn't leak
    });

    test('filterMessages uses isSantaMsg metadata for legacy routing when available', () => {
        const messages = [
            // Louis is Santa to Jed in this legacy message
            { id: 'legacy-santa', fromId: LOUIS_ID, toId: JED_ID, isSantaMsg: true, timestamp: '2023-01-01' },
            // Jed replying to Santa (still conversation where Louis is Santa)
            { id: 'legacy-reply', fromId: JED_ID, toId: LOUIS_ID, isSantaMsg: false, timestamp: '2023-01-02' }
        ];

        const convLouisSantaMessages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_LOUIS_SANTA);
        expect(convLouisSantaMessages.map(m => m.id)).toEqual(['legacy-santa', 'legacy-reply']);

        const convJedSantaMessages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_JED_SANTA);
        expect(convJedSantaMessages).toHaveLength(0);
    });

    test('filterMessages excludes unrelated messages', () => {
        const messages = [
            { id: '1', fromId: JED_ID, toId: 'other', conversationId: CONV_JED_SANTA, timestamp: '2023-01-01' },
        ];

        const result = filterMessages(messages, JED_ID, LOUIS_ID, CONV_JED_SANTA);
        expect(result).toHaveLength(0);
    });
});

describe('Assignment-aware routing', () => {
    // Santa id sorts AFTER the recipient id, so the canonical fallback would pick the wrong direction.
    const SANTA = 'zz-santa';
    const RECIPIENT = 'aa-recipient';
    const OTHER = 'mm-other';
    const REAL_CONV = getConversationId(SANTA, RECIPIENT);
    const CANONICAL_WRONG_CONV = getConversationId(RECIPIENT, SANTA);

    test('non-mutual pair: a legacy row lands in the real conversation with the viewer map', () => {
        const viewer = { id: RECIPIENT, recipientId: OTHER, gifterId: SANTA };
        const assignments = buildViewerAssignmentMap(viewer);
        const legacy = { id: 'legacy', fromId: SANTA, toId: RECIPIENT, timestamp: '2024-01-01T00:00:00.000Z' };

        expect(filterMessages([legacy], RECIPIENT, SANTA, REAL_CONV, assignments)).toHaveLength(1);
        expect(filterMessages([legacy], RECIPIENT, SANTA, CANONICAL_WRONG_CONV, assignments)).toHaveLength(0);
        expect(resolveMessageConversation(legacy, assignments)).toMatchObject({
            conversationId: REAL_CONV,
            santaId: SANTA,
            recipientId: RECIPIENT,
            isSantaMsg: true,
            isAmbiguous: false,
            source: 'assignment',
        });

        // Without assignments the old canonical behaviour is kept.
        expect(filterMessages([legacy], RECIPIENT, SANTA, CANONICAL_WRONG_CONV)).toHaveLength(1);
    });

    test('a reply from the recipient also routes by assignment', () => {
        const assignments = buildAssignmentMap([
            { id: SANTA, recipientId: RECIPIENT },
            { id: RECIPIENT, recipientId: OTHER },
        ]);
        const reply = { id: 'reply', fromId: RECIPIENT, toId: SANTA, timestamp: '2024-01-01T00:00:00.000Z' };

        expect(resolveMessageConversation(reply, assignments)).toMatchObject({
            conversationId: REAL_CONV,
            isSantaMsg: false,
            source: 'assignment',
        });
    });

    test('mutual pair: legacy rows use the canonical conversation and are ambiguous', () => {
        const assignments = buildAssignmentMap([
            { id: SANTA, recipientId: RECIPIENT },
            { id: RECIPIENT, recipientId: SANTA },
        ]);
        const legacy = { id: 'legacy', fromId: SANTA, toId: RECIPIENT, timestamp: '2024-01-01T00:00:00.000Z' };

        expect(resolveMessageConversation(legacy, assignments)).toMatchObject({
            conversationId: CANONICAL_WRONG_CONV, // smaller id is Santa
            isAmbiguous: true,
            isSantaMsg: false,
            source: 'canonical',
        });
    });

    test('an explicit conversationId whose parties do not match the endpoints is unroutable', () => {
        const message = {
            id: 'bad',
            fromId: SANTA,
            toId: RECIPIENT,
            conversationId: getConversationId(SANTA, OTHER),
            timestamp: '2024-01-01T00:00:00.000Z',
        };

        const resolved = resolveMessageConversation(message, new Map());
        expect(resolved.source).toBe('unroutable');
        expect(resolved.isAmbiguous).toBe(true);
        expect(filterMessages([message], SANTA, RECIPIENT, REAL_CONV)).toHaveLength(0);
        expect(filterMessages([message], SANTA, RECIPIENT, CANONICAL_WRONG_CONV)).toHaveLength(0);
    });

    test('missing or equal endpoints are unroutable', () => {
        expect(resolveMessageConversation({ id: 'x', fromId: SANTA, toId: SANTA }, null).source).toBe('unroutable');
        expect(resolveMessageConversation({ id: 'y', fromId: SANTA }, null).source).toBe('unroutable');
    });

    test('a boolean isSantaMsg flag wins over assignments', () => {
        const assignments = buildAssignmentMap([{ id: SANTA, recipientId: RECIPIENT }]);
        const flagged = { id: 'f', fromId: SANTA, toId: RECIPIENT, isSantaMsg: false };

        expect(resolveMessageConversation(flagged, assignments)).toMatchObject({
            conversationId: getConversationId(RECIPIENT, SANTA),
            source: 'legacy-flag',
        });
    });
});

describe('resolveAuthorizedConversationId', () => {
    const santa = { id: 's', recipientId: 'r', gifterId: 'x' };
    const recipient = { id: 'r', recipientId: 'y', gifterId: 's' };

    test('resolves the single reciprocal candidate', () => {
        expect(resolveAuthorizedConversationId(santa, recipient, null)).toEqual({ conversationId: 'santa_s_recipient_r' });
        expect(resolveAuthorizedConversationId(recipient, santa, null)).toEqual({ conversationId: 'santa_s_recipient_r' });
    });

    test('rejects unassigned pairs, false roles and ambiguous mutual pairs', () => {
        expect(resolveAuthorizedConversationId(santa, { id: 'z', recipientId: null, gifterId: null }, null))
            .toEqual({ error: 'NOT_ASSIGNED' });
        expect(resolveAuthorizedConversationId(santa, recipient, 'santa_r_recipient_s'))
            .toEqual({ error: 'INVALID_CONVERSATION' });

        const a = { id: 'a', recipientId: 'b', gifterId: 'b' };
        const b = { id: 'b', recipientId: 'a', gifterId: 'a' };
        expect(resolveAuthorizedConversationId(a, b, null)).toEqual({ error: 'AMBIGUOUS_CONVERSATION' });
        expect(resolveAuthorizedConversationId(a, b, 'santa_b_recipient_a')).toEqual({ conversationId: 'santa_b_recipient_a' });
    });

    test('a one-sided assignment is not authorized', () => {
        expect(resolveAuthorizedConversationId(santa, { ...recipient, gifterId: null }, null))
            .toEqual({ error: 'NOT_ASSIGNED' });
    });
});

describe('matchesStoredMessage', () => {
    const existing = {
        id: 'm1',
        fromId: 's',
        toId: 'r',
        content: 'hi',
        conversationId: 'santa_s_recipient_r',
        clientMessageId: 'm1',
        timestamp: '2024-01-01T00:00:00.000Z',
    };
    const request = {
        id: 'm1',
        fromId: 's',
        toId: 'r',
        content: 'hi',
        clientMessageId: 'm1',
        clientCreatedAt: null,
        requestedConversationId: null,
    };

    test('matches identical payloads with an omitted or equal requested conversation', () => {
        expect(matchesStoredMessage(existing, request)).toBe(true);
        expect(matchesStoredMessage(existing, { ...request, requestedConversationId: 'santa_s_recipient_r' })).toBe(true);
    });

    test('null-normalizes clientCreatedAt and clientMessageId', () => {
        expect(matchesStoredMessage({ ...existing, clientCreatedAt: undefined }, { ...request, clientCreatedAt: null })).toBe(true);
    });

    test.each([
        ['content', { content: 'other' }],
        ['fromId', { fromId: 'x' }],
        ['toId', { toId: 'x' }],
        ['clientCreatedAt', { clientCreatedAt: '2024-01-01T00:00:00.000Z' }],
        ['requested conversation', { requestedConversationId: 'santa_r_recipient_s' }],
    ])('rejects a differing %s', (_label, change) => {
        expect(matchesStoredMessage(existing, { ...request, ...change })).toBe(false);
    });
});

describe('getLatestMessageTimestamp', () => {
    test('returns the latest valid timestamp string or null', () => {
        expect(getLatestMessageTimestamp([])).toBeNull();
        expect(getLatestMessageTimestamp([
            { timestamp: '2024-01-01T00:00:00.000Z' },
            { timestamp: 'garbage' },
            { timestamp: '2024-02-01T00:00:00.000Z' },
        ])).toBe('2024-02-01T00:00:00.000Z');
    });
});
