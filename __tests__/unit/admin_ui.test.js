/**
 * @jest-environment jsdom
 */

import Home from '../../src/app/page';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { collection, getDocs } from 'firebase/firestore';
import { RealtimeMessagesProvider } from '../../src/context/RealtimeMessagesContext';
import { useUser } from '../../src/hooks/useUser';
import { clientAuth } from '../../src/lib/firebase-client';
import { ADMIN_EMAILS } from '../../src/lib/config';
import { PARTICIPANTS, getRosterNames } from '../../src/lib/participants';
import { LEGACY_ACTIVE_SEASON } from '../helpers/useUser-mock';

const mockArchiveViewer = jest.fn();

// Mock dependencies
jest.mock('../../src/hooks/useUser', () => ({
    useUser: jest.fn()
}));

// Mock components that make network calls or complex imports
jest.mock('../../src/components/Chat', () => {
    const MockChat = () => <div data-testid="chat-component">Chat</div>;
    MockChat.displayName = 'MockChat';
    return MockChat;
});

jest.mock('../../src/components/PublicFeed', () => {
    const MockPublicFeed = () => <div data-testid="feed-component">Feed</div>;
    MockPublicFeed.displayName = 'MockPublicFeed';
    return MockPublicFeed;
});

jest.mock('../../src/components/ArchiveViewer', () => {
    const MockArchiveViewer = (props) => {
        mockArchiveViewer(props);
        return (
            <div data-testid="archive-viewer">
                {props.banner}
                {props.onBack && <button type="button" onClick={props.onBack}>Back to current year</button>}
            </div>
        );
    };
    MockArchiveViewer.displayName = 'MockArchiveViewer';
    return MockArchiveViewer;
});

// Mock hooks to avoid real Firebase calls
jest.mock('../../src/hooks/useRealtimeMessages', () => ({
    useRealtimeAllMessages: jest.fn(() => []),
    useRealtimeAllMessagesLoading: jest.fn(() => false),
    useRealtimeAllReactions: jest.fn(() => []),
    useRealtimeUnreadCounts: jest.fn(() => ({ recipientUnread: 0, santaUnread: 0 }))
}));

// Mock Firestore
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    doc: jest.fn(),
    getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
    addDoc: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    onSnapshot: jest.fn(() => jest.fn()),
    serverTimestamp: jest.fn()
}));

const ADMIN_EMAIL = ADMIN_EMAILS[0];
const CLOSED_2025 = { year: 2025, state: 'closed', epoch: 1, closedYears: [2025] };
const ACTIVE_2026 = { year: 2026, state: 'active', epoch: 2, closedYears: [2025] };

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function usersSnapshot(rows) {
    return { docs: rows.map((row) => ({ id: row.id, data: () => row })) };
}

function mockUser(user, { season = LEGACY_ACTIVE_SEASON, authUid = 'admin-uid', refreshUser = jest.fn() } = {}) {
    useUser.mockReturnValue({ user, authUid, season, loading: false, error: null, refreshUser });
    return refreshUser;
}

const tree = () => (
    <RealtimeMessagesProvider>
        <Home />
    </RealtimeMessagesProvider>
);

describe('Admin UI', () => {
    const renderWithProvider = () => render(tree());

    beforeEach(() => {
        jest.clearAllMocks();
        window.prompt = jest.fn(() => null);
        global.confirm = jest.fn(() => true);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
        clientAuth.currentUser = { uid: 'admin-uid', getIdToken: jest.fn().mockResolvedValue('admin-id-token') };
        collection.mockImplementation((db, ...segments) => ({ path: segments.join('/') }));
        getDocs.mockImplementation(() => Promise.resolve({ docs: [] }));
    });

    afterEach(() => {
        clientAuth.currentUser = null;
        expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/reset', expect.anything());
    });

    it('an admin with an active season sees "Close 2025" on the Welcome screen', async () => {
        mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin' });

        renderWithProvider();

        expect(await screen.findByRole('button', { name: 'Close 2025' })).toHaveAttribute('title', 'Close the 2025 exchange (read-only)');
        expect(screen.getByText('2025 exchange')).toBeInTheDocument();
    });

    it('an assigned admin sees "Close 2025" in both the sidebar and the mobile header', async () => {
        mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' });

        renderWithProvider();

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: 'Close 2025' })).toHaveLength(2);
        });
        expect(screen.queryByRole('button', { name: /Start/ })).not.toBeInTheDocument();
    });

    it('a non-admin sees no Close or Start button', async () => {
        mockUser({ id: 'user1', email: 'member@example.test', name: 'Member', recipientId: 'someid' }, { authUid: 'user-uid' });

        renderWithProvider();

        await waitFor(() => {
            expect(screen.getAllByTestId('chat-component').length).toBeGreaterThan(0);
        });
        expect(screen.queryByRole('button', { name: /^Close / })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Start / })).not.toBeInTheDocument();
    });

    it('a non-admin on a closed season sees the archive but no Start button', async () => {
        mockUser({ id: 'user1', email: 'member@example.test', name: 'Member', recipientId: 'someid' }, { authUid: 'user-uid', season: CLOSED_2025 });

        renderWithProvider();

        expect(await screen.findByTestId('archive-viewer')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Start / })).not.toBeInTheDocument();
    });

    it('a closed season shows "Start 2026", the banner and the archive, with no chat', async () => {
        mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' }, { season: CLOSED_2025 });

        renderWithProvider();

        expect(await screen.findByRole('button', { name: 'Start 2026' })).toHaveAttribute('title', 'Start the 2026 exchange');
        expect(screen.getByTestId('archive-viewer')).toHaveTextContent(
            'The 2025 exchange is closed. You can browse it below; chats reopen when the next year starts.'
        );
        expect(mockArchiveViewer).toHaveBeenLastCalledWith(expect.objectContaining({
            authUid: 'admin-uid',
            years: [2025],
            initialYear: 2025,
            closedYears: [2025],
        }));
        expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Close / })).not.toBeInTheDocument();
    });

    it('Close with the typed year POSTs /api/admin/year/close and refreshes', async () => {
        window.prompt = jest.fn(() => '2025');
        const refreshUser = mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' });

        renderWithProvider();
        const [closeButton] = await screen.findAllByRole('button', { name: 'Close 2025' });
        fireEvent.click(closeButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/admin/year/close', {
                method: 'POST',
                headers: { Authorization: 'Bearer admin-id-token', 'Content-Type': 'application/json' },
                body: '{"year":2025}',
            });
        });
        await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
        expect(window.prompt).toHaveBeenCalledTimes(1);
    });

    it('Start with the typed year POSTs { fromYear, targetYear }; the prompt lists the 2026 roster', async () => {
        window.prompt = jest.fn(() => '2026');
        const refreshUser = mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' }, { season: CLOSED_2025 });
        const names2026 = getRosterNames(2026);
        const excluded = PARTICIPANTS.find((participant) => !names2026.includes(participant.name));

        renderWithProvider();
        fireEvent.click(await screen.findByRole('button', { name: 'Start 2026' }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/admin/year/start', {
                method: 'POST',
                headers: { Authorization: 'Bearer admin-id-token', 'Content-Type': 'application/json' },
                body: '{"fromYear":2025,"targetYear":2026}',
            });
        });
        await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));

        const promptText = window.prompt.mock.calls[0][0];
        expect(promptText).toContain(`${names2026.length} participants: ${names2026.join(', ')}.`);
        expect(excluded).toBeDefined();
        expect(promptText).not.toContain(excluded.name);
    });

    it.each([
        ['cancelled', null],
        ['wrong', '2024'],
    ])('a %s prompt sends nothing', async (_label, answer) => {
        window.prompt = jest.fn(() => answer);
        const refreshUser = mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin' });

        renderWithProvider();
        fireEvent.click(await screen.findByRole('button', { name: 'Close 2025' }));

        await waitFor(() => expect(window.prompt).toHaveBeenCalledTimes(1));
        expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/year/close', expect.anything());
        expect(refreshUser).not.toHaveBeenCalled();
    });

    it('no Reset control or text exists anywhere', async () => {
        mockUser({ id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' });

        renderWithProvider();

        await screen.findAllByRole('button', { name: 'Close 2025' });
        expect(screen.queryByText(/Reset/)).not.toBeInTheDocument();
        expect(screen.queryByTitle(/Reset/)).not.toBeInTheDocument();
    });

    it('"Browse past years" opens the archive before a recipient is chosen and "Back to current year" returns', async () => {
        mockUser({ id: 'member-2026', email: 'member@example.test', name: 'Member' }, { authUid: 'user-uid', season: ACTIVE_2026 });

        renderWithProvider();
        fireEvent.click(await screen.findByRole('button', { name: 'Browse past years' }));

        expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();
        expect(mockArchiveViewer).toHaveBeenLastCalledWith(expect.objectContaining({
            years: [2025],
            initialYear: 2025,
            closedYears: [2025],
            onBack: expect.any(Function),
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Back to current year' }));
        expect(await screen.findByText('Welcome, Member!')).toBeInTheDocument();
        expect(screen.getByText('2026 exchange')).toBeInTheDocument();
    });

    describe('users-fetch scope', () => {
        let calls;

        function optionValues() {
            return screen.getAllByRole('option').map((option) => option.value).filter((value) => value !== '');
        }

        beforeEach(() => {
            calls = [];
            getDocs.mockImplementation((ref) => {
                const pending = deferred();
                calls.push({ path: ref.path, resolve: pending.resolve });
                return pending.promise;
            });
        });

        it('a late result for an older year never replaces the current year', async () => {
            const names2026 = getRosterNames(2026);
            const me = names2026[0];
            mockUser({ id: 'profile-2025', email: 'member@example.test', name: me }, { authUid: 'uid-a' });
            const { rerender } = render(tree());

            await waitFor(() => expect(calls.map((call) => call.path)).toEqual(['users']));
            expect(optionValues()).toEqual([]);

            mockUser({ id: 'profile-2026', email: 'member@example.test', name: me }, { authUid: 'uid-a', season: ACTIVE_2026 });
            rerender(tree());
            await waitFor(() => expect(calls.map((call) => call.path)).toEqual(['users', 'years/2026/users']));

            await act(async () => {
                calls[1].resolve(usersSnapshot(names2026.map((name, i) => ({ id: `y26-${i}`, name, gifterId: null }))));
            });
            await waitFor(() => expect(optionValues()).toEqual(names2026.slice(1)));

            await act(async () => {
                calls[0].resolve(usersSnapshot(getRosterNames(2025).map((name, i) => ({ id: `y25-${i}`, name, gifterId: 'someone' }))));
            });

            expect(optionValues()).toEqual(names2026.slice(1));
            expect(optionValues().length).toBeGreaterThan(0);
        });

        it('an account switch never shows the previous account candidates', async () => {
            const names = getRosterNames(2025);
            const onlyOpen = names[2];
            mockUser({ id: 'profile-a', email: 'a@example.test', name: names[0] }, { authUid: 'uid-a' });
            const { rerender } = render(tree());

            await waitFor(() => expect(calls).toHaveLength(1));
            await act(async () => {
                calls[0].resolve(usersSnapshot(names.map((name, i) => ({
                    id: `a-${i}`,
                    name,
                    gifterId: name === onlyOpen ? null : 'taken',
                }))));
            });
            await waitFor(() => expect(optionValues()).toEqual([onlyOpen]));

            mockUser({ id: 'profile-b', email: 'b@example.test', name: names[1] }, { authUid: 'uid-b' });
            rerender(tree());

            await waitFor(() => expect(calls).toHaveLength(2));
            expect(screen.getAllByRole('option')).toHaveLength(1);
            expect(optionValues()).toEqual([]);

            await act(async () => {
                calls[1].resolve(usersSnapshot(names.map((name, i) => ({ id: `b-${i}`, name, gifterId: null }))));
            });
            await waitFor(() => expect(optionValues()).toEqual(names.filter((name) => name !== names[1])));
        });
    });
});
