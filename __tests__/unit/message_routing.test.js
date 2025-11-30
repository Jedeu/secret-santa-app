
import { getConversationId, filterMessages } from '../../src/lib/message-utils';

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

    test('filterMessages handles legacy messages (ambiguous)', () => {
        const messages = [
            { id: 'legacy1', fromId: JED_ID, toId: LOUIS_ID, timestamp: '2023-01-01' },
            { id: 'new1', fromId: JED_ID, toId: LOUIS_ID, conversationId: CONV_JED_SANTA, timestamp: '2023-01-02' },
        ];

        // Legacy message should appear in BOTH conversations because we can't distinguish

        // Conv 1
        const conv1Messages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_JED_SANTA);
        expect(conv1Messages).toContainEqual(expect.objectContaining({ id: 'legacy1' }));
        expect(conv1Messages).toContainEqual(expect.objectContaining({ id: 'new1' }));

        // Conv 2
        const conv2Messages = filterMessages(messages, JED_ID, LOUIS_ID, CONV_LOUIS_SANTA);
        expect(conv2Messages).toContainEqual(expect.objectContaining({ id: 'legacy1' }));
        expect(conv2Messages).not.toContainEqual(expect.objectContaining({ id: 'new1' })); // New message shouldn't leak
    });

    test('filterMessages excludes unrelated messages', () => {
        const messages = [
            { id: '1', fromId: JED_ID, toId: 'other', conversationId: CONV_JED_SANTA, timestamp: '2023-01-01' },
        ];

        const result = filterMessages(messages, JED_ID, LOUIS_ID, CONV_JED_SANTA);
        expect(result).toHaveLength(0);
    });
});
