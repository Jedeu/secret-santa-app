/**
 * @jest-environment jsdom
 */

import Home from '../../src/app/page';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RealtimeMessagesProvider } from '../../src/context/RealtimeMessagesContext';
import { useUser } from '../../src/hooks/useUser';
import { clientAuth } from '../../src/lib/firebase-client';
import { ADMIN_EMAILS } from '../../src/lib/config';

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
    getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
    addDoc: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    onSnapshot: jest.fn(() => jest.fn()),
    serverTimestamp: jest.fn()
}));

const ADMIN_EMAIL = ADMIN_EMAILS[0];

describe('Admin UI', () => {
    const renderWithProvider = (ui) => render(
        <RealtimeMessagesProvider>
            {ui}
        </RealtimeMessagesProvider>
    );

    beforeEach(() => {
        jest.clearAllMocks();
        global.confirm = jest.fn(() => true);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
        clientAuth.currentUser = { uid: 'admin-uid', getIdToken: jest.fn().mockResolvedValue('admin-id-token') };
    });

    afterEach(() => {
        clientAuth.currentUser = null;
    });

    it('shows the welcome-screen reset button for an admin without a recipient', async () => {
        useUser.mockReturnValue({
            user: { id: 'admin1', email: ADMIN_EMAIL, name: 'Admin' },
            authUid: 'admin-uid',
            loading: false,
            refreshUser: jest.fn()
        });

        renderWithProvider(<Home />);

        await waitFor(() => {
            expect(screen.getByText('Reset App (Admin)')).toBeInTheDocument();
        });
    });

    it('does NOT show reset controls for a non-admin user', async () => {
        useUser.mockReturnValue({
            user: { id: 'user1', email: 'member@example.test', name: 'Member', recipientId: 'someid' },
            authUid: 'user-uid',
            loading: false,
            refreshUser: jest.fn()
        });

        renderWithProvider(<Home />);

        await waitFor(() => {
            expect(screen.queryByText('Reset App (Admin)')).not.toBeInTheDocument();
        });
        expect(screen.queryByTitle('Reset App Data')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Reset all data and assignments')).not.toBeInTheDocument();
    });

    it('an admin with a recipient sees the compact Reset button and the sidebar reset (no shuffle)', async () => {
        useUser.mockReturnValue({
            user: { id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' },
            authUid: 'admin-uid',
            loading: false,
            refreshUser: jest.fn()
        });

        renderWithProvider(<Home />);

        expect(await screen.findByTitle('Reset all data and assignments')).toHaveTextContent('Reset');
        expect(screen.getByTitle('Reset App Data')).toBeInTheDocument();
        expect(screen.queryByText('Reset App (Admin)')).not.toBeInTheDocument();
        expect(screen.queryByText('Start Exchange (Admin)')).not.toBeInTheDocument();
    });

    it('clicking the sidebar "Reset App Data" (confirm accepted) POSTs /api/admin/reset and refreshes', async () => {
        const refreshUser = jest.fn();
        useUser.mockReturnValue({
            user: { id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' },
            authUid: 'admin-uid',
            loading: false,
            refreshUser
        });

        renderWithProvider(<Home />);
        fireEvent.click(await screen.findByTitle('Reset App Data'));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/admin/reset', {
                method: 'POST',
                headers: { Authorization: 'Bearer admin-id-token' }
            });
        });
        await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
        expect(global.confirm).toHaveBeenCalledTimes(1);
    });

    it('a declined confirm sends nothing', async () => {
        global.confirm = jest.fn(() => false);
        useUser.mockReturnValue({
            user: { id: 'admin1', email: ADMIN_EMAIL, name: 'Admin', recipientId: 'someid' },
            authUid: 'admin-uid',
            loading: false,
            refreshUser: jest.fn()
        });

        renderWithProvider(<Home />);
        fireEvent.click(await screen.findByTitle('Reset App Data'));

        expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/reset', expect.anything());
    });
});
