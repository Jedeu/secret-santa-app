import {
    buildPushNotification,
    describeMessage,
    formatPushToast,
    getReceiverChat,
    toPreviewText,
} from '@/lib/push-copy';

const CONVERSATION_ID = 'santa_s1_recipient_r1';

function notify(chat, message, unread = null) {
    const { kind, text } = describeMessage(message);
    return buildPushNotification({ chat, kind, text, unread });
}

describe('push-copy', () => {
    test('the receiver chat follows the direction of the message', () => {
        expect(getReceiverChat({ fromId: 's1', toId: 'r1', conversationId: CONVERSATION_ID })).toBe('santa');
        expect(getReceiverChat({ fromId: 'r1', toId: 's1', conversationId: CONVERSATION_ID })).toBe('recipient');
        expect(getReceiverChat({ fromId: 'x', toId: 'r1', conversationId: CONVERSATION_ID })).toBeNull();
        expect(getReceiverChat({ fromId: 's1', toId: 'r1', conversationId: 'legacy' })).toBeNull();
    });

    test.each([
        ['text', { content: 'Did you get my hint?' }, 'Did you get my hint?', 'Sent you a message'],
        ['reply', { content: 'Not telling', replyToId: 'm0' }, 'Replied: Not telling', 'Replied to your message'],
        ['photo', { content: '', attachment: { format: 'jpg' } }, '\ud83d\udcf7 Photo', 'Sent a photo'],
        ['photo with caption', { content: 'Look what I found', attachment: { format: 'png' } }, '\ud83d\udcf7 Photo \u00b7 Look what I found', 'Sent a photo'],
        ['uploaded GIF', { content: '', attachment: { format: 'gif' } }, 'GIF', 'Sent a GIF'],
        ['GIPHY GIF', { content: 'https://giphy.com/embed/abc123' }, 'GIF', 'Sent a GIF'],
        ['GIPHY GIF with caption', { content: 'https://giphy.com/embed/abc123\nwhen you see the wrapping paper' }, 'GIF \u00b7 when you see the wrapping paper', 'Sent a GIF'],
    ])('%s: previewed from your Santa, hidden from your recipient', (_label, message, santaBody, recipientBody) => {
        expect(notify('santa', message)).toEqual({ title: '\ud83c\udf85 Your Santa', body: santaBody });
        expect(notify('recipient', message)).toEqual({ title: '\ud83c\udf81 Your recipient', body: recipientBody });
    });

    test('several unread messages add a count to the title, never to a single one', () => {
        expect(notify('santa', { content: 'hi' }, 3).title).toBe('\ud83c\udf85 Your Santa \u00b7 3 new');
        expect(notify('recipient', { content: 'hi' }, 2).title).toBe('\ud83c\udf81 Your recipient \u00b7 2 new');
        expect(notify('santa', { content: 'hi' }, 1).title).toBe('\ud83c\udf85 Your Santa');
        expect(notify('santa', { content: 'hi' }, null).title).toBe('\ud83c\udf85 Your Santa');
    });

    test('an unknown chat gets the app name and no preview', () => {
        expect(notify(null, { content: 'secret words' })).toEqual({ title: 'Secret Santa', body: 'Sent you a message' });
    });

    test('previews drop markdown and whitespace and stop at 100 characters', () => {
        expect(toPreviewText('**Big** hint:\n\n`socks` and [a link](https://example.com) ~~no~~'))
            .toBe('Big hint: socks and a link no');
        expect(toPreviewText('a'.repeat(150))).toBe(`${'a'.repeat(99)}\u2026`);
        // Cut by characters, so an emoji is never split into a broken half.
        expect(toPreviewText(`${'a'.repeat(98)}\ud83c\udf84\ud83c\udf84\ud83c\udf84`))
            .toBe(`${'a'.repeat(98)}\ud83c\udf84\u2026`);
    });

    test('the toast names the chat and falls back to a plain body', () => {
        expect(formatPushToast({ chat: 'santa', body: 'Did you get my hint?' })).toBe('\ud83c\udf85 Your Santa: Did you get my hint?');
        expect(formatPushToast({ chat: 'recipient', body: 'Sent a photo' })).toBe('\ud83c\udf81 Your recipient: Sent a photo');
        expect(formatPushToast({})).toBe('Secret Santa: Sent you a message');
    });
});
