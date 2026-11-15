/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react';
import Chat from '@/components/Chat';
import ChatTabs from '@/components/ChatTabs';
import {
    enqueueMessage,
    getConversationOutboxMessages,
    subscribeOutbox,
    drainOutboxForUser,
    createClientMessageId,
} from '@/lib/message-outbox';
import { getMediaStatus, prepareImageForUpload, uploadMessageMedia } from '@/lib/media-client';
import { setWritableScope } from '@/lib/year-client';

/**
 * Chat composer GIFs. Synthetic users, uids, ids and GIF data; the placeholder key is set
 * and restored per test. Mocks match Chat_media.test.js: the upload, preparation and
 * capability probe are mocked; the session helpers and the writable scope are real.
 * GifPicker is a stub that records the onSelect/onClose/canRequest it was given.
 */

const mockShowToast = jest.fn();
const mockAuth = { currentUser: null };
const mockGifPicker = { props: null };

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
    useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('@/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    getConversationOutboxMessages: jest.fn(() => []),
    subscribeOutbox: jest.fn(() => jest.fn()),
    drainOutboxForUser: jest.fn(() => Promise.resolve({ delivered: 1, retried: 0, failed: 0, skipped: 0 })),
    retryOutboxMessage: jest.fn(() => true),
    createClientMessageId: jest.fn(),
}));

jest.mock('@/lib/media-client', () => {
    const actual = jest.requireActual('@/lib/media-client');
    return {
        ...actual,
        uploadMessageMedia: jest.fn(),
        prepareImageForUpload: jest.fn(),
        getMediaStatus: jest.fn(),
    };
});

jest.mock('@/components/GifPicker', () => {
    const MockGifPicker = (props) => {
        mockGifPicker.props = props;
        return <div data-testid="gif-picker-stub" />;
    };
    MockGifPicker.displayName = 'MockGifPicker';
    return MockGifPicker;
});

jest.mock('react-markdown', () => {
    const MockReactMarkdown = ({ children }) => <div data-testid="markdown">{children}</div>;
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
const KEY = 'e2e-giphy-placeholder';
const UID = 'uid-a';
const currentUser = { id: 'user-a', name: 'User A', recipientId: 'user-b', gifterId: 'user-c' };
const otherUser = { id: 'user-b', name: 'User B' };
const CONV = 'santa_user-a_recipient_user-b';
const SANTA_CONV = 'santa_user-c_recipient_user-a';
const SCOPE_KEY = `${UID}|user-a|2026|2`;
const IDS = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
];

const GIF = {
    id: 'SyntheticGif01',
    title: 'Synthetic GIF',
    previewUrls: [
        'https://media.giphy.com/media/SyntheticGif01/giphy.webp',
        'https://media.giphy.com/media/SyntheticGif01/200w.webp',
        'https://media.giphy.com/media/SyntheticGif01/200w.gif',
    ],
};
const REF = 'https://giphy.com/embed/SyntheticGif01';
const OTHER_GIF = { id: 'SyntheticGif02', title: 'Other', previewUrls: ['https://i.giphy.com/SyntheticGif02.webp'] };
const OTHER_REF = 'https://giphy.com/embed/SyntheticGif02';

const GIF_UNAVAILABLE_TEXT = 'GIFs are unavailable right now.';
const CAPTION_TOO_LONG_TEXT = 'That caption is too long to send with a GIF. Shorten it and try again.';
const PREVIEW_FAILED_TEXT = 'Preview unavailable. You can still send this GIF.';
const QUEUE_FAILED_TOAST = 'Failed to queue message. Please try again.';
const ATTRIBUTION_SRC = '/giphy/PoweredBy_200px-Black_HorizLogo.png';

function makeUser(uid) {
    return { uid, getIdToken: jest.fn(async () => 'token') };
}

function imageFile(name = 'synthetic.png', type = 'image/png') {
    return new File(['synthetic'], name, { type });
}

function preparedFor(file) {
    return { blob: { type: file.type, size: 100, source: file.name }, mimeType: file.type, width: 10, height: 10, bytes: 100 };
}

function input() {
    return screen.getByPlaceholderText('Type a message...');
}

function sendButton() {
    return screen.getByText('Send');
}

function gifButton() {
    return screen.getByRole('button', { name: 'Choose a GIF' });
}

function paste(file = imageFile()) {
    return fireEvent.paste(input(), { clipboardData: { files: [file], types: ['Files'] } });
}

async function settle(fn = async () => { }) {
    await act(async () => {
        await fn();
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
}

function chat(props = {}) {
    return (
        <Chat
            currentUser={currentUser}
            authUid={UID}
            otherUser={otherUser}
            isSantaChat={false}
            unreadCount={0}
            messages={[]}
            conversationId={CONV}
            {...props}
        />
    );
}

async function renderChat(props = {}) {
    const utils = render(chat(props));
    await screen.findByLabelText('Attach image');
    return utils;
}

async function attachReady(file = imageFile()) {
    paste(file);
    await screen.findByAltText('Attachment preview');
}

function openPicker() {
    fireEvent.click(gifButton());
    expect(screen.getByTestId('gif-picker-stub')).toBeInTheDocument();
    return mockGifPicker.props;
}

function selectGif(gif = GIF) {
    const props = openPicker();
    act(() => {
        props.onSelect(gif);
    });
    expect(screen.getByTestId('composer-gif')).toBeInTheDocument();
    return props;
}

function renewSameKeySession() {
    act(() => {
        setWritableScope(null);
        setWritableScope({ key: SCOPE_KEY, year: 2026 });
    });
}

function expectNoGifState() {
    expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
}

describe('Chat GIFs', () => {
    let savedKey;

    beforeEach(() => {
        jest.clearAllMocks();
        savedKey = process.env[KEY_ENV];
        process.env[KEY_ENV] = KEY;
        mockGifPicker.props = null;
        URL.createObjectURL = jest.fn(() => 'blob:preview-1');
        URL.revokeObjectURL = jest.fn();
        mockAuth.currentUser = makeUser(UID);
        setWritableScope(null);
        setWritableScope({ key: SCOPE_KEY, year: 2026 });
        getConversationOutboxMessages.mockReturnValue([]);
        subscribeOutbox.mockReturnValue(jest.fn());
        drainOutboxForUser.mockResolvedValue({ delivered: 1, retried: 0, failed: 0, skipped: 0 });
        let next = 0;
        createClientMessageId.mockImplementation(() => IDS[next++]);
        getMediaStatus.mockResolvedValue(true);
        prepareImageForUpload.mockImplementation(async (file) => preparedFor(file));
        enqueueMessage.mockImplementation(() => ({}));
    });

    afterEach(() => {
        setWritableScope(null);
        mockAuth.currentUser = null;
        if (savedKey === undefined) {
            delete process.env[KEY_ENV];
        } else {
            process.env[KEY_ENV] = savedKey;
        }
    });

    describe('configuration', () => {
        test('no key: no GIF button, zero fetch calls, and a delivered reference still renders', async () => {
            delete process.env[KEY_ENV];
            const messages = [
                { id: 'm1', fromId: 'user-b', toId: 'user-a', content: `${REF}\nHistory caption`, timestamp: '2026-12-01T10:00:00.000Z', conversationId: CONV },
            ];
            await renderChat({ messages });
            await settle();

            expect(screen.queryByRole('button', { name: 'Choose a GIF' })).not.toBeInTheDocument();
            expect(screen.queryByText('GIF')).not.toBeInTheDocument();
            const embed = screen.getByTestId('message-gif');
            expect(embed.querySelector('iframe')).toHaveAttribute('src', REF);
            expect(screen.getByTestId('markdown')).toHaveTextContent('History caption');
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('with the key: the GIF button is present, collapsed, and opening it makes no fetch', async () => {
            await renderChat();
            expect(gifButton()).toHaveAttribute('aria-expanded', 'false');
            expect(gifButton()).toHaveAttribute('title', 'Choose a GIF');
            expect(gifButton()).toHaveAttribute('type', 'button');

            openPicker();
            expect(gifButton()).toHaveAttribute('aria-expanded', 'true');
            expect(global.fetch).not.toHaveBeenCalled();

            fireEvent.click(gifButton());
            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            expect(gifButton()).toHaveAttribute('aria-expanded', 'false');
        });

        test('the picker canRequest follows the session; onClose closes it', async () => {
            await renderChat();
            const props = openPicker();
            expect(props.canRequest()).toBe(true);

            act(() => {
                props.onClose();
            });
            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();

            const reopened = openPicker();
            act(() => {
                setWritableScope(null);
            });
            expect(reopened.canRequest()).toBe(false);
        });
    });

    describe('draft and preview', () => {
        test('select shows previewUrls[0]; each error advances; after the last the status shows and Send still works', async () => {
            await renderChat();
            selectGif();

            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            const preview = () => screen.getByTestId('composer-gif-preview');
            expect(preview()).toHaveAttribute('src', GIF.previewUrls[0]);
            expect(preview()).toHaveAttribute('alt', 'GIF preview');
            expect(preview()).toHaveAttribute('referrerpolicy', 'no-referrer');
            expect(screen.queryByTestId('composer-gif-status')).not.toBeInTheDocument();

            fireEvent.error(preview());
            expect(preview()).toHaveAttribute('src', GIF.previewUrls[1]);
            fireEvent.error(preview());
            expect(preview()).toHaveAttribute('src', GIF.previewUrls[2]);
            fireEvent.error(preview());

            expect(screen.queryByTestId('composer-gif-preview')).not.toBeInTheDocument();
            expect(screen.getByTestId('composer-gif-status')).toHaveTextContent(PREVIEW_FAILED_TEXT);

            fireEvent.click(sendButton());
            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage.mock.calls[0][0].content).toBe(REF);
        });

        test('a GIF with no preview URLs shows the status at once and can be sent', async () => {
            await renderChat();
            selectGif({ id: 'SyntheticGif03', title: '', previewUrls: [] });

            expect(screen.queryByTestId('composer-gif-preview')).not.toBeInTheDocument();
            expect(screen.getByTestId('composer-gif-status')).toHaveTextContent(PREVIEW_FAILED_TEXT);
            fireEvent.click(sendButton());
            expect(enqueueMessage.mock.calls[0][0].content).toBe('https://giphy.com/embed/SyntheticGif03');
        });

        test('non-string preview entries are dropped', async () => {
            await renderChat();
            selectGif({ id: 'SyntheticGif04', title: 'x', previewUrls: [42, null, 'https://i.giphy.com/SyntheticGif04.webp'] });
            expect(screen.getByTestId('composer-gif-preview')).toHaveAttribute('src', 'https://i.giphy.com/SyntheticGif04.webp');
        });

        test('an unsendable id selects nothing', async () => {
            await renderChat();
            const props = openPicker();
            act(() => {
                props.onSelect({ id: 'bad-id', title: 'x', previewUrls: [] });
            });
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
        });

        test('composer attribution is visible after the picker closes', async () => {
            await renderChat();
            selectGif();

            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            const mark = screen.getByTestId('composer-gif-attribution');
            expect(mark).toHaveAttribute('src', ATTRIBUTION_SRC);
            expect(mark).toHaveAttribute('alt', 'Powered by GIPHY');
            expect(mark).toHaveAttribute('width', '200');
            expect(mark).toHaveAttribute('height', '26');
        });

        test('Remove GIF clears the draft; selecting again replaces the draft', async () => {
            await renderChat();
            selectGif();
            fireEvent.click(screen.getByRole('button', { name: 'Remove GIF' }));
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();

            selectGif();
            selectGif(OTHER_GIF);
            expect(screen.getByTestId('composer-gif-preview')).toHaveAttribute('src', OTHER_GIF.previewUrls[0]);
            fireEvent.click(sendButton());
            expect(enqueueMessage.mock.calls[0][0].content).toBe(OTHER_REF);
        });
    });

    describe('sending', () => {
        test('Send with a caption enqueues once with exactly the routing and the reference content', async () => {
            await renderChat();
            selectGif();
            fireEvent.change(input(), { target: { value: '  Nice one  ' } });

            fireEvent.click(sendButton());

            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledWith({
                ownerUid: UID,
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                content: `${REF}\nNice one`,
            });
            expect(Object.keys(enqueueMessage.mock.calls[0][0]).sort()).toEqual(
                ['content', 'conversationId', 'fromUserId', 'ownerUid', 'toId']
            );
            expect(drainOutboxForUser).toHaveBeenCalledWith({ ownerUid: UID, fromUserId: 'user-a' });
            expect(input().value).toBe('');
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            expect(uploadMessageMedia).not.toHaveBeenCalled();
        });

        test('GIF-only content is the bare URL', async () => {
            await renderChat();
            selectGif();
            fireEvent.click(sendButton());
            expect(enqueueMessage).toHaveBeenCalledWith({
                ownerUid: UID,
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                content: REF,
            });
        });

        test('an enqueue throw keeps the draft and caption; the next Send queues it', async () => {
            enqueueMessage
                .mockImplementationOnce(() => { throw new Error('QuotaExceededError'); })
                .mockImplementation(() => ({}));
            const errors = jest.spyOn(console, 'error').mockImplementation(() => { });
            try {
                await renderChat();
                selectGif();
                fireEvent.change(input(), { target: { value: 'Keep me' } });

                fireEvent.click(sendButton());

                expect(mockShowToast).toHaveBeenCalledWith(QUEUE_FAILED_TOAST);
                expect(screen.getByTestId('composer-gif')).toBeInTheDocument();
                expect(input().value).toBe('Keep me');

                fireEvent.click(sendButton());
                expect(enqueueMessage).toHaveBeenCalledTimes(2);
                expect(enqueueMessage.mock.calls[1][0].content).toBe(`${REF}\nKeep me`);
                expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            } finally {
                errors.mockRestore();
            }
        });

        test('content over 4000 characters: toast, no enqueue, nothing truncated', async () => {
            await renderChat();
            selectGif();
            const tooLong = 'x'.repeat(4000 - REF.length);
            fireEvent.change(input(), { target: { value: tooLong } });

            fireEvent.click(sendButton());

            expect(enqueueMessage).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith(CAPTION_TOO_LONG_TEXT);
            expect(input().value).toBe(tooLong);
            expect(screen.getByTestId('composer-gif')).toBeInTheDocument();

            const atLimit = 'x'.repeat(4000 - REF.length - 1);
            fireEvent.change(input(), { target: { value: atLimit } });
            fireEvent.click(sendButton());
            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage.mock.calls[0][0].content).toBe(`${REF}\n${atLimit}`);
            expect(enqueueMessage.mock.calls[0][0].content).toHaveLength(4000);
        });

        test('offline with a current session still enqueues', async () => {
            const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
            Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
            try {
                await renderChat();
                selectGif();
                fireEvent.click(sendButton());
                expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ content: REF }));
                expect(mockShowToast).not.toHaveBeenCalled();
            } finally {
                if (descriptor) {
                    Object.defineProperty(window.navigator, 'onLine', descriptor);
                } else {
                    delete window.navigator.onLine;
                }
            }
        });

        test('text-only send is unchanged with the key set', async () => {
            await renderChat();
            fireEvent.change(input(), { target: { value: 'Plain text' } });
            fireEvent.click(sendButton());
            expect(enqueueMessage).toHaveBeenCalledWith({
                ownerUid: UID,
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                content: 'Plain text',
            });
        });
    });

    describe('exclusivity with image drafts', () => {
        test('the GIF button is disabled while an image draft exists', async () => {
            await renderChat();
            await attachReady();

            expect(gifButton()).toBeDisabled();
            fireEvent.click(gifButton());
            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();

            fireEvent.click(screen.getByLabelText('Remove image'));
            expect(gifButton()).not.toBeDisabled();
        });

        test('a paste replaces a GIF draft and closes the picker', async () => {
            await renderChat();
            const first = selectGif();
            openPicker();

            await attachReady();

            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            expect(screen.getByTestId('composer-attachment')).toBeInTheDocument();

            act(() => {
                first.onSelect(GIF);
                mockGifPicker.props.onSelect(GIF);
            });
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            expect(uploadMessageMedia).not.toHaveBeenCalled();
        });

        test('a file attach replaces a GIF draft', async () => {
            await renderChat();
            selectGif();
            const file = imageFile('picked.gif', 'image/gif');
            fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
            await screen.findByAltText('Attachment preview');

            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            expect(uploadMessageMedia).not.toHaveBeenCalled();
        });

        test('a selection that arrives while an image draft exists only closes the picker', async () => {
            await renderChat();
            const props = openPicker();
            paste();
            await screen.findByAltText('Attachment preview');
            act(() => {
                props.onSelect(GIF);
            });
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
        });
    });

    describe('session and identity', () => {
        test('A→B→A: picker and draft are gone at B and do not return at A', async () => {
            const { rerender } = await renderChat();
            selectGif();
            openPicker();
            expect(screen.getByTestId('composer-gif')).toBeInTheDocument();

            rerender(chat({ authUid: 'uid-b' }));
            expectNoGifState();
            await settle();

            rerender(chat({ authUid: UID }));
            expectNoGifState();
            await settle();
            expectNoGifState();

            fireEvent.click(sendButton());
            expect(enqueueMessage).not.toHaveBeenCalled();
        });

        test('same-key new writable session: cleared after a re-render', async () => {
            const { rerender } = await renderChat();
            selectGif();
            openPicker();

            renewSameKeySession();
            rerender(chat());

            expectNoGifState();
        });

        test('same-key new writable session without a re-render: Send enqueues nothing, toasts and clears', async () => {
            await renderChat();
            selectGif();
            renewSameKeySession();

            fireEvent.click(sendButton());

            expect(enqueueMessage).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith(QUEUE_FAILED_TOAST);
            expectNoGifState();
        });

        test('a stale captured onSelect writes nothing after a reset or after reopening in the new scope', async () => {
            const { rerender } = await renderChat();
            const stale = openPicker();

            renewSameKeySession();
            rerender(chat());
            expectNoGifState();

            act(() => {
                stale.onSelect(GIF);
            });
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();

            const fresh = openPicker();
            act(() => {
                stale.onSelect(GIF);
            });
            expect(screen.queryByTestId('composer-gif')).not.toBeInTheDocument();
            expect(stale.canRequest()).toBe(false);

            act(() => {
                stale.onClose();
            });
            expect(screen.getByTestId('gif-picker-stub')).toBeInTheDocument();

            expect(fresh.canRequest()).toBe(true);
            act(() => {
                fresh.onSelect(GIF);
            });
            expect(screen.getByTestId('composer-gif')).toBeInTheDocument();
        });

        test('a stale selection on a stale session drops the picker', async () => {
            await renderChat();
            const props = openPicker();
            renewSameKeySession();
            act(() => {
                props.onSelect(GIF);
            });
            expectNoGifState();
        });

        test('account switch with a held draft: Send enqueues nothing', async () => {
            const { rerender } = await renderChat();
            selectGif();

            act(() => {
                mockAuth.currentUser = makeUser('uid-z');
                setWritableScope({ key: 'uid-z|user-a|2026|2', year: 2026 });
            });
            fireEvent.click(sendButton());
            expect(enqueueMessage).not.toHaveBeenCalled();
            expectNoGifState();

            rerender(chat({ authUid: 'uid-z' }));
            await settle();
            fireEvent.click(sendButton());
            expect(enqueueMessage).not.toHaveBeenCalled();
            expectNoGifState();
        });

        test('account switch then a re-render clears the draft before Send', async () => {
            const { rerender } = await renderChat();
            selectGif();
            act(() => {
                mockAuth.currentUser = makeUser('uid-z');
            });
            rerender(chat());
            expectNoGifState();
            await settle();
        });

        test('no writable scope: the click opens nothing, toasts, and makes no fetch', async () => {
            await renderChat();
            act(() => {
                setWritableScope(null);
            });

            fireEvent.click(gifButton());

            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            expect(mockShowToast).toHaveBeenCalledWith(GIF_UNAVAILABLE_TEXT);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('authUid null: the click opens nothing, toasts, and makes no fetch', async () => {
            render(chat({ authUid: null }));
            await settle();

            fireEvent.click(gifButton());

            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            expect(mockShowToast).toHaveBeenCalledWith(GIF_UNAVAILABLE_TEXT);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('through ChatTabs', () => {
        const allUsers = [
            { id: 'user-a', name: 'User A' },
            { id: 'user-b', name: 'User B' },
            { id: 'user-c', name: 'User C' },
            { id: 'user-d', name: 'User D' },
        ];
        const tabProps = {
            currentUser,
            authUid: UID,
            allUsers,
            allMessages: [],
            allReactions: [],
            recipientMessages: [],
            santaMessages: [],
            unreadCounts: { recipient: 0, santa: 0 },
            recipientConversationId: CONV,
            santaConversationId: SANTA_CONV,
        };

        test('tab switch: nothing follows or returns', async () => {
            const { rerender } = render(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            selectGif();
            openPicker();

            rerender(<ChatTabs {...tabProps} activeTab="santa" />);
            await screen.findByLabelText('Attach image');
            expectNoGifState();

            rerender(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            expectNoGifState();
        });

        test('assignment change: nothing follows or returns', async () => {
            const { rerender } = render(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            selectGif();
            openPicker();

            const reassigned = {
                ...tabProps,
                currentUser: { ...currentUser, recipientId: 'user-d' },
                recipientConversationId: 'santa_user-a_recipient_user-d',
            };
            rerender(<ChatTabs {...reassigned} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            expectNoGifState();

            fireEvent.click(sendButton());
            expect(enqueueMessage).not.toHaveBeenCalled();

            rerender(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            expectNoGifState();
        });
    });

    describe('bubbles', () => {
        test('delivered, pending and failed bubbles render the GIF with a caption-only body; a near-miss renders as before', async () => {
            const NEAR_MISS = 'https://giphy.com/embed/near-miss';
            const messages = [
                { id: 'm1', fromId: 'user-b', toId: 'user-a', content: `${REF}\nDelivered caption`, timestamp: '2026-12-01T10:00:00.000Z', conversationId: CONV },
                { id: 'm2', fromId: 'user-a', toId: 'user-b', content: OTHER_REF, timestamp: '2026-12-01T10:01:00.000Z', conversationId: CONV },
                { id: 'm3', fromId: 'user-b', toId: 'user-a', content: NEAR_MISS, timestamp: '2026-12-01T10:02:00.000Z', conversationId: CONV },
                { id: 'm4', fromId: 'user-b', toId: 'user-a', content: `${REF} trailing`, timestamp: '2026-12-01T10:03:00.000Z', conversationId: CONV },
            ];
            getConversationOutboxMessages.mockReturnValue([
                { clientMessageId: IDS[0], content: `${REF}\nPending caption`, status: 'pending', conversationId: CONV, fromUserId: 'user-a' },
                { clientMessageId: IDS[1], content: OTHER_REF, status: 'failed', conversationId: CONV, fromUserId: 'user-a' },
            ]);
            await renderChat({ messages });

            const embeds = screen.getAllByTestId('message-gif');
            expect(embeds.map((embed) => embed.querySelector('iframe').getAttribute('src'))).toEqual([REF, OTHER_REF, REF, OTHER_REF]);
            expect(screen.getAllByTestId('markdown').map((node) => node.textContent)).toEqual([
                'Delivered caption',
                NEAR_MISS,
                `${REF} trailing`,
            ]);
            expect(screen.getByText('Pending caption')).toBeInTheDocument();
            expect(screen.getByText('Sending...')).toBeInTheDocument();
            expect(screen.getByText('Failed to send')).toBeInTheDocument();
            expect(screen.getByText('Retry')).toBeInTheDocument();
            expect(screen.queryByText(REF)).not.toBeInTheDocument();
            expect(screen.queryByText(OTHER_REF)).not.toBeInTheDocument();
        });

        test('a reference with an attachment object is not a GIF message', async () => {
            const attachment = {
                id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
                kind: 'image',
                provider: 'cloudinary',
                cloudName: 'unit-cloud',
                publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
                version: 1700000000,
                format: 'png',
                width: 64,
                height: 64,
                bytes: 2048,
            };
            const messages = [
                { id: 'm1', fromId: 'user-b', toId: 'user-a', content: REF, attachment, timestamp: '2026-12-01T10:00:00.000Z', conversationId: CONV },
            ];
            await renderChat({ messages });
            expect(screen.queryByTestId('message-gif')).not.toBeInTheDocument();
            expect(screen.getByTestId('message-attachment')).toBeInTheDocument();
            expect(screen.getByTestId('markdown')).toHaveTextContent(REF);
        });
    });

    describe('other controls', () => {
        test('the emoji button closes an open GIF picker; the GIF button closes the emoji picker', async () => {
            await renderChat();
            openPicker();

            fireEvent.click(screen.getByLabelText('Add emoji'));
            expect(screen.queryByTestId('gif-picker-stub')).not.toBeInTheDocument();
            expect(await screen.findByTestId('emoji-picker')).toBeInTheDocument();

            fireEvent.click(gifButton());
            expect(screen.getByTestId('gif-picker-stub')).toBeInTheDocument();
            expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();
        });

        test('static control names contain no send, santa or recipient', async () => {
            await renderChat();
            selectGif();
            openPicker();

            ['Choose a GIF', 'Remove GIF'].forEach((name) => {
                expect(name).not.toMatch(/send|santa|recipient/i);
                expect(screen.getByRole('button', { name })).toBeInTheDocument();
            });
            expect(gifButton()).toHaveTextContent('GIF');
            ['GIF preview', 'Powered by GIPHY'].forEach((alt) => {
                expect(alt).not.toMatch(/send|santa|recipient/i);
                expect(screen.getByAltText(alt)).toBeInTheDocument();
            });
        });
    });
});
