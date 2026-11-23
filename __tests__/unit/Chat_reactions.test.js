/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Chat from '../../src/components/Chat';
import { toggleReaction } from '../../src/lib/reactions-client';

jest.mock('../../src/hooks/useRealtimeMessages', () => ({
    useRealtimeMessages: jest.fn(),
    updateLastReadTimestamp: jest.fn(),
    useOtherUserLastRead: jest.fn(() => null)
}));

jest.mock('../../src/hooks/useTypingIndicator', () => ({
    useTypingIndicator: jest.fn(() => false)
}));

jest.mock('../../src/lib/typing-client', () => ({
    setTyping: jest.fn(),
    clearTyping: jest.fn()
}));

jest.mock('../../src/lib/firebase-client', () => ({
    firestore: {}
}));

jest.mock('../../src/lib/reactions-client', () => ({
    toggleReaction: jest.fn(() => Promise.resolve({ action: 'added' }))
}));

jest.mock('react-markdown', () => {
    const MockReactMarkdown = ({ children }) => <div>{children}</div>;
    MockReactMarkdown.displayName = 'MockReactMarkdown';
    return MockReactMarkdown;
});
jest.mock('remark-gfm', () => () => { });
jest.mock('emoji-picker-react', () => {
    const MockEmojiPicker = ({ onEmojiClick }) => (
        <button type="button" onClick={() => onEmojiClick({ emoji: '👩‍💻' })}>Pick technologist</button>
    );
    MockEmojiPicker.displayName = 'MockEmojiPicker';
    return MockEmojiPicker;
});

window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Chat reactions', () => {
    const messages = [
        { id: 'msg-1', fromId: 'user2', toId: 'user1', content: 'Hello', timestamp: new Date().toISOString() }
    ];

    function renderChat() {
        return render(
            <Chat
                currentUser={{ id: 'user1', name: 'User 1' }}
                otherUser={{ id: 'user2', name: 'User 2' }}
                isSantaChat={false}
                unreadCount={0}
                messages={messages}
                conversationId="santa_user1_recipient_user2"
            />
        );
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reacts with a quick emoji from the row', () => {
        renderChat();
        fireEvent.click(screen.getByText('Hello'));
        fireEvent.click(screen.getByRole('button', { name: 'React with 👍' }));

        expect(toggleReaction).toHaveBeenCalledWith('msg-1', 'user1', '👍');
    });

    it('"+" opens the full picker, and a pick reacts and closes it', async () => {
        renderChat();
        fireEvent.click(screen.getByText('Hello'));
        fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));

        expect(screen.queryByRole('button', { name: 'React with 👍' })).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Choose a reaction' })).toBeTruthy();

        fireEvent.click(await screen.findByRole('button', { name: 'Pick technologist' }));

        expect(toggleReaction).toHaveBeenCalledWith('msg-1', 'user1', '👩‍💻');
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose a reaction' })).toBeNull());
    });

    it('the full picker closes on Escape and on a backdrop tap without reacting', () => {
        renderChat();
        fireEvent.click(screen.getByText('Hello'));
        fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('reaction-emoji-sheet')).toBeNull();

        fireEvent.click(screen.getByText('Hello'));
        fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));
        fireEvent.click(screen.getByTestId('reaction-emoji-sheet'));
        expect(screen.queryByTestId('reaction-emoji-sheet')).toBeNull();

        expect(toggleReaction).not.toHaveBeenCalled();
    });
});
