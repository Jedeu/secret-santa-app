/**
 * @jest-environment jsdom
 *
 * Home (src/app/page.js): the one-time recipient reveal for automatic-draw profiles.
 * - gating: pending/invalid automatic profiles see the reveal card, never the manual
 *   selector or the chats; manual profiles keep the selector; closed years show the archive
 * - the recipient name comes only from the current scope's users result
 * - "Browse past years" applies only to the scope in which it was pressed
 *
 * Mocking follows admin_ui.test.js. Synthetic fixtures only (example.test, Alpha, Bravo…).
 */

import Home from '@/app/page';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { collection, getDocs } from 'firebase/firestore';
import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';
import { useUser } from '@/hooks/useUser';

const mockArchiveViewer = jest.fn();

jest.mock('@/hooks/useUser', () => ({
    useUser: jest.fn()
}));

jest.mock('@/components/Chat', () => {
    const MockChat = () => <div data-testid="chat-component">Chat</div>;
    MockChat.displayName = 'MockChat';
    return MockChat;
});

jest.mock('@/components/PublicFeed', () => {
    const MockPublicFeed = () => <div data-testid="feed-component">Feed</div>;
    MockPublicFeed.displayName = 'MockPublicFeed';
    return MockPublicFeed;
});

jest.mock('@/components/ArchiveViewer', () => {
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

jest.mock('@/hooks/useRealtimeMessages', () => ({
    useRealtimeAllMessages: jest.fn(() => []),
    useRealtimeAllMessagesLoading: jest.fn(() => false),
    useRealtimeAllReactions: jest.fn(() => []),
    useRealtimeUnreadCounts: jest.fn(() => ({ recipientUnread: 0, santaUnread: 0 }))
}));

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

jest.mock('@/lib/sign-out', () => ({
    signOutCurrentUser: jest.fn(() => Promise.resolve())
}));

// Synthetic admin and rosters (no real participant data).
jest.mock('@/lib/config', () => ({
    ADMIN_EMAILS: ['admin@example.test'],
    isAdmin: (email) => typeof email === 'string' && email.toLowerCase() === 'admin@example.test',
}));

jest.mock('@/lib/participants', () => {
    const person = (name) => ({ name, email: `${name.toLowerCase()}@example.test` });
    const rosters = {
        2025: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(person),
        2026: ['Alpha', 'Bravo', 'Charlie'].map(person),
        2027: ['Alpha', 'Bravo', 'Echo'].map(person),
    };
    const years = () => Object.keys(rosters).map(Number).sort((a, b) => a - b);
    const getRoster = (year) => rosters[year] || null;
    const getRosterName = (year, email) => {
        const found = (getRoster(year) || []).find((p) => p.email === String(email).toLowerCase());
        return found ? found.name : null;
    };
    return {
        PARTICIPANTS: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map(person),
        getRoster,
        getRosterName,
        getRosterNames: (year) => (getRoster(year) || []).map((p) => p.name),
        getRosterEmail: (year, name) => {
            const found = (getRoster(year) || []).find((p) => p.name.toLowerCase() === String(name).toLowerCase());
            return found ? found.email : null;
        },
        isKnownParticipantEmail: (email) => years().some((year) => getRosterName(year, email) !== null),
        getNextRosterYear: (year) => years().find((configured) => configured > year) ?? null,
    };
});

const SEASON_2026 = { year: 2026, state: 'active', epoch: 2, closedYears: [2025] };
const CLOSED_2026 = { year: 2026, state: 'closed', epoch: 2, closedYears: [2025, 2026] };
const SEASON_2027 = { year: 2027, state: 'active', epoch: 3, closedYears: [2025, 2026] };

const LOADING_TEXT = "Finding out who you're buying a gift for…";
const ERROR_TEXT = "We couldn't load your recipient's name. Check your connection and try again.";
const INVALID_TEXT_2026 = "Your 2026 recipient isn't available. Ask the admin for help.";

function autoProfile(id, name, recipientId, gifterId, extra = {}) {
    return {
        id,
        name,
        email: `${name.toLowerCase()}@example.test`,
        oauthId: null,
        image: null,
        recipientId,
        gifterId,
        drawMode: 'auto',
        revealAckRecipientId: null,
        revealAckAt: null,
        ...extra,
    };
}

function manualProfile(id, name, extra = {}) {
    return {
        id,
        name,
        email: `${name.toLowerCase()}@example.test`,
        oauthId: null,
        image: null,
        recipientId: null,
        gifterId: null,
        ...extra,
    };
}

const ALPHA_26 = autoProfile('alpha-2026', 'Alpha', 'bravo-2026', 'charlie-2026');
const BRAVO_26 = autoProfile('bravo-2026', 'Bravo', 'charlie-2026', 'alpha-2026');
const CHARLIE_26 = autoProfile('charlie-2026', 'Charlie', 'alpha-2026', 'bravo-2026');
const ROWS_2026 = [ALPHA_26, BRAVO_26, CHARLIE_26];

const ALPHA_27 = autoProfile('alpha-2027', 'Alpha', 'echo-2027', 'bravo-2027');
const BRAVO_27 = autoProfile('bravo-2027', 'Bravo', 'alpha-2027', 'echo-2027');
const ECHO_27 = autoProfile('echo-2027', 'Echo', 'bravo-2027', 'alpha-2027');
const ROWS_2027 = [ALPHA_27, BRAVO_27, ECHO_27];

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function usersSnapshot(rows) {
    return { docs: rows.map((row) => ({ id: row.id, data: () => row })) };
}

function rowsFor(path) {
    if (path === 'years/2027/users') return ROWS_2027;
    if (path === 'years/2026/users') return ROWS_2026;
    return [];
}

function usersFetches(path) {
    return getDocs.mock.calls.filter(([ref]) => ref?.path === path).length;
}

function mockUser(user, {
    season = SEASON_2026,
    authUid = 'uid-alpha',
    refreshUser = jest.fn(),
    acknowledgeReveal = jest.fn(() => Promise.resolve({ status: 'acknowledged' })),
} = {}) {
    useUser.mockReturnValue({
        user,
        authUid,
        authEmail: user?.email ?? null,
        season,
        loading: false,
        error: null,
        refreshUser,
        acknowledgeReveal,
    });
    return { refreshUser, acknowledgeReveal };
}

const tree = () => (
    <RealtimeMessagesProvider>
        <Home />
    </RealtimeMessagesProvider>
);

describe('Home: one-time recipient reveal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.prompt = jest.fn(() => null);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
        collection.mockReset();
        collection.mockImplementation((db, ...segments) => ({ path: segments.join('/') }));
        getDocs.mockReset();
        getDocs.mockImplementation((ref) => Promise.resolve(usersSnapshot(rowsFor(ref?.path))));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('reveal gating', () => {
        it('a pending profile with users loaded shows the name of the recipient row; no selector and no chat', async () => {
            mockUser(ALPHA_26);

            render(tree());

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
            expect(screen.getByTestId('recipient-reveal')).toBeInTheDocument();
            expect(screen.getByText('Welcome, Alpha!')).toBeInTheDocument();
            expect(screen.getByText('Your 2026 Secret Santa recipient is')).toBeInTheDocument();
            expect(screen.queryByText('Charlie')).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
            expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument();
            expect(usersFetches('years/2026/users')).toBe(1);
        });

        it('Continue calls the mocked acknowledgeReveal once and nothing else', async () => {
            const { acknowledgeReveal, refreshUser } = mockUser(ALPHA_26);

            render(tree());
            fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

            await waitFor(() => expect(acknowledgeReveal).toHaveBeenCalledTimes(1));
            expect(acknowledgeReveal).toHaveBeenCalledWith();
            await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
            expect(acknowledgeReveal).toHaveBeenCalledTimes(1);
            expect(refreshUser).not.toHaveBeenCalled();
            expect(global.fetch).not.toHaveBeenCalledWith('/api/reveal/acknowledge', expect.anything());
            // Nothing is dismissed locally: the page follows the context state.
            expect(screen.getByTestId('recipient-reveal')).toBeInTheDocument();
        });

        it('re-rendering with the acknowledged profile shows the chats and no reveal', async () => {
            mockUser(ALPHA_26);
            const { rerender } = render(tree());
            await screen.findByTestId('recipient-reveal-name');

            mockUser({ ...ALPHA_26, revealAckRecipientId: 'bravo-2026', revealAckAt: '2026-11-11T00:00:00.000Z' });
            rerender(tree());

            await waitFor(() => expect(screen.getAllByTestId('chat-component').length).toBeGreaterThan(0));
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });

        it.each([
            ['an automatic profile with a null recipient', { ...ALPHA_26, recipientId: null }],
            ['an unknown drawMode value', { ...ALPHA_26, drawMode: 'other' }],
        ])('%s shows the unavailable card; Try again calls refreshUser', async (_label, user) => {
            const { refreshUser, acknowledgeReveal } = mockUser(user);

            render(tree());

            expect(await screen.findByText(INVALID_TEXT_2026)).toBeInTheDocument();
            expect(screen.getByTestId('recipient-reveal')).toBeInTheDocument();
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
            expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

            expect(refreshUser).toHaveBeenCalledTimes(1);
            expect(acknowledgeReveal).not.toHaveBeenCalled();
        });

        it('a closed season with a pending profile shows the archive and no reveal', async () => {
            mockUser(ALPHA_26, { season: CLOSED_2026 });

            render(tree());

            expect(await screen.findByTestId('archive-viewer')).toHaveTextContent(/The 2026 exchange is closed\./);
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });

        it('legacy: a manual profile without a recipient keeps the Welcome selector; with a recipient, the chats', async () => {
            const manual = manualProfile('alpha-2026', 'Alpha');
            mockUser(manual);
            const { rerender } = render(tree());

            expect(await screen.findByRole('combobox')).toBeInTheDocument();
            expect(screen.getByText('Welcome, Alpha!')).toBeInTheDocument();
            expect(screen.getByText('Who are you buying a gift for?')).toBeInTheDocument();
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();

            mockUser({ ...manual, recipientId: 'bravo-2026', gifterId: 'charlie-2026' });
            rerender(tree());

            await waitFor(() => expect(screen.getAllByTestId('chat-component').length).toBeGreaterThan(0));
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });
    });

    describe('recipient name', () => {
        let calls;

        beforeEach(() => {
            calls = [];
            getDocs.mockImplementation((ref) => {
                const pending = deferred();
                calls.push({ path: ref?.path, resolve: pending.resolve, reject: pending.reject });
                return pending.promise;
            });
        });

        it('while the users fetch is pending: the loading text and no Continue; then the name', async () => {
            mockUser(ALPHA_26);

            render(tree());

            expect(await screen.findByText(LOADING_TEXT)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
            expect(screen.queryByTestId('recipient-reveal-name')).not.toBeInTheDocument();

            await waitFor(() => expect(calls).toHaveLength(1));
            await act(async () => {
                calls[0].resolve(usersSnapshot(ROWS_2026));
            });

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
            expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
        });

        it('a rejected users fetch shows the error; Try again fetches again, then the name appears', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const { acknowledgeReveal, refreshUser } = mockUser(ALPHA_26);

            render(tree());
            await waitFor(() => expect(calls).toHaveLength(1));
            await act(async () => {
                calls[0].reject(new Error('offline'));
            });

            expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

            expect(await screen.findByText(LOADING_TEXT)).toBeInTheDocument();
            await waitFor(() => expect(calls).toHaveLength(2));
            expect(calls[1].path).toBe('years/2026/users');
            expect(refreshUser).not.toHaveBeenCalled();

            await act(async () => {
                calls[1].resolve(usersSnapshot(ROWS_2026));
            });

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
            expect(acknowledgeReveal).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it('a loaded list without the recipient id shows the error and no other participant name', async () => {
            mockUser(ALPHA_26);

            render(tree());
            await waitFor(() => expect(calls).toHaveLength(1));
            await act(async () => {
                calls[0].resolve(usersSnapshot([ALPHA_26, CHARLIE_26]));
            });

            expect(await screen.findByText(ERROR_TEXT)).toBeInTheDocument();
            expect(screen.queryByText('Charlie')).not.toBeInTheDocument();
            expect(screen.queryByTestId('recipient-reveal-name')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
        });

        it('a late users result for an older year never supplies the name', async () => {
            mockUser(ALPHA_26);
            const { rerender } = render(tree());
            await waitFor(() => expect(calls.map((call) => call.path)).toEqual(['years/2026/users']));

            mockUser(ALPHA_27, { season: SEASON_2027 });
            rerender(tree());
            await waitFor(() => expect(calls.map((call) => call.path)).toEqual(['years/2026/users', 'years/2027/users']));

            // The old result even carries a row with the new recipient id.
            await act(async () => {
                calls[0].resolve(usersSnapshot([{ id: 'echo-2027', name: 'Stale Name' }]));
            });

            expect(screen.queryByText('Stale Name')).not.toBeInTheDocument();
            expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();

            await act(async () => {
                calls[1].resolve(usersSnapshot(ROWS_2027));
            });

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Echo');
            expect(screen.queryByText('Stale Name')).not.toBeInTheDocument();
        });

        it('a late users result for another account never supplies the name', async () => {
            mockUser(ALPHA_26, { authUid: 'uid-alpha' });
            const { rerender } = render(tree());
            await waitFor(() => expect(calls).toHaveLength(1));

            mockUser(BRAVO_26, { authUid: 'uid-bravo' });
            rerender(tree());
            await waitFor(() => expect(calls).toHaveLength(2));

            await act(async () => {
                calls[0].resolve(usersSnapshot([{ id: 'charlie-2026', name: 'Stale Name' }]));
            });

            expect(screen.queryByText('Stale Name')).not.toBeInTheDocument();
            expect(screen.getByText('Welcome, Bravo!')).toBeInTheDocument();
            expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();

            await act(async () => {
                calls[1].resolve(usersSnapshot(ROWS_2026));
            });

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Charlie');
        });

        it('with fake timers: a fetch still pending at 10 000 ms shows the error; its later success shows the name', async () => {
            jest.useFakeTimers();
            mockUser(ALPHA_26);

            render(tree());
            await act(async () => {});
            expect(calls).toHaveLength(1);
            expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();

            await act(async () => { jest.advanceTimersByTime(9999); });
            expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
            expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();

            await act(async () => { jest.advanceTimersByTime(1); });
            expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

            await act(async () => {
                calls[0].resolve(usersSnapshot(ROWS_2026));
            });

            expect(screen.getByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
            expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
        });
    });

    describe('archive browsing scope', () => {
        it('an admin on the reveal sees Close 2026; Browse opens the archive and Back returns to the pending reveal', async () => {
            const admin = autoProfile('admin-2026', 'Admin', 'bravo-2026', 'charlie-2026');
            const { acknowledgeReveal } = mockUser(admin, { authUid: 'uid-admin' });

            render(tree());

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
            expect(screen.getByRole('button', { name: 'Close 2026' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));

            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();
            expect(mockArchiveViewer).toHaveBeenLastCalledWith(expect.objectContaining({
                years: [2025],
                initialYear: 2025,
                closedYears: [2025],
                onBack: expect.any(Function),
            }));

            fireEvent.click(screen.getByRole('button', { name: 'Back to current year' }));

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Bravo');
            expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
            expect(acknowledgeReveal).not.toHaveBeenCalled();
        });

        it('same scope: after Browse, a re-render with the same account, profile, year and epoch keeps the archive', async () => {
            mockUser(ALPHA_26);
            const { rerender } = render(tree());
            await screen.findByTestId('recipient-reveal-name');

            fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));
            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();

            // A new user object for the same scope refetches users and stores a new result.
            mockUser({ ...ALPHA_26 });
            rerender(tree());
            await waitFor(() => expect(usersFetches('years/2026/users')).toBe(2));
            await act(async () => {});

            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();
        });

        it('rollover: Browse in 2026, then closed 2026, then active 2027 with a new pending profile shows the reveal', async () => {
            mockUser(ALPHA_26);
            const { rerender } = render(tree());
            await screen.findByTestId('recipient-reveal-name');

            fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));
            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();

            mockUser(ALPHA_26, { season: CLOSED_2026 });
            rerender(tree());
            expect(await screen.findByText(/The 2026 exchange is closed\./)).toBeInTheDocument();

            mockUser(ALPHA_27, { season: SEASON_2027 });
            rerender(tree());

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Echo');
            expect(screen.queryByTestId('archive-viewer')).not.toBeInTheDocument();
        });

        it("account switch: account A browses in 2026; account B's pending reveal is shown", async () => {
            mockUser(ALPHA_26, { authUid: 'uid-alpha' });
            const { rerender } = render(tree());
            await screen.findByTestId('recipient-reveal-name');

            fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));
            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();

            mockUser(BRAVO_26, { authUid: 'uid-bravo' });
            rerender(tree());

            expect(await screen.findByTestId('recipient-reveal-name')).toHaveTextContent('Charlie');
            expect(screen.getByText('Welcome, Bravo!')).toBeInTheDocument();
            expect(screen.queryByTestId('archive-viewer')).not.toBeInTheDocument();
        });

        it('rollover with a manual unassigned profile shows the selector, not the archive', async () => {
            mockUser(manualProfile('alpha-2026', 'Alpha'));
            const { rerender } = render(tree());
            await screen.findByRole('combobox');

            fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));
            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();

            mockUser(manualProfile('alpha-2026', 'Alpha'), { season: CLOSED_2026 });
            rerender(tree());
            expect(await screen.findByText(/The 2026 exchange is closed\./)).toBeInTheDocument();

            mockUser(manualProfile('alpha-2027', 'Alpha'), { season: SEASON_2027 });
            rerender(tree());

            expect(await screen.findByRole('combobox')).toBeInTheDocument();
            expect(screen.getByText('Welcome, Alpha!')).toBeInTheDocument();
            expect(screen.getByText('2027 exchange')).toBeInTheDocument();
            expect(screen.queryByTestId('archive-viewer')).not.toBeInTheDocument();
            expect(screen.queryByTestId('recipient-reveal')).not.toBeInTheDocument();
        });

        it('account switch with manual unassigned profiles shows the selector, not the archive', async () => {
            mockUser(manualProfile('alpha-2026', 'Alpha'), { authUid: 'uid-alpha' });
            const { rerender } = render(tree());
            await screen.findByRole('combobox');

            fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));
            expect(screen.getByTestId('archive-viewer')).toBeInTheDocument();

            mockUser(manualProfile('bravo-2026', 'Bravo'), { authUid: 'uid-bravo' });
            rerender(tree());

            expect(await screen.findByRole('combobox')).toBeInTheDocument();
            expect(screen.getByText('Welcome, Bravo!')).toBeInTheDocument();
            expect(screen.queryByTestId('archive-viewer')).not.toBeInTheDocument();
        });
    });
});
