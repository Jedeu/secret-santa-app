/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import ChatTabs from '@/components/ChatTabs';
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
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 0, retried: 0, failed: 0, skipped: 0 })),
    retryOutboxMessage: jest.fn(() => true)
}));

jest.mock('@/components/PublicFeed', () => {
    const MockPublicFeed = () => <div data-testid="feed">Feed</div>;
    MockPublicFeed.displayName = 'MockPublicFeed';
    return MockPublicFeed;
});

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

describe('ChatTabs draft isolation', () => {
    const currentUser = { id: 'user-a', name: 'User A', recipientId: 'user-b', gifterId: 'user-c' };
    const baseProps = {
        currentUser,
        authUid: 'uid-a',
        allUsers: [
            { id: 'user-a', name: 'User A' },
            { id: 'user-b', name: 'User B' },
            { id: 'user-c', name: 'User C' },
        ],
        allMessages: [],
        allReactions: [],
        recipientMessages: [],
        santaMessages: [],
        unreadCounts: { recipient: 0, santa: 0 },
        recipientConversationId: 'santa_user-a_recipient_user-b',
        santaConversationId: 'santa_user-c_recipient_user-a',
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('a draft does not follow a tab switch and Send then enqueues nothing', () => {
        const { rerender } = render(<ChatTabs {...baseProps} activeTab="recipient" />);

        fireEvent.change(screen.getByPlaceholderText('Type a message...'), {
            target: { value: 'Draft meant for my recipient' }
        });
        expect(screen.getByPlaceholderText('Type a message...').value).toBe('Draft meant for my recipient');

        rerender(<ChatTabs {...baseProps} activeTab="santa" />);

        const santaInput = screen.getByPlaceholderText('Type a message...');
        expect(santaInput.value).toBe('');

        fireEvent.click(screen.getByText('Send'));
        expect(enqueueMessage).not.toHaveBeenCalled();

        rerender(<ChatTabs {...baseProps} activeTab="recipient" />);
        expect(screen.getByPlaceholderText('Type a message...').value).toBe('');
    });

    test('a draft does not survive an assignment change within the same tab', () => {
        const { rerender } = render(<ChatTabs {...baseProps} activeTab="recipient" />);

        fireEvent.change(screen.getByPlaceholderText('Type a message...'), {
            target: { value: 'Draft for the old recipient' }
        });

        rerender(
            <ChatTabs
                {...baseProps}
                currentUser={{ ...currentUser, recipientId: 'user-c' }}
                recipientConversationId="santa_user-a_recipient_user-c"
                activeTab="recipient"
            />
        );

        expect(screen.getByPlaceholderText('Type a message...').value).toBe('');
    });

    test('sending from the active tab enqueues with the owner uid', () => {
        render(<ChatTabs {...baseProps} activeTab="santa" />);

        fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Hi Santa' } });
        fireEvent.click(screen.getByText('Send'));

        expect(enqueueMessage).toHaveBeenCalledWith({
            ownerUid: 'uid-a',
            fromUserId: 'user-a',
            toId: 'user-c',
            conversationId: 'santa_user-c_recipient_user-a',
            content: 'Hi Santa'
        });
    });
});
