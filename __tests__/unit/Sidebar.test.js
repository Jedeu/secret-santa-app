/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '@/components/Sidebar';
import * as config from '@/lib/config';

// Mock the isAdmin function
jest.mock('@/lib/config', () => ({
    ...jest.requireActual('@/lib/config'),
    isAdmin: jest.fn()
}));

describe('Sidebar Component', () => {
    const mockCurrentUser = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
    const mockOnTabChange = jest.fn();
    const mockOnSignOut = jest.fn();
    const mockOnReset = jest.fn();

    const defaultProps = {
        currentUser: mockCurrentUser,
        activeTab: 'recipient',
        onTabChange: mockOnTabChange,
        unreadCounts: { recipient: 0, santa: 0 },
        onSignOut: mockOnSignOut,
        onReset: mockOnReset
    };

    beforeEach(() => {
        jest.clearAllMocks();
        config.isAdmin.mockReturnValue(false);
    });

    // 1. Renders user info correctly
    test('renders user name and greeting', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.getByText('Hi, Test User 👋')).toBeInTheDocument();
    });

    // 2. Navigation items
    test('renders all navigation items', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.getByRole('button', { name: /recipient/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /santa/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /public feed/i })).toBeInTheDocument();
    });

    // 3. Active tab styling
    test('applies formatting to active tab', () => {
        render(<Sidebar {...defaultProps} activeTab="recipient" />);
        const recipientButton = screen.getByRole('button', { name: /recipient/i });
        // Active tab should have fontWeight 600
        expect(recipientButton).toHaveStyle({ fontWeight: '600' });
    });

    // 4. Interaction
    test('calls onTabChange when item clicked', () => {
        render(<Sidebar {...defaultProps} />);
        const santaButton = screen.getByRole('button', { name: /santa/i });
        fireEvent.click(santaButton);
        expect(mockOnTabChange).toHaveBeenCalledWith('santa');
    });

    // 5. Unread Badges
    test('displays unread counts when > 0', () => {
        render(<Sidebar {...defaultProps} unreadCounts={{ recipient: 3, santa: 5 }} />);
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    test('hides unread counts when 0', () => {
        render(<Sidebar {...defaultProps} unreadCounts={{ recipient: 0, santa: 0 }} />);
        // No badge elements should be present
        const badges = screen.queryAllByTestId('sidebar-unread-badge');
        expect(badges).toHaveLength(0);
    });

    // 6. Admin Panel (Reset Button)
    test('shows Reset button for admin users', () => {
        config.isAdmin.mockReturnValue(true);
        render(<Sidebar {...defaultProps} />);
        expect(screen.getByTitle('Reset App Data')).toBeInTheDocument();
    });

    test('hides Reset button for non-admin users', () => {
        config.isAdmin.mockReturnValue(false);
        render(<Sidebar {...defaultProps} />);
        expect(screen.queryByTitle('Reset App Data')).not.toBeInTheDocument();
    });

    // 7. Sign Out
    test('calls onSignOut when clicked', () => {
        render(<Sidebar {...defaultProps} />);
        const signOutButton = screen.getByRole('button', { name: /sign out/i });
        fireEvent.click(signOutButton);
        expect(mockOnSignOut).toHaveBeenCalled();
    });
});
