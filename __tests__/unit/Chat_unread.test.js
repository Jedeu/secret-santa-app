/** @jest-environment jsdom */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import Chat from '../../src/components/Chat';
import { updateLastReadTimestamp } from '../../src/hooks/useRealtimeMessages';

// Mock dependencies
jest.mock('../../src/hooks/useRealtimeMessages', () => ({
    useRealtimeMessages: jest.fn(),
    updateLastReadTimestamp: jest.fn()
}));

jest.mock('../../src/lib/firebase-client', () => ({
    firestore: {}
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    addDoc: jest.fn(),
    serverTimestamp: jest.fn()
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

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Chat Component Unread Logic', () => {
    const currentUser = { id: 'user1', name: 'User 1' };
    const otherUser = { id: 'user2', name: 'User 2' };
    const conversationId = 'santa_user1_recipient_user2'; // New format
    const initialMessages = [
        { id: '1', fromId: 'user2', toId: 'user1', content: 'Hello', timestamp: new Date().toISOString() }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Mock layout properties to simulate "fits in viewport"
        Object.defineProperties(window.HTMLElement.prototype, {
            scrollHeight: { get: () => 100, configurable: true },
            clientHeight: { get: () => 200, configurable: true },
            scrollTop: { get: () => 0, configurable: true }
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should call updateLastReadTimestamp on mount', () => {
        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={1}
                messages={initialMessages}
                conversationId={conversationId}
            />
        );

        expect(updateLastReadTimestamp).toHaveBeenCalledWith('user1', 'user2', conversationId);
    });

    it('should call updateLastReadTimestamp when new messages arrive', () => {
        const { rerender } = render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={initialMessages}
                conversationId={conversationId}
            />
        );

        // Reset mock to verify subsequent calls
        updateLastReadTimestamp.mockClear();

        // Advance time to bypass debounce (2000ms)
        act(() => {
            jest.advanceTimersByTime(2500);
        });

        const newMessages = [
            ...initialMessages,
            { id: '2', fromId: 'user2', toId: 'user1', content: 'New message', timestamp: new Date().toISOString() }
        ];

        rerender(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={1}
                messages={newMessages}
                conversationId={conversationId}
            />
        );

        expect(updateLastReadTimestamp).toHaveBeenCalledWith('user1', 'user2', conversationId);
    });

    it('auto-scrolls when an incoming message arrives and user is near bottom', () => {
        const { rerender } = render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={initialMessages}
                conversationId={conversationId}
            />
        );

        window.HTMLElement.prototype.scrollIntoView.mockClear();

        rerender(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={1}
                messages={[
                    ...initialMessages,
                    { id: '2', fromId: 'user2', toId: 'user1', content: 'Incoming', timestamp: new Date().toISOString() }
                ]}
                conversationId={conversationId}
            />
        );

        expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('does not auto-scroll incoming messages when user has scrolled away from bottom', () => {
        const { rerender, container } = render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={initialMessages}
                conversationId={conversationId}
            />
        );

        const chatContainer = container.querySelector('div[style*="overflow-y: auto"]');
        Object.defineProperty(chatContainer, 'scrollHeight', { value: 500, configurable: true });
        Object.defineProperty(chatContainer, 'clientHeight', { value: 200, configurable: true });
        Object.defineProperty(chatContainer, 'scrollTop', { value: 0, configurable: true });

        fireEvent.scroll(chatContainer);
        window.HTMLElement.prototype.scrollIntoView.mockClear();

        rerender(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={1}
                messages={[
                    ...initialMessages,
                    { id: '2', fromId: 'user2', toId: 'user1', content: 'Incoming', timestamp: new Date().toISOString() }
                ]}
                conversationId={conversationId}
            />
        );

        expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('has an accessible aria-label on emoji button', () => {
        const { getByRole } = render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={initialMessages}
                conversationId={conversationId}
            />
        );

        expect(getByRole('button', { name: 'Add emoji' })).toBeInTheDocument();
    });
});
