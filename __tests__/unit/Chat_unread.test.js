/** @jest-environment jsdom */
import React from 'react';
import { render, act } from '@testing-library/react';
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

jest.mock('react-markdown', () => ({ children }) => <div>{children}</div>);
jest.mock('remark-gfm', () => () => { });
jest.mock('emoji-picker-react', () => () => <div>EmojiPicker</div>);

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Chat Component Unread Logic', () => {
    const currentUser = { id: 'user1', name: 'User 1' };
    const otherUser = { id: 'user2', name: 'User 2' };
    const initialMessages = [
        { id: '1', fromId: 'user2', toId: 'user1', content: 'Hello', timestamp: new Date().toISOString() }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should call updateLastReadTimestamp on mount', () => {
        render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={1}
                messages={initialMessages}
            />
        );

        expect(updateLastReadTimestamp).toHaveBeenCalledWith('user1', 'user2');
    });

    it('should call updateLastReadTimestamp when new messages arrive', () => {
        const { rerender } = render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={initialMessages}
            />
        );

        // Reset mock to verify subsequent calls
        updateLastReadTimestamp.mockClear();

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
            />
        );

        expect(updateLastReadTimestamp).toHaveBeenCalledWith('user1', 'user2');
    });

    it('should NOT call updateLastReadTimestamp if messages array reference changes but length is same (optional optimization check, but current logic relies on length)', () => {
        // This test clarifies behavior. The current implementation depends on messages.length.
        // If length doesn't change, it shouldn't trigger.

        const { rerender } = render(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={initialMessages}
            />
        );

        updateLastReadTimestamp.mockClear();

        // Rerender with same messages (new array ref, same content/length)
        rerender(
            <Chat
                currentUser={currentUser}
                otherUser={otherUser}
                isSantaChat={false}
                unreadCount={0}
                messages={[...initialMessages]}
            />
        );

        expect(updateLastReadTimestamp).not.toHaveBeenCalled();
    });
});
