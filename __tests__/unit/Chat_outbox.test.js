/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import Chat from '@/components/Chat';
import { updateLastReadTimestamp } from '@/hooks/useRealtimeMessages';
import {
    enqueueMessage,
    getConversationOutboxMessages,
    subscribeOutbox,
    drainOutboxForUser,
    retryOutboxMessage
} from '@/lib/message-outbox';

const mockShowToast = jest.fn();

jest.mock('@/hooks/useRealtimeMessages', () => ({
    updateLastReadTimestamp: jest.fn()
}));

jest.mock('@/components/ClientProviders', () => ({
    useToast: () => ({ showToast: mockShowToast })
}));

jest.mock('@/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    getConversationOutboxMessages: jest.fn(() => []),
    subscribeOutbox: jest.fn(() => jest.fn()),
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 1, retried: 0, failed: 0, skipped: 0 })),
    retryOutboxMessage: jest.fn(() => true)
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

window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Chat outbox behavior', () => {
    const currentUser = { id: 'user1', name: 'User 1' };
    const otherUser = { id: 'user2', name: 'User 2' };
    const conversationId = 'santa_user1_recipient_user2';

    beforeEach(() => {
        jest.clearAllMocks();
        getConversationOutboxMessages.mockReturnValue([]);
        subscribeOutbox.mockReturnValue(jest.fn());
    });

    test('enqueue-first send clears input and triggers outbox drain', () => {
        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={[]}
                conversationId={conversationId}
            />
        );

        const input = screen.getByPlaceholderText('Type a message...');
        fireEvent.change(input, { target: { value: 'Queued hello' } });
        fireEvent.click(screen.getByText('Send'));

        expect(enqueueMessage).toHaveBeenCalledWith({
            fromUserId: 'user1',
            toId: 'user2',
            conversationId,
            content: 'Queued hello'
        });
        expect(drainOutboxForUser).toHaveBeenCalledWith({ fromUserId: 'user1' });
        expect(input.value).toBe('');
        expect(updateLastReadTimestamp).toHaveBeenCalledWith('user1', 'user2', conversationId);
    });

    test('renders pending outbox bubble in conversation', () => {
        getConversationOutboxMessages.mockReturnValue([
            {
                clientMessageId: 'msg-pending',
                content: 'Pending message',
                status: 'pending',
                conversationId,
                fromUserId: 'user1'
            }
        ]);

        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={[]}
                conversationId={conversationId}
            />
        );

        expect(screen.getByText('Pending message')).toBeInTheDocument();
        expect(screen.getByText('Sending...')).toBeInTheDocument();
    });

    test('failed bubble retry button reschedules and drains', () => {
        getConversationOutboxMessages.mockReturnValue([
            {
                clientMessageId: 'msg-failed',
                content: 'Failed message',
                status: 'failed',
                conversationId,
                fromUserId: 'user1',
                lastError: 'Message id conflict',
            }
        ]);

        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={[]}
                conversationId={conversationId}
            />
        );

        fireEvent.click(screen.getByText('Retry'));

        expect(retryOutboxMessage).toHaveBeenCalledWith({
            fromUserId: 'user1',
            clientMessageId: 'msg-failed',
        });
        expect(drainOutboxForUser).toHaveBeenCalledWith({ fromUserId: 'user1' });
    });
});
