/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within } from '@testing-library/react';

const mockSetDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockOnSnapshot = jest.fn();

jest.mock('firebase/firestore', () => ({
    setDoc: (...args) => mockSetDoc(...args),
    deleteDoc: (...args) => mockDeleteDoc(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
    collection: jest.fn(),
    doc: jest.fn(),
    getDocsFromServer: jest.fn(),
}));

jest.mock('@/hooks/useYearArchive', () => ({
    useYearArchive: jest.fn(),
}));

jest.mock('@/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    drainOutboxForUser: jest.fn(),
}));

jest.mock('@/lib/typing-client', () => ({
    setTyping: jest.fn(),
    clearTyping: jest.fn(),
}));

import ArchiveViewer from '@/components/ArchiveViewer';
import { useYearArchive } from '@/hooks/useYearArchive';
import { enqueueMessage, drainOutboxForUser } from '@/lib/message-outbox';
import { setTyping, clearTyping } from '@/lib/typing-client';

const USERS = [
    { id: 'ann', name: 'Ann', recipientId: 'ben', gifterId: 'ben' },
    { id: 'ben', name: 'Ben', recipientId: 'ann', gifterId: 'ann' },
];
const MESSAGES = [
    {
        id: 'm1',
        fromId: 'ann',
        toId: 'ben',
        content: 'Line one\nLine two',
        timestamp: '2025-12-01T10:00:00.000Z',
        conversationId: 'santa_ann_recipient_ben',
    },
    {
        id: 'm2',
        fromId: 'ben',
        toId: 'ann',
        content: 'Reply without a date',
        timestamp: 'not-a-date',
        conversationId: 'santa_ann_recipient_ben',
    },
];
const REACTIONS = [{ messageId: 'm1', userId: 'ben', emoji: '👍', createdAt: '2025-12-01T10:01:00.000Z' }];

const reload = jest.fn();

function archiveReady() {
    useYearArchive.mockReturnValue({ status: 'ready', data: { users: USERS, messages: MESSAGES, reactions: REACTIONS }, reload });
}

function renderViewer(props = {}) {
    return render(
        <ArchiveViewer
            authUid="uid-a"
            years={[2025]}
            initialYear={2025}
            closedYears={[2025]}
            {...props}
        />
    );
}

function openFirstThread() {
    fireEvent.click(screen.getAllByTestId('archive-thread')[0]);
}

describe('ArchiveViewer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        archiveReady();
    });

    afterEach(() => {
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(mockDeleteDoc).not.toHaveBeenCalled();
        expect(mockOnSnapshot).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(drainOutboxForUser).not.toHaveBeenCalled();
        expect(setTyping).not.toHaveBeenCalled();
        expect(clearTyping).not.toHaveBeenCalled();
    });

    test('asks for the year as immutable when it is closed', () => {
        renderViewer();
        expect(useYearArchive).toHaveBeenCalledWith({ authUid: 'uid-a', year: 2025, immutable: true });
    });

    test('renders the header, the read-only note, pairings and threads', () => {
        renderViewer({ banner: 'The 2025 exchange is closed.' });

        expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '📚 2025 Archive' })).toBeInTheDocument();
        expect(screen.getByText('The 2025 exchange is closed.')).toBeInTheDocument();
        expect(screen.getByText('Read-only. Pairings are shown because this exchange is over.')).toBeInTheDocument();

        const pairings = screen.getAllByTestId('archive-pairing').map((row) => row.textContent);
        expect(pairings).toEqual(expect.arrayContaining(['🎅 Ann → 🎁 Ben', '🎅 Ben → 🎁 Ann']));

        const threads = screen.getAllByTestId('archive-thread');
        expect(threads).toHaveLength(2);
        expect(within(threads[0]).getByText("🎁 Ben's gift exchange · Santa: Ann")).toBeInTheDocument();
        expect(within(threads[0]).getByText('Line one\nLine two', { normalizer: (text) => text })).toBeInTheDocument();
        expect(within(threads[1]).getByText('No messages')).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Archive year' })).not.toBeInTheDocument();
    });

    test('a thread shows labels, plain text, dates and static reaction chips (no buttons)', () => {
        renderViewer();
        openFirstThread();

        const messages = screen.getAllByTestId('archive-message');
        expect(messages).toHaveLength(2);
        expect(within(messages[0]).getByText('🎅 Ann (Santa)')).toBeInTheDocument();
        expect(within(messages[1]).getByText('Ben')).toBeInTheDocument();
        expect(within(messages[1]).getByText('Unknown date')).toBeInTheDocument();
        expect(within(messages[0]).getByText('👍 1')).toBeInTheDocument();
        expect(within(messages[0]).queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument();
    });

    test('no pairings and no messages', () => {
        useYearArchive.mockReturnValue({ status: 'ready', data: { users: [], messages: [], reactions: [] }, reload });
        renderViewer();

        expect(screen.getByText('No pairings were recorded.')).toBeInTheDocument();
        expect(screen.queryAllByTestId('archive-thread')).toHaveLength(0);
    });

    test('with onBack, "Back to current year" is present in the list and thread views and calls onBack once', () => {
        const onBack = jest.fn();
        renderViewer({ onBack });

        expect(screen.getByRole('button', { name: 'Back to current year' })).toHaveTextContent('← Back to current year');
        openFirstThread();
        const back = screen.getByRole('button', { name: 'Back to current year' });
        fireEvent.click(back);

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    test('without onBack there is no "Back to current year" button', () => {
        renderViewer();
        expect(screen.queryByRole('button', { name: 'Back to current year' })).not.toBeInTheDocument();
        openFirstThread();
        expect(screen.queryByRole('button', { name: 'Back to current year' })).not.toBeInTheDocument();
    });

    test('"Back to conversations" returns to the list without calling onBack', () => {
        const onBack = jest.fn();
        renderViewer({ onBack });
        openFirstThread();

        fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));

        expect(screen.getAllByTestId('archive-thread')).toHaveLength(2);
        expect(screen.queryAllByTestId('archive-message')).toHaveLength(0);
        expect(onBack).not.toHaveBeenCalled();
    });

    test('loading and error states; "Try again" calls reload', () => {
        useYearArchive.mockReturnValue({ status: 'loading', data: null, reload });
        const { rerender } = renderViewer();
        expect(screen.getByText('Loading 2025…')).toBeInTheDocument();

        useYearArchive.mockReturnValue({ status: 'error', data: null, reload });
        rerender(<ArchiveViewer authUid="uid-a" years={[2025]} initialYear={2025} closedYears={[2025]} />);
        expect(screen.getByText('Could not load 2025. Check your connection and try again.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    test('a message with an attachment renders the image and the preview label', () => {
        const attachment = {
            id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
            kind: 'image',
            provider: 'cloudinary',
            cloudName: 'unit-cloud',
            publicId: 'ss-2025-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
            version: 1700000000,
            format: 'gif',
            width: 64,
            height: 64,
            bytes: 2048,
        };
        const messages = [
            MESSAGES[0],
            {
                id: 'm3',
                fromId: 'ben',
                toId: 'ann',
                content: '',
                attachment,
                timestamp: '2025-12-02T10:00:00.000Z',
                conversationId: 'santa_ann_recipient_ben',
            },
        ];
        useYearArchive.mockReturnValue({ status: 'ready', data: { users: USERS, messages, reactions: REACTIONS }, reload });
        renderViewer();

        const threads = screen.getAllByTestId('archive-thread');
        expect(within(threads[0]).getByText('📷 GIF')).toBeInTheDocument();

        fireEvent.click(threads[0]);
        const rows = screen.getAllByTestId('archive-message');
        const imageRow = rows.find((row) => within(row).queryByTestId('message-attachment'));
        const img = within(imageRow).getByTestId('message-attachment');
        expect(img).toHaveAttribute('src', 'https://res.cloudinary.com/unit-cloud/image/upload/v1700000000/ss-2025-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e.gif');
        expect(img).toHaveAttribute('alt', 'GIF');
        expect(rows.filter((row) => within(row).queryByTestId('message-attachment'))).toHaveLength(1);
    });

    test('the year select switches the requested year', () => {
        renderViewer({ years: [2026, 2025], initialYear: 2026, closedYears: [2025, 2026] });
        expect(useYearArchive).toHaveBeenLastCalledWith({ authUid: 'uid-a', year: 2026, immutable: true });

        fireEvent.change(screen.getByRole('combobox', { name: 'Archive year' }), { target: { value: '2025' } });

        expect(useYearArchive).toHaveBeenLastCalledWith({ authUid: 'uid-a', year: 2025, immutable: true });
        expect(screen.getByRole('heading', { name: '📚 2025 Archive' })).toBeInTheDocument();
    });
});
