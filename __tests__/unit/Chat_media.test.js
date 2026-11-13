/** @jest-environment jsdom */
import React from 'react';
import { render, fireEvent, screen, act, within } from '@testing-library/react';
import Chat from '@/components/Chat';
import ChatTabs from '@/components/ChatTabs';
import {
    enqueueMessage,
    getConversationOutboxMessages,
    subscribeOutbox,
    drainOutboxForUser,
    createClientMessageId,
} from '@/lib/message-outbox';
import {
    MediaClientError,
    getMediaStatus,
    prepareImageForUpload,
    uploadMessageMedia,
} from '@/lib/media-client';
import { setWritableScope } from '@/lib/year-client';

/**
 * Chat composer image attachments. Synthetic users, uids and ids. The upload,
 * preparation and capability probe are mocked; the session helpers, MediaClientError,
 * describeMediaError and the writable scope are real.
 */

const mockShowToast = jest.fn();
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

jest.mock('react-markdown', () => {
    const MockReactMarkdown = ({ children }) => <div data-testid="markdown">{children}</div>;
    MockReactMarkdown.displayName = 'MockReactMarkdown';
    return MockReactMarkdown;
});
jest.mock('remark-gfm', () => () => { });
// The picker mock records the latest onEmojiClick it received so a test can replay a
// queued selection from a picker that was open before Send.
const mockEmojiPicker = { onEmojiClick: null };

jest.mock('emoji-picker-react', () => {
    const MockEmojiPicker = ({ onEmojiClick }) => {
        mockEmojiPicker.onEmojiClick = onEmojiClick;
        return (
            <div data-testid="emoji-picker">
                <button type="button" onClick={() => onEmojiClick({ emoji: '🙂' })}>Pick smile</button>
            </div>
        );
    };
    MockEmojiPicker.displayName = 'MockEmojiPicker';
    return MockEmojiPicker;
});

window.HTMLElement.prototype.scrollIntoView = jest.fn();

const actualMediaClient = jest.requireActual('@/lib/media-client');

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
    '44444444-4444-4444-8444-444444444444',
];

const ATTACHMENT = {
    id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    kind: 'image',
    provider: 'cloudinary',
    cloudName: 'unit-cloud',
    publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    version: 1700000000,
    format: 'png',
    width: 640,
    height: 480,
    bytes: 4321,
};

const UPLOAD_FAILED_TEXT = 'Upload failed. Press Send to try again.';
const QUEUE_FAILED_TEXT = "Couldn't queue the message on this device. Press Send to try again.";
const TIMEOUT_TOAST = 'The upload took too long. Check your connection and press Send to try again.';
const NOTICE = 'Images are stored at an unlisted link. Anyone who has the link can open it.';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

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

function paste(file = imageFile()) {
    return fireEvent.paste(input(), { clipboardData: { files: [file], types: ['Files'] } });
}

async function renderChat(props = {}) {
    const utils = render(
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
    await screen.findByLabelText('Attach image');
    return utils;
}

async function attachReady(file = imageFile()) {
    paste(file);
    await screen.findByAltText('Attachment preview');
}

function status() {
    return screen.getByTestId('composer-attachment-status');
}

// Runs fn inside act and drains pending microtasks (async handler continuations).
async function settle(fn = async () => { }) {
    await act(async () => {
        await fn();
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
}

describe('Chat image attachments', () => {
    let objectUrlCount;

    beforeEach(() => {
        jest.clearAllMocks();
        objectUrlCount = 0;
        URL.createObjectURL = jest.fn(() => {
            objectUrlCount += 1;
            return `blob:preview-${objectUrlCount}`;
        });
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
        uploadMessageMedia.mockResolvedValue(ATTACHMENT);
        enqueueMessage.mockImplementation(() => ({}));
    });

    afterEach(() => {
        jest.useRealTimers();
        setWritableScope(null);
        mockAuth.currentUser = null;
    });

    describe('capability', () => {
        test('disabled: no Attach button and an image paste is not intercepted', async () => {
            getMediaStatus.mockResolvedValue(false);
            render(
                <Chat currentUser={currentUser} authUid={UID} otherUser={otherUser} isSantaChat={false}
                    unreadCount={0} messages={[]} conversationId={CONV} />
            );
            await settle(async () => { await Promise.resolve(); });

            expect(screen.queryByLabelText('Attach image')).not.toBeInTheDocument();
            expect(screen.queryByTestId('composer-file-input')).not.toBeInTheDocument();
            const notPrevented = paste();
            expect(notPrevented).toBe(true);
            expect(prepareImageForUpload).not.toHaveBeenCalled();
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
        });

        test('enabled for uid A; re-rendering with uid B hides the control immediately', async () => {
            getMediaStatus.mockImplementation(({ ownerUid }) => Promise.resolve(ownerUid === UID));
            const { rerender } = await renderChat();
            expect(getMediaStatus).toHaveBeenCalledWith({ ownerUid: UID });

            rerender(
                <Chat currentUser={currentUser} authUid="uid-b" otherUser={otherUser} isSantaChat={false}
                    unreadCount={0} messages={[]} conversationId={CONV} />
            );
            expect(screen.queryByLabelText('Attach image')).not.toBeInTheDocument();
            await settle(async () => { await Promise.resolve(); });
            expect(screen.queryByLabelText('Attach image')).not.toBeInTheDocument();
        });

        test('a late true for uid A is ignored after switching to uid B', async () => {
            const lateA = deferred();
            getMediaStatus.mockImplementation(({ ownerUid }) => (ownerUid === UID ? lateA.promise : Promise.resolve(false)));
            const { rerender } = render(
                <Chat currentUser={currentUser} authUid={UID} otherUser={otherUser} isSantaChat={false}
                    unreadCount={0} messages={[]} conversationId={CONV} />
            );
            rerender(
                <Chat currentUser={currentUser} authUid="uid-b" otherUser={otherUser} isSantaChat={false}
                    unreadCount={0} messages={[]} conversationId={CONV} />
            );

            await settle(async () => { lateA.resolve(true); await lateA.promise; });

            expect(screen.queryByLabelText('Attach image')).not.toBeInTheDocument();
        });
    });

    describe('drafts', () => {
        test('paste shows the preview and notice; Remove clears it, revokes the URL and never uploads', async () => {
            await renderChat();
            const notPrevented = paste();
            expect(notPrevented).toBe(false);
            const preview = await screen.findByAltText('Attachment preview');

            expect(preview).toHaveAttribute('src', 'blob:preview-1');
            expect(screen.getByText(NOTICE)).toBeInTheDocument();
            expect(status()).toHaveTextContent('');

            fireEvent.click(screen.getByLabelText('Remove image'));

            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
            expect(uploadMessageMedia).not.toHaveBeenCalled();
        });

        test('a text paste is not intercepted', async () => {
            await renderChat();
            const notPrevented = fireEvent.paste(input(), { clipboardData: { files: [], types: ['text/plain'] } });
            expect(notPrevented).toBe(true);
            expect(prepareImageForUpload).not.toHaveBeenCalled();
        });

        test('the file input attaches the selected image', async () => {
            await renderChat();
            const file = imageFile('picked.gif', 'image/gif');
            fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });

            await screen.findByAltText('Attachment preview');
            expect(prepareImageForUpload).toHaveBeenCalledWith(file);
        });

        test('while preparing there is no blob/preview, no thumbnail, and Send is disabled', async () => {
            const gate = deferred();
            prepareImageForUpload.mockReturnValueOnce(gate.promise);
            await renderChat();
            paste();

            expect(status()).toHaveTextContent('Preparing…');
            expect(screen.queryByAltText('Attachment preview')).not.toBeInTheDocument();
            expect(URL.createObjectURL).not.toHaveBeenCalled();
            expect(sendButton()).toBeDisabled();

            await settle(async () => { gate.resolve(preparedFor(imageFile())); await gate.promise; });
            expect(screen.getByAltText('Attachment preview')).toBeInTheDocument();
            expect(sendButton()).not.toBeDisabled();
        });

        test('an old prepare result cannot replace a newer draft', async () => {
            const first = deferred();
            const second = deferred();
            prepareImageForUpload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
            await renderChat();
            const fileA = imageFile('a.png');
            const fileB = imageFile('b.png');

            paste(fileA);
            paste(fileB);
            await settle(async () => { second.resolve(preparedFor(fileB)); await second.promise; });
            await settle(async () => { first.resolve(preparedFor(fileA)); await first.promise; });

            expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
            expect(URL.createObjectURL.mock.calls[0][0].source).toBe('b.png');
            expect(screen.getByAltText('Attachment preview')).toHaveAttribute('src', 'blob:preview-1');
        });

        test('a failed preparation clears the draft and toasts', async () => {
            prepareImageForUpload.mockRejectedValueOnce(new MediaClientError('UNSUPPORTED_MEDIA_TYPE'));
            await renderChat();
            paste();
            await settle();

            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(mockShowToast).toHaveBeenCalledWith("That image type isn't supported. Use JPEG, PNG or GIF.");
        });
    });

    describe('sending', () => {
        test('captioned send: one upload, then enqueue with the captured routing, same id and attachment', async () => {
            await renderChat();
            fireEvent.change(input(), { target: { value: 'A caption' } });
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(uploadMessageMedia).toHaveBeenCalledTimes(1);
            const uploadArgs = uploadMessageMedia.mock.calls[0][0];
            expect(uploadArgs).toMatchObject({
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                clientMessageId: IDS[0],
                mimeType: 'image/png',
                blob: expect.objectContaining({ source: 'synthetic.png' }),
            });
            expect(uploadArgs.session).toMatchObject({ ownerUid: UID, scope: expect.objectContaining({ key: SCOPE_KEY }) });
            expect(uploadArgs.signal).toBeDefined();

            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledWith({
                ownerUid: UID,
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                content: 'A caption',
                clientMessageId: IDS[0],
                attachment: ATTACHMENT,
            });
            expect(drainOutboxForUser).toHaveBeenCalledWith({ ownerUid: UID, fromUserId: 'user-a' });
            expect(input().value).toBe('');
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
        });

        test('media-only send enqueues an empty caption', async () => {
            await renderChat();
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ content: '', clientMessageId: IDS[0], attachment: ATTACHMENT }));
        });

        test('double submit -> one upload; controls are disabled while uploading', async () => {
            const gate = deferred();
            uploadMessageMedia.mockReturnValueOnce(gate.promise);
            await renderChat();
            await attachReady();

            fireEvent.click(sendButton());
            fireEvent.submit(input().closest('form'));
            fireEvent.submit(input().closest('form'));

            expect(uploadMessageMedia).toHaveBeenCalledTimes(1);
            expect(status()).toHaveTextContent('Uploading…');
            expect(input()).toBeDisabled();
            expect(screen.getByLabelText('Attach image')).toBeDisabled();
            expect(sendButton()).toBeDisabled();
            expect(screen.getByLabelText('Remove image')).not.toBeDisabled();

            await settle(async () => { gate.resolve(ATTACHMENT); await gate.promise; });
            expect(enqueueMessage).toHaveBeenCalledTimes(1);
        });

        test('upload failure keeps text and preview; retry reuses the same clientMessageId', async () => {
            uploadMessageMedia.mockRejectedValueOnce(new MediaClientError('UPLOAD_FAILED', 503));
            await renderChat();
            fireEvent.change(input(), { target: { value: 'Keep me' } });
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(enqueueMessage).not.toHaveBeenCalled();
            expect(status()).toHaveTextContent(UPLOAD_FAILED_TEXT);
            expect(input().value).toBe('Keep me');
            expect(screen.getByAltText('Attachment preview')).toBeInTheDocument();
            expect(mockShowToast).toHaveBeenCalledWith("Couldn't upload the image. Check your connection and try again.");

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(uploadMessageMedia).toHaveBeenCalledTimes(2);
            expect(uploadMessageMedia.mock.calls[1][0].clientMessageId).toBe(IDS[0]);
            expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: IDS[0], content: 'Keep me' }));
        });

        test('timeout is visible and retryable', async () => {
            uploadMessageMedia.mockRejectedValueOnce(new MediaClientError('UPLOAD_TIMEOUT'));
            await renderChat();
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(status()).toHaveTextContent(UPLOAD_FAILED_TEXT);
            expect(input()).not.toBeDisabled();
            expect(screen.getByLabelText('Attach image')).not.toBeDisabled();
            expect(sendButton()).not.toBeDisabled();
            expect(mockShowToast).toHaveBeenCalledWith(TIMEOUT_TOAST);
            expect(enqueueMessage).not.toHaveBeenCalled();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: IDS[0], attachment: ATTACHMENT }));
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
        });

        test('timeout end to end with the real upload and a fetch that never resolves', async () => {
            const savedFetch = global.fetch;
            global.fetch = jest.fn(() => new Promise(() => { }));
            uploadMessageMedia.mockImplementation(actualMediaClient.uploadMessageMedia);
            try {
                await renderChat();
                await attachReady();
                jest.useFakeTimers();

                fireEvent.click(sendButton());
                await settle(async () => { await jest.advanceTimersByTimeAsync(0); });
                expect(status()).toHaveTextContent('Uploading…');
                expect(global.fetch).toHaveBeenCalledTimes(1);
                expect(input()).toBeDisabled();

                await settle(async () => { await jest.advanceTimersByTimeAsync(45000); });

                expect(status()).toHaveTextContent(UPLOAD_FAILED_TEXT);
                expect(input()).not.toBeDisabled();
                expect(sendButton()).not.toBeDisabled();
                expect(mockShowToast).toHaveBeenCalledWith(TIMEOUT_TOAST);
                expect(enqueueMessage).not.toHaveBeenCalled();
                expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
            } finally {
                global.fetch = savedFetch;
            }
        });

        test('Remove during upload aborts; a late UPLOAD_CANCELLED is ignored', async () => {
            const gate = deferred();
            uploadMessageMedia.mockReturnValueOnce(gate.promise);
            await renderChat();
            await attachReady();
            fireEvent.click(sendButton());
            const { signal } = uploadMessageMedia.mock.calls[0][0];

            fireEvent.click(screen.getByLabelText('Remove image'));
            expect(signal.aborted).toBe(true);
            await settle(async () => {
                gate.reject(new MediaClientError('UPLOAD_CANCELLED'));
                await gate.promise.catch(() => { });
            });

            expect(mockShowToast).not.toHaveBeenCalled();
            expect(enqueueMessage).not.toHaveBeenCalled();
            expect(drainOutboxForUser).not.toHaveBeenCalled();
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(input()).not.toBeDisabled();
        });

        test('an UPLOAD_CANCELLED while the token is current is a visible retryable failure', async () => {
            uploadMessageMedia.mockRejectedValueOnce(new MediaClientError('UPLOAD_CANCELLED'));
            await renderChat();
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(status()).toHaveTextContent(UPLOAD_FAILED_TEXT);
            expect(input()).not.toBeDisabled();
            expect(sendButton()).not.toBeDisabled();
            expect(mockShowToast).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).not.toHaveBeenCalled();
        });

        test('MESSAGE_ALREADY_SENT clears the draft without enqueueing', async () => {
            uploadMessageMedia.mockRejectedValueOnce(new MediaClientError('MESSAGE_ALREADY_SENT', 409));
            await renderChat();
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(enqueueMessage).not.toHaveBeenCalled();
        });

        test('queue failure keeps the draft; the next Send re-queues without a second upload', async () => {
            enqueueMessage
                .mockImplementationOnce(() => { throw new Error('QuotaExceededError'); })
                .mockImplementation(() => ({}));
            jest.spyOn(console, 'error').mockImplementation(() => { });
            await renderChat();
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(status()).toHaveTextContent(QUEUE_FAILED_TEXT);
            expect(mockShowToast).toHaveBeenCalledWith(QUEUE_FAILED_TEXT);
            expect(screen.getByAltText('Attachment preview')).toBeInTheDocument();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(uploadMessageMedia).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledTimes(2);
            expect(enqueueMessage.mock.calls[1][0]).toMatchObject({ clientMessageId: IDS[0], attachment: ATTACHMENT });
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            console.error.mockRestore();
        });

        test('offline: an image send is refused without an upload; a text-only send still enqueues', async () => {
            const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
            Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
            try {
                await renderChat();
                await attachReady();

                await settle(async () => { fireEvent.click(sendButton()); });

                expect(uploadMessageMedia).not.toHaveBeenCalled();
                expect(mockShowToast).toHaveBeenCalledTimes(1);
                expect(screen.getByAltText('Attachment preview')).toBeInTheDocument();

                fireEvent.click(screen.getByLabelText('Remove image'));
                fireEvent.change(input(), { target: { value: 'Offline text' } });
                fireEvent.click(sendButton());

                expect(enqueueMessage).toHaveBeenCalledWith({
                    ownerUid: UID,
                    fromUserId: 'user-a',
                    toId: 'user-b',
                    conversationId: CONV,
                    content: 'Offline text',
                });
            } finally {
                if (descriptor) {
                    Object.defineProperty(window.navigator, 'onLine', descriptor);
                } else {
                    delete window.navigator.onLine;
                }
            }
        });

        test('no session (closed year) -> the queue-failure toast and no upload', async () => {
            await renderChat();
            await attachReady();
            setWritableScope(null);

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(uploadMessageMedia).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('Failed to queue message. Please try again.');
        });
    });

    describe('late completion', () => {
        const tabProps = {
            currentUser,
            authUid: UID,
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
            recipientConversationId: CONV,
            santaConversationId: SANTA_CONV,
        };

        test('allowed: after an ordinary tab switch the message is queued into its original conversation', async () => {
            const errors = jest.spyOn(console, 'error');
            const gate = deferred();
            uploadMessageMedia.mockReturnValueOnce(gate.promise);
            const { rerender } = render(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            fireEvent.change(input(), { target: { value: 'For my recipient' } });
            await attachReady();
            fireEvent.click(sendButton());

            rerender(<ChatTabs {...tabProps} activeTab="santa" />);
            await screen.findByLabelText('Attach image');
            fireEvent.change(input(), { target: { value: 'Santa draft' } });

            await settle(async () => { gate.resolve(ATTACHMENT); await gate.promise; });

            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledWith({
                ownerUid: UID,
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                content: 'For my recipient',
                clientMessageId: IDS[0],
                attachment: ATTACHMENT,
            });
            expect(drainOutboxForUser).toHaveBeenCalledWith({ ownerUid: UID, fromUserId: 'user-a' });
            expect(input().value).toBe('Santa draft');
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(mockShowToast).not.toHaveBeenCalled();
            const reactWarnings = errors.mock.calls.filter(([first]) => /Warning|act\(|unmounted/.test(String(first)));
            expect(reactWarnings).toHaveLength(0);
            errors.mockRestore();
        });

        test('a draft attachment does not survive a tab switch', async () => {
            const { rerender } = render(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            await attachReady();

            rerender(<ChatTabs {...tabProps} activeTab="santa" />);
            await screen.findByLabelText('Attach image');
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();

            rerender(<ChatTabs {...tabProps} activeTab="recipient" />);
            await screen.findByLabelText('Attach image');
            expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
        });

        const STALE_SCENARIOS = [
            ['Remove', () => fireEvent.click(screen.getByLabelText('Remove image'))],
            ['Close (scope cleared)', () => setWritableScope(null)],
            ['Start (new scope key)', () => setWritableScope({ key: `${UID}|user-a|2027|3`, year: 2027 })],
            ['account switch', () => {
                mockAuth.currentUser = makeUser('uid-z');
                setWritableScope({ key: 'uid-z|user-a|2026|2', year: 2026 });
            }],
            ['same-account sign-out/in', () => {
                setWritableScope(null);
                setWritableScope({ key: SCOPE_KEY, year: 2026 });
            }],
        ];

        describe.each(STALE_SCENARIOS)('rejected after %s', (_label, makeStale) => {
            test.each([['resolve'], ['reject']])('on %s: no enqueue, no drain, no toast', async (outcome) => {
                const gate = deferred();
                uploadMessageMedia.mockReturnValueOnce(gate.promise);
                await renderChat();
                await attachReady();
                fireEvent.click(sendButton());
                expect(uploadMessageMedia).toHaveBeenCalledTimes(1);

                act(() => { makeStale(); });
                await settle(async () => {
                    if (outcome === 'resolve') {
                        gate.resolve(ATTACHMENT);
                        await gate.promise;
                    } else {
                        gate.reject(new MediaClientError('UPLOAD_FAILED'));
                        await gate.promise.catch(() => { });
                    }
                });

                expect(enqueueMessage).not.toHaveBeenCalled();
                expect(drainOutboxForUser).not.toHaveBeenCalled();
                expect(mockShowToast).not.toHaveBeenCalled();
                expect(screen.queryByTestId('composer-attachment')).not.toBeInTheDocument();
            });
        });
    });

    describe('bubbles', () => {
        test('pending and failed outbox items with an attachment render the image', async () => {
            getConversationOutboxMessages.mockReturnValue([
                { clientMessageId: IDS[0], content: 'Pending caption', attachment: ATTACHMENT, status: 'pending', conversationId: CONV, fromUserId: 'user-a' },
                { clientMessageId: IDS[1], content: '', attachment: { ...ATTACHMENT, format: 'gif' }, status: 'failed', conversationId: CONV, fromUserId: 'user-a' },
            ]);
            await renderChat();

            const images = screen.getAllByTestId('message-attachment');
            expect(images).toHaveLength(2);
            expect(screen.getByText('Pending caption')).toBeInTheDocument();
            expect(screen.getByText('Sending...')).toBeInTheDocument();
            expect(screen.getByText('Failed to send')).toBeInTheDocument();
            expect(screen.getByText('Retry')).toBeInTheDocument();
        });

        test('a delivered media-only message renders the image and no markdown node', async () => {
            const messages = [
                { id: 'm1', fromId: 'user-b', toId: 'user-a', content: '', attachment: ATTACHMENT, timestamp: '2026-12-01T10:00:00.000Z', conversationId: CONV },
                { id: 'm2', fromId: 'user-a', toId: 'user-b', content: 'Text reply', timestamp: '2026-12-01T10:01:00.000Z', conversationId: CONV },
            ];
            await renderChat({ messages });

            const img = screen.getByTestId('message-attachment');
            const bubble = img.parentElement;
            expect(within(bubble).queryByTestId('markdown')).not.toBeInTheDocument();
            expect(screen.getAllByTestId('markdown')).toHaveLength(1);
            expect(screen.getByText('Text reply')).toBeInTheDocument();
        });

        test('a delivered captioned image renders the image above the markdown', async () => {
            const messages = [
                { id: 'm1', fromId: 'user-b', toId: 'user-a', content: 'Caption here', attachment: ATTACHMENT, timestamp: '2026-12-01T10:00:00.000Z', conversationId: CONV },
            ];
            await renderChat({ messages });

            const img = screen.getByTestId('message-attachment');
            const markdown = within(img.parentElement).getByTestId('markdown');
            expect(markdown).toHaveTextContent('Caption here');
            expect(img.compareDocumentPosition(markdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });
    });

    describe('emoji picker during an image send', () => {
        const CAPTION = 'Caption before upload';

        function addEmojiButton() {
            return screen.getByLabelText('Add emoji');
        }

        async function openPicker() {
            fireEvent.click(addEmojiButton());
            return screen.findByTestId('emoji-picker');
        }

        test('the picker cannot open or edit the caption while an upload is held', async () => {
            const gate = deferred();
            uploadMessageMedia.mockReturnValueOnce(gate.promise);
            await renderChat();
            fireEvent.change(input(), { target: { value: CAPTION } });
            await attachReady();

            fireEvent.click(sendButton());
            expect(status()).toHaveTextContent('Uploading…');
            expect(addEmojiButton()).toBeDisabled();

            fireEvent.click(addEmojiButton());
            await settle();
            expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();
            expect(input()).toHaveValue(CAPTION);

            await settle(async () => { gate.resolve(ATTACHMENT); await gate.promise; });

            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ content: CAPTION, clientMessageId: IDS[0] }));
            expect(input()).toHaveValue('');
            expect(addEmojiButton()).not.toBeDisabled();
        });

        test('a picker opened before Send is closed by Send and cannot alter the caption afterwards', async () => {
            const gate = deferred();
            uploadMessageMedia.mockReturnValueOnce(gate.promise);
            await renderChat();
            fireEvent.change(input(), { target: { value: CAPTION } });
            await attachReady();
            await openPicker();
            const queuedSelection = mockEmojiPicker.onEmojiClick;
            expect(typeof queuedSelection).toBe('function');

            fireEvent.click(sendButton());

            expect(status()).toHaveTextContent('Uploading…');
            expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();

            act(() => { queuedSelection({ emoji: '🙂' }); });
            await settle();
            expect(input()).toHaveValue(CAPTION);
            expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();

            await settle(async () => { gate.resolve(ATTACHMENT); await gate.promise; });

            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage.mock.calls[0][0].content).toBe(CAPTION);
            expect(input()).toHaveValue('');
        });

        test.each([
            ['a failed upload', 'UPLOAD_FAILED'],
            ['a timeout', 'UPLOAD_TIMEOUT'],
        ])('after %s, emoji insertion works normally and the retry sends the edited caption', async (_label, code) => {
            uploadMessageMedia.mockRejectedValueOnce(new MediaClientError(code));
            await renderChat();
            fireEvent.change(input(), { target: { value: CAPTION } });
            await attachReady();

            await settle(async () => { fireEvent.click(sendButton()); });
            expect(status()).toHaveTextContent(UPLOAD_FAILED_TEXT);
            expect(addEmojiButton()).not.toBeDisabled();

            await openPicker();
            fireEvent.click(screen.getByText('Pick smile'));

            expect(input()).toHaveValue(`${CAPTION}🙂`);
            expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();

            await settle(async () => { fireEvent.click(sendButton()); });

            expect(uploadMessageMedia).toHaveBeenCalledTimes(2);
            expect(uploadMessageMedia.mock.calls[1][0].clientMessageId).toBe(IDS[0]);
            expect(enqueueMessage).toHaveBeenCalledTimes(1);
            expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
                content: `${CAPTION}🙂`,
                clientMessageId: IDS[0],
                attachment: ATTACHMENT,
            }));
        });

        test('outside an upload the picker inserts normally, with and without a ready draft', async () => {
            await renderChat();
            fireEvent.change(input(), { target: { value: 'Hello' } });

            await openPicker();
            fireEvent.click(screen.getByText('Pick smile'));
            expect(input()).toHaveValue('Hello🙂');
            expect(screen.queryByTestId('emoji-picker')).not.toBeInTheDocument();

            await attachReady();
            expect(addEmojiButton()).not.toBeDisabled();
            await openPicker();
            fireEvent.click(screen.getByText('Pick smile'));
            expect(input()).toHaveValue('Hello🙂🙂');
            expect(uploadMessageMedia).not.toHaveBeenCalled();
        });

        test('text-only send with an emoji is unchanged', async () => {
            await renderChat();
            fireEvent.change(input(), { target: { value: 'Plain' } });
            await openPicker();
            fireEvent.click(screen.getByText('Pick smile'));

            fireEvent.click(sendButton());

            expect(enqueueMessage).toHaveBeenCalledWith({
                ownerUid: UID,
                fromUserId: 'user-a',
                toId: 'user-b',
                conversationId: CONV,
                content: 'Plain🙂',
            });
            expect(uploadMessageMedia).not.toHaveBeenCalled();
        });
    });

    test('no new control has an accessible name containing send, santa or recipient', async () => {
        await renderChat();
        await attachReady();

        ['Attach image', 'Remove image'].forEach((name) => {
            expect(name).not.toMatch(/send|santa|recipient/i);
            expect(screen.getByRole('button', { name })).toBeInTheDocument();
        });
        expect(screen.getByAltText('Attachment preview').getAttribute('alt')).not.toMatch(/send|santa|recipient/i);
    });
});
