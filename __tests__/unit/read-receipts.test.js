/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Chat from '../../src/components/Chat';
import { useOtherUserLastRead } from '../../src/hooks/useRealtimeMessages';
import { getConversationOutboxMessages } from '../../src/lib/message-outbox';

jest.mock('../../src/hooks/useRealtimeMessages', () => ({
    updateLastReadTimestamp: jest.fn(),
    useOtherUserLastRead: jest.fn(),
}));

jest.mock('../../src/hooks/useTypingIndicator', () => ({
    useTypingIndicator: jest.fn(() => false)
}));

jest.mock('../../src/lib/typing-client', () => ({
    setTyping: jest.fn(),
    clearTyping: jest.fn()
}));

jest.mock('../../src/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    getConversationOutboxMessages: jest.fn(() => []),
    subscribeOutbox: jest.fn(() => () => { }),
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 0 })),
    retryOutboxMessage: jest.fn(() => true),
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

describe('read receipt rendering', () => {
    const currentUser = { id: 'user-1', name: 'User 1' };
    const otherUser = { id: 'user-2', name: 'User 2' };
    const conversationId = 'santa_user-1_recipient_user-2';

    beforeEach(() => {
        jest.clearAllMocks();
        useOtherUserLastRead.mockReturnValue(null);
        getConversationOutboxMessages.mockReturnValue([]);
    });

    test('shows delivered checkmark when recipient has not read message', () => {
        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                conversationId={conversationId}
                messages={[
                    {
                        id: 'msg-1',
                        fromId: currentUser.id,
                        toId: otherUser.id,
                        content: 'hello',
                        timestamp: '2026-02-10T10:00:00.000Z',
                    },
                ]}
            />
        );

        expect(screen.getByLabelText('Delivered')).toBeInTheDocument();
        expect(screen.queryByLabelText('Read')).not.toBeInTheDocument();
    });

    test('shows read checkmark when recipient lastRead is newer than message', () => {
        useOtherUserLastRead.mockReturnValue('2026-02-10T10:02:00.000Z');

        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                conversationId={conversationId}
                messages={[
                    {
                        id: 'msg-2',
                        fromId: currentUser.id,
                        toId: otherUser.id,
                        content: 'hello again',
                        timestamp: '2026-02-10T10:00:00.000Z',
                    },
                ]}
            />
        );

        expect(screen.getByLabelText('Read')).toBeInTheDocument();
        expect(screen.queryByLabelText('Delivered')).not.toBeInTheDocument();
    });

    test('does not show receipts for outbox-only pending messages', () => {
        getConversationOutboxMessages.mockReturnValue([
            {
                clientMessageId: 'client-1',
                status: 'pending',
                content: 'pending outbox message',
            },
        ]);

        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                conversationId={conversationId}
                messages={[]}
            />
        );

        expect(screen.getByText('Sending...')).toBeInTheDocument();
        expect(screen.queryByLabelText('Delivered')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Read')).not.toBeInTheDocument();
    });
});
