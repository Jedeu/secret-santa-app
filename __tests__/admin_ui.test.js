/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import Home from '@/app/page';
import { useSession, getProviders } from 'next-auth/react';

// Mock next-auth
jest.mock('next-auth/react');

// Mock child components to simplify testing
jest.mock('@/components/Chat', () => () => <div data-testid="chat-component">Chat</div>);
jest.mock('@/components/PublicFeed', () => () => <div data-testid="feed-component">Feed</div>);

// Mock fetch
global.fetch = jest.fn();

describe('Admin UI Visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default fetch mock for users list
        fetch.mockResolvedValue({
            json: async () => [],
            ok: true
        });

        // Mock getProviders
        getProviders.mockResolvedValue({
            google: { id: 'google', name: 'Google' },
            credentials: { id: 'credentials', name: 'Credentials' }
        });
    });

    it('shows reset button for admin user (jed.piezas@gmail.com)', async () => {
        useSession.mockReturnValue({
            data: {
                user: {
                    name: 'Jed',
                    email: 'jed.piezas@gmail.com',
                    recipientId: null // Ensure we are in the "waiting" state where button is visible
                }
            },
            status: 'authenticated'
        });

        render(<Home />);

        await waitFor(() => {
            expect(screen.getByText('Reset App (Admin)')).toBeInTheDocument();
        });
    });

    it('does NOT show reset button for non-admin user', async () => {
        useSession.mockReturnValue({
            data: {
                user: {
                    name: 'Chinh',
                    email: 'chinh@example.com',
                    recipientId: null
                }
            },
            status: 'authenticated'
        });

        render(<Home />);

        await waitFor(() => {
            expect(screen.queryByText('Reset App (Admin)')).not.toBeInTheDocument();
        });
    });

    it('does NOT show reset button if user has a recipient (even if admin)', async () => {
        useSession.mockReturnValue({
            data: {
                user: {
                    name: 'Jed',
                    email: 'jed.piezas@gmail.com',
                    recipientId: 'some-id'
                }
            },
            status: 'authenticated'
        });

        render(<Home />);

        await waitFor(() => {
            expect(screen.queryByText('Reset App (Admin)')).not.toBeInTheDocument();
        });
    });
});
