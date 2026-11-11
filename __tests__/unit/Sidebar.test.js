/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '@/components/Sidebar';
import TabNavigation from '@/components/TabNavigation';

describe('Sidebar Component', () => {
    const mockCurrentUser = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
    const mockOnTabChange = jest.fn();
    const mockOnSignOut = jest.fn();

    const defaultProps = {
        currentUser: mockCurrentUser,
        activeTab: 'recipient',
        onTabChange: mockOnTabChange,
        unreadCounts: { recipient: 0, santa: 0 },
        onSignOut: mockOnSignOut
    };

    beforeEach(() => {
        jest.clearAllMocks();
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
        expect(screen.getByLabelText('Recipient: 3 unread messages')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByLabelText('Santa: 5 unread messages')).toHaveAttribute('aria-live', 'polite');
    });

    test('hides unread counts when 0', () => {
        render(<Sidebar {...defaultProps} unreadCounts={{ recipient: 0, santa: 0 }} />);
        // No badge elements should be present
        const badges = screen.queryAllByTestId('sidebar-unread-badge');
        expect(badges).toHaveLength(0);
    });

    // 6. Admin season control
    test('renders a supplied adminControl node', () => {
        render(<Sidebar {...defaultProps} adminControl={<button type="button">Close 2025</button>} />);
        expect(screen.getByRole('button', { name: 'Close 2025' })).toBeInTheDocument();
    });

    test('renders nothing admin-related without an adminControl', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.queryByRole('button', { name: /close|start|reset/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/Reset/)).not.toBeInTheDocument();
    });

    // 7. Archives item
    test('has no Archives item when showArchive is false', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.queryByRole('button', { name: /archives/i })).not.toBeInTheDocument();
    });

    test('with showArchive, the Archives item calls onTabChange("archive") and shows active styling', () => {
        const { rerender } = render(<Sidebar {...defaultProps} showArchive />);
        const archives = screen.getByRole('button', { name: /📚\s*Archives/ });
        expect(archives).toHaveStyle({ fontWeight: '400' });

        fireEvent.click(archives);
        expect(mockOnTabChange).toHaveBeenCalledWith('archive');

        rerender(<Sidebar {...defaultProps} showArchive activeTab="archive" />);
        expect(screen.getByRole('button', { name: /archives/i })).toHaveStyle({ fontWeight: '600' });
    });

    // 8. Sign Out
    test('calls onSignOut when clicked', () => {
        render(<Sidebar {...defaultProps} />);
        const signOutButton = screen.getByRole('button', { name: /sign out/i });
        fireEvent.click(signOutButton);
        expect(mockOnSignOut).toHaveBeenCalled();
    });

    test('tab navigation unread badges announce updates with aria-live', () => {
        render(
            <TabNavigation
                activeTab="recipient"
                onTabChange={jest.fn()}
                unreadCounts={{ recipient: 2, santa: 1 }}
            />
        );

        expect(screen.getByLabelText('Recipient: 2 unread messages')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByLabelText('Santa: 1 unread messages')).toHaveAttribute('aria-live', 'polite');
    });

    test('tab navigation has no Archives tab when showArchive is false', () => {
        render(<TabNavigation activeTab="recipient" onTabChange={jest.fn()} unreadCounts={{}} />);
        expect(screen.queryByRole('button', { name: /archives/i })).not.toBeInTheDocument();
    });

    test('tab navigation Archives tab calls onTabChange("archive")', () => {
        const onTabChange = jest.fn();
        render(<TabNavigation activeTab="recipient" onTabChange={onTabChange} unreadCounts={{}} showArchive />);

        fireEvent.click(screen.getByRole('button', { name: '📚 Archives' }));

        expect(onTabChange).toHaveBeenCalledWith('archive');
    });
});
