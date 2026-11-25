/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '@/components/Sidebar';
import TabNavigation from '@/components/TabNavigation';
import UserMenuBar from '@/components/UserMenuBar';

describe('Sidebar Component', () => {
    const mockOnTabChange = jest.fn();
    const mockOnSignOut = jest.fn();

    // The sidebar's header is the same one-line user bar the phone layout uses.
    const userBar = (adminControl = null) => (
        <UserMenuBar
            name="Test User"
            soundEnabled
            onToggleSound={jest.fn()}
            pushControl={<span>Push notifications</span>}
            pushOn={false}
            adminControl={adminControl}
            onSignOut={mockOnSignOut}
        />
    );

    const defaultProps = {
        activeTab: 'recipient',
        onTabChange: mockOnTabChange,
        unreadCounts: { recipient: 0, santa: 0 },
        header: userBar()
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // 1. Renders user info correctly
    test('renders the user bar greeting in its header', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.getByTestId('user-greeting')).toHaveTextContent('Hi Test User');
    });

    test("labels the Recipient item with the recipient's name when known", () => {
        render(<Sidebar {...defaultProps} recipientLabel="Blake" />);
        // Visible label is the name; the accessible name keeps "Recipient" for screen readers.
        const item = screen.getByRole('button', { name: /recipient: blake/i });
        expect(item).toBeInTheDocument();
        expect(item).toHaveAttribute('aria-current', 'page');
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
    test('renders a supplied adminControl node on the user bar', () => {
        render(<Sidebar {...defaultProps} header={userBar(<button type="button">Close 2025</button>)} />);
        expect(screen.getByRole('button', { name: 'Close 2025' })).toBeInTheDocument();
    });

    test('renders nothing admin-related without an adminControl', () => {
        render(<Sidebar {...defaultProps} />);
        expect(screen.queryByRole('button', { name: /close|start|reset/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/Reset/)).not.toBeInTheDocument();
    });

    // 7. Past years open from the user menu, never from a sidebar item
    test('has no Archives item; nothing is selected while the archive is shown', () => {
        render(<Sidebar {...defaultProps} showArchive activeTab="archive" />);
        expect(screen.queryByRole('button', { name: /archives?/i })).not.toBeInTheDocument();
        ['Santa', 'Public Feed'].forEach((name) => {
            expect(screen.getByRole('button', { name: new RegExp(name) })).toHaveStyle({ fontWeight: '400' });
        });
    });

    // 8. Sign Out lives in the user bar's menu
    test('calls onSignOut from the user bar menu', () => {
        render(<Sidebar {...defaultProps} />);
        fireEvent.click(screen.getByTestId('user-greeting'));
        const signOutButton = screen.getByRole('menuitem', { name: /sign out/i });
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

    test('tab navigation has only Recipient, Santa and Public Feed, even with past years', () => {
        render(<TabNavigation activeTab="archive" onTabChange={jest.fn()} unreadCounts={{}} showArchive />);
        expect(screen.getAllByRole('button')).toHaveLength(3);
        expect(screen.queryByRole('button', { name: /archives?/i })).not.toBeInTheDocument();
    });
});
