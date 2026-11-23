/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent, screen, within, createEvent } from '@testing-library/react';
import Chat from '@/components/Chat';
import { enqueueMessage } from '@/lib/message-outbox';

jest.mock('@/hooks/useRealtimeMessages', () => ({
    updateLastReadTimestamp: jest.fn(),
    useOtherUserLastRead: jest.fn(() => null)
}));

jest.mock('@/hooks/useTypingIndicator', () => ({
    useTypingIndicator: jest.fn(() => false)
}));

jest.mock('@/lib/typing-client', () => ({
    setTyping: jest.fn(),
    clearTyping: jest.fn()
}));

jest.mock('@/components/ClientProviders', () => ({
    useToast: () => ({ showToast: jest.fn() })
}));

jest.mock('@/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    getConversationOutboxMessages: jest.fn(() => []),
    subscribeOutbox: jest.fn(() => jest.fn()),
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 1, retried: 0, failed: 0, skipped: 0 })),
    retryOutboxMessage: jest.fn(() => true),
    createClientMessageId: jest.fn(() => 'client-id')
}));

jest.mock('react-markdown', () => {
    const MockReactMarkdown = ({ children }) => <div>{children}</div>;
    MockReactMarkdown.displayName = 'MockReactMarkdown';
    return MockReactMarkdown;
});
jest.mock('remark-gfm', () => () => { });
jest.mock('emoji-picker-react', () => {
    const MockEmojiPicker = () => <div>EmojiPicker</div>;
    MockEmojiPicker.displayName = 'MockEmojiPicker';
    return MockEmojiPicker;
});

const scrollIntoView = jest.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

// jsdom has no PointerEvent; set the fields SwipeToReply reads on a plain event.
function pointer(element, type, { x, y = 100, pointerType = 'touch' }) {
    const event = createEvent[type](element);
    Object.defineProperties(event, {
        pointerType: { value: pointerType },
        pointerId: { value: 1 },
        clientX: { value: x },
        clientY: { value: y },
    });
    fireEvent(element, event);
}

describe('Chat replies', () => {
    const me = { id: 'recipient-1', name: 'Rita' };
    const santa = { id: 'santa-1', name: 'Hidden Name' };
    const conversationId = 'santa_santa-1_recipient_recipient-1';
    const question = {
        id: '11111111-1111-4111-8111-111111111111',
        fromId: santa.id,
        toId: me.id,
        content: 'What is your favourite colour?',
        timestamp: '2026-12-01T10:00:00.000Z',
        conversationId,
    };

    function renderChat(messages = [question]) {
        return render(
            <Chat
                currentUser={me}
                authUid="uid-1"
                otherUser={santa}
                isSantaChat
                unreadCount={0}
                messages={messages}
                conversationId={conversationId}
            />
        );
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Reply in the tap menu quotes the message with the anonymous label and sends replyToId', () => {
        renderChat();

        fireEvent.click(screen.getByText(question.content));
        fireEvent.click(screen.getByRole('button', { name: 'Reply' }));

        const bar = screen.getByTestId('composer-reply');
        expect(within(bar).getByText('Replying to Santa 🎅')).toBeTruthy();
        expect(bar.textContent).not.toContain(santa.name);

        fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Green' } });
        fireEvent.click(screen.getByText('Send'));

        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Green',
            conversationId,
            replyToId: question.id,
        }));
        expect(screen.queryByTestId('composer-reply')).toBeNull();
    });

    test('Cancel reply sends a plain message', () => {
        renderChat();

        fireEvent.click(screen.getByText(question.content));
        fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
        fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Hi' } });
        fireEvent.click(screen.getByText('Send'));

        expect(enqueueMessage.mock.calls[0][0]).not.toHaveProperty('replyToId');
    });

    test('a touch swipe right past the threshold starts a reply; a mouse drag does not', () => {
        renderChat();
        const row = screen.getAllByTestId('swipe-to-reply')[0];

        pointer(row, 'pointerDown', { x: 100, pointerType: 'mouse' });
        pointer(row, 'pointerMove', { x: 200, pointerType: 'mouse' });
        pointer(row, 'pointerUp', { x: 200, pointerType: 'mouse' });
        expect(screen.queryByTestId('composer-reply')).toBeNull();

        pointer(row, 'pointerDown', { x: 100 });
        pointer(row, 'pointerMove', { x: 140 });
        pointer(row, 'pointerMove', { x: 200 });
        pointer(row, 'pointerUp', { x: 200 });

        expect(screen.getByTestId('composer-reply')).toBeTruthy();
    });

    test('a vertical drag is left to scrolling and starts nothing', () => {
        renderChat();
        const row = screen.getAllByTestId('swipe-to-reply')[0];

        pointer(row, 'pointerDown', { x: 100, y: 100 });
        pointer(row, 'pointerMove', { x: 104, y: 160 });
        pointer(row, 'pointerMove', { x: 200, y: 170 });
        pointer(row, 'pointerUp', { x: 200, y: 170 });

        expect(screen.queryByTestId('composer-reply')).toBeNull();
    });

    test('a reply shows its quote and jumps to the original', () => {
        const answer = {
            id: '22222222-2222-4222-8222-222222222222',
            fromId: me.id,
            toId: santa.id,
            content: 'Green',
            timestamp: '2026-12-01T10:05:00.000Z',
            conversationId,
            replyToId: question.id,
        };
        renderChat([question, answer]);

        const quote = screen.getByTestId('message-quote');
        expect(quote.textContent).toContain('Santa 🎅');
        expect(quote.textContent).toContain(question.content);

        scrollIntoView.mockClear();
        fireEvent.click(quote);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.contexts[0].getAttribute('data-message-id')).toBe(question.id);
        // Tapping the quote does not open the reaction menu of the reply.
        expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    });

    test('a quote whose original is not in this conversation shows as unavailable', () => {
        renderChat([{
            id: '33333333-3333-4333-8333-333333333333',
            fromId: santa.id,
            toId: me.id,
            content: 'Hmm',
            timestamp: '2026-12-01T10:10:00.000Z',
            conversationId,
            replyToId: '44444444-4444-4444-8444-444444444444',
        }]);

        expect(screen.getByTestId('message-quote').textContent).toBe('Original message unavailable');
    });
});
