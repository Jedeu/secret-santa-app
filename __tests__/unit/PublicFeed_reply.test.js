/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import PublicFeed from '@/components/PublicFeed';

// Synthetic users and messages only.

const USERS = [
    { id: 'ann', name: 'Ann', recipientId: 'ben', gifterId: 'cat' },
    { id: 'ben', name: 'Ben', recipientId: 'cat', gifterId: 'ann' },
    { id: 'cat', name: 'Cat', recipientId: 'ann', gifterId: 'ben' },
];

const ANN_TO_BEN = 'santa_ann_recipient_ben';
const CAT_TO_ANN = 'santa_cat_recipient_ann';

const MESSAGES = [
    { id: 'm1', fromId: 'ann', toId: 'ben', content: 'Any wishes?', timestamp: '2026-12-01T10:00:00.000Z', conversationId: ANN_TO_BEN },
    { id: 'm2', fromId: 'ben', toId: 'ann', content: 'Socks', timestamp: '2026-12-01T10:05:00.000Z', conversationId: ANN_TO_BEN, replyToId: 'm1' },
    { id: 'm3', fromId: 'ann', toId: 'ben', content: 'Noted', timestamp: '2026-12-01T10:10:00.000Z', conversationId: ANN_TO_BEN, replyToId: 'm2' },
    // Ann's message as a recipient, in another thread.
    { id: 'm4', fromId: 'cat', toId: 'ann', content: 'Hi Ann', timestamp: '2026-12-01T09:00:00.000Z', conversationId: CAT_TO_ANN },
    { id: 'm5', fromId: 'ann', toId: 'ben', content: 'Odd', timestamp: '2026-12-01T10:20:00.000Z', conversationId: ANN_TO_BEN, replyToId: 'm4' },
];

describe('PublicFeed replies', () => {
    test('quotes use the feed labels: the Santa stays anonymous, and other threads are never quoted', () => {
        render(<PublicFeed messages={MESSAGES} allUsers={USERS} />);
        fireEvent.click(screen.getByText("🎁 Ben's Gift Exchange"));

        const quotes = screen.getAllByTestId('message-quote').map((quote) => quote.textContent);
        expect(quotes).toEqual([
            '🎅 SantaAny wishes?',
            'BenSocks',
            'Original message unavailable',
        ]);
        expect(quotes.join(' ')).not.toContain('Ann');
    });
});
