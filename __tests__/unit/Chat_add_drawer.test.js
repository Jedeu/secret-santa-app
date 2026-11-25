/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import Chat from '@/components/Chat';
import { getConversationOutboxMessages, subscribeOutbox } from '@/lib/message-outbox';
import { getMediaStatus } from '@/lib/media-client';
import { setWritableScope } from '@/lib/year-client';

/**
 * The composer's "+" drawer: Photo, Emoji and GIF open exactly what the old inline buttons
 * opened (the file input, the emoji picker, the GIF picker); the drawer closes on Escape and
 * on an outside tap. Synthetic users and ids; the GIF key is a placeholder set per test.
 */

const mockAuth = { currentUser: null };

jest.mock('@/lib/firebase-client', () => ({
    clientAuth: {
        get currentUser() {
            return mockAuth.currentUser;
        },
    },
    firestore: {},
}));

jest.mock('@/hooks/useRealtimeMessages', () => ({
    updateLastReadTimestamp: jest.fn(),
    useOtherUserLastRead: jest.fn(() => null),
}));

jest.mock('@/hooks/useTypingIndicator', () => ({
    useTypingIndicator: jest.fn(() => false),
}));

jest.mock('@/lib/typing-client', () => ({
    setTyping: jest.fn(),
    clearTyping: jest.fn(),
}));

jest.mock('@/components/ClientProviders', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    getConversationOutboxMessages: jest.fn(() => []),
    subscribeOutbox: jest.fn(() => jest.fn()),
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 0, retried: 0, failed: 0, skipped: 0 })),
    retryOutboxMessage: jest.fn(() => true),
    createClientMessageId: jest.fn(() => '11111111-1111-4111-8111-111111111111'),
}));

jest.mock('@/lib/media-client', () => {
    const actual = jest.requireActual('@/lib/media-client');
    return { ...actual, uploadMessageMedia: jest.fn(), prepareImageForUpload: jest.fn(), getMediaStatus: jest.fn() };
});

jest.mock('@/components/GifPicker', () => {
    const MockGifPicker = () => <div data-testid="gif-picker-stub" />;
    MockGifPicker.displayName = 'MockGifPicker';
    return MockGifPicker;
});

jest.mock('react-markdown', () => {
    const MockReactMarkdown = ({ children }) => <div>{children}</div>;
    MockReactMarkdown.displayName = 'MockReactMarkdown';
    return MockReactMarkdown;
});
jest.mock('remark-gfm', () => () => { });

jest.mock('emoji-picker-react', () => {
    const MockEmojiPicker = () => <div data-testid="emoji-picker" />;
    MockEmojiPicker.displayName = 'MockEmojiPicker';
    return MockEmojiPicker;
});

window.HTMLElement.prototype.scrollIntoView = jest.fn();

const KEY_ENV = 'NEXT_PUBLIC_GIPHY_API_KEY';
const UID = 'uid-a';
const currentUser = { id: 'user-a', name: 'User A', recipientId: 'user-b', gifterId: 'user-c' };
const otherUser = { id: 'user-b', name: 'User B' };
const CONV = 'santa_user-a_recipient_user-b';

const plusButton = () => screen.getByRole('button', { name: 'Add attachment, emoji or GIF' });
const drawer = () => screen.getByRole('group', { name: 'Add to message' });
const isOpen = () => drawer().classList.contains('is-open');

async function renderChat() {
    render(
        <Chat
            currentUser={currentUser}
            authUid={UID}
            otherUser={otherUser}
            isSantaChat={false}
            unreadCount={0}
            messages={[]}
            conversationId={CONV}
        />
    );
    // Photo appears once the media capability probe resolves.
    await screen.findByRole('button', { name: 'Attach image' });
}

describe('Chat "+" drawer', () => {
    let savedKey;

    beforeEach(() => {
        jest.clearAllMocks();
        savedKey = process.env[KEY_ENV];
        process.env[KEY_ENV] = 'e2e-giphy-placeholder';
        mockAuth.currentUser = { uid: UID, getIdToken: jest.fn(async () => 'token') };
        setWritableScope(null);
        setWritableScope({ key: `${UID}|user-a|2026|2`, year: 2026 });
        getConversationOutboxMessages.mockReturnValue([]);
        subscribeOutbox.mockReturnValue(jest.fn());
        getMediaStatus.mockResolvedValue(true);
    });

    afterEach(() => {
        setWritableScope(null);
        if (savedKey === undefined) delete process.env[KEY_ENV];
        else process.env[KEY_ENV] = savedKey;
    });

    test('starts closed; + opens it with Photo, Emoji and GIF, and focus moves into it', async () => {
        await renderChat();
        expect(isOpen()).toBe(false);
        expect(plusButton()).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(plusButton());

        expect(isOpen()).toBe(true);
        expect(plusButton()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Attach image' })).toHaveTextContent('Photo');
        expect(screen.getByRole('button', { name: 'Add emoji' })).toHaveTextContent('Emoji');
        expect(screen.getByRole('button', { name: 'Choose a GIF' })).toHaveTextContent('GIF');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Attach image' }));
    });

    test('Photo opens the file input (the same one paste and the old 📎 used) and closes the drawer', async () => {
        await renderChat();
        const fileInput = screen.getByTestId('composer-file-input');
        const clickSpy = jest.spyOn(fileInput, 'click');

        fireEvent.click(plusButton());
        fireEvent.click(screen.getByRole('button', { name: 'Attach image' }));

        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(isOpen()).toBe(false);
    });

    test('Emoji opens the emoji picker and closes the drawer', async () => {
        await renderChat();
        fireEvent.click(plusButton());
        fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }));

        expect(await screen.findByTestId('emoji-picker')).toBeInTheDocument();
        expect(isOpen()).toBe(false);
    });

    test('GIF opens the GIF picker and closes the drawer', async () => {
        await renderChat();
        fireEvent.click(plusButton());
        fireEvent.click(screen.getByRole('button', { name: 'Choose a GIF' }));

        expect(screen.getByTestId('gif-picker-stub')).toBeInTheDocument();
        expect(isOpen()).toBe(false);
    });

    test('Escape closes the drawer and returns focus to +', async () => {
        await renderChat();
        fireEvent.click(plusButton());
        expect(isOpen()).toBe(true);

        fireEvent.keyDown(screen.getByRole('button', { name: 'Add emoji' }), { key: 'Escape' });

        expect(isOpen()).toBe(false);
        expect(document.activeElement).toBe(plusButton());
    });

    test('an outside tap closes the drawer', async () => {
        await renderChat();
        fireEvent.click(plusButton());
        fireEvent.mouseDown(document.body);
        expect(isOpen()).toBe(false);
    });

    test('Photo and GIF are not offered when their capability is off', async () => {
        delete process.env[KEY_ENV];
        getMediaStatus.mockResolvedValue(false);
        render(
            <Chat currentUser={currentUser} authUid={UID} otherUser={otherUser} isSantaChat={false}
                unreadCount={0} messages={[]} conversationId={CONV} />
        );
        fireEvent.click(plusButton());
        await screen.findByRole('button', { name: 'Add emoji' });
        expect(screen.queryByRole('button', { name: 'Attach image' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Choose a GIF' })).not.toBeInTheDocument();
    });

    test('Send is an icon button labelled "Send", disabled while there is nothing to send', async () => {
        await renderChat();
        const send = screen.getByRole('button', { name: 'Send' });
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Hi' } });
        expect(send).not.toBeDisabled();
    });
});
