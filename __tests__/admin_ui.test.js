/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useUser } from '@/hooks/useUser';

// Mock useUser hook
jest.mock('@/hooks/useUser');

// Mock firebase-client to prevent initialization issues
jest.mock('@/lib/firebase-client', () => ({
    firestore: null,
    clientAuth: null
}));

// Now import the component after mocks are set up
import Home from '@/app/page';

// Mock child components to simplify testing
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

describe('Admin UI Visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default fetch mock for users list
        fetch.mockResolvedValue({
            json: async () => [],
            ok: true
        });
    });

    it('shows reset button for admin user (jed.piezas@gmail.com)', async () => {
        useUser.mockReturnValue({
            user: {
                name: 'Jed',
                email: 'jed.piezas@gmail.com',
                recipientId: null // Ensure we are in the "waiting" state where button is visible
            },
            loading: false,
            error: null
        });

        render(<Home />);

        await waitFor(() => {
            expect(screen.getByText('Reset App (Admin)')).toBeInTheDocument();
        });
    });

    it('does NOT show reset button for non-admin user', async () => {
        useUser.mockReturnValue({
            user: {
                name: 'Chinh',
                email: 'chinh@example.com',
                recipientId: null
            },
            loading: false,
            error: null
        });

        render(<Home />);

        await waitFor(() => {
            expect(screen.queryByText('Reset App (Admin)')).not.toBeInTheDocument();
        });
    });

    it('does NOT show reset button if user has a recipient (even if admin)', async () => {
        useUser.mockReturnValue({
            user: {
                name: 'Jed',
                email: 'jed.piezas@gmail.com',
                recipientId: 'some-id'
            },
            loading: false,
            error: null
        });

        render(<Home />);

        await waitFor(() => {
            expect(screen.queryByText('Reset App (Admin)')).not.toBeInTheDocument();
        });
    });
});
