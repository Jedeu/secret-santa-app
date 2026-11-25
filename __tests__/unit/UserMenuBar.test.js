/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import UserMenuBar from '@/components/UserMenuBar';

function renderBar(props = {}) {
    const onSignOut = jest.fn();
    render(
        <UserMenuBar
            name="Avery"
            soundEnabled
            onToggleSound={jest.fn()}
            pushControl={<span>Push notifications</span>}
            pushOn
            onSignOut={onSignOut}
            {...props}
        />
    );
    fireEvent.click(screen.getByTestId('user-greeting'));
    return { onSignOut };
}

describe('UserMenuBar: Archive', () => {
    test('without past years there is no Archive item', () => {
        renderBar();
        expect(screen.queryByRole('menuitem', { name: /archive/i })).not.toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
    });

    test('Archive sits above Sign out, opens the past years and closes the menu', () => {
        const onOpenArchive = jest.fn();
        renderBar({ onOpenArchive });

        const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
        expect(items).toEqual(['ArchivePast years', 'Sign out']);

        fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }));
        expect(onOpenArchive).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('menu', { hidden: true })).not.toBeVisible();
    });

    test('marks Archive as the current view while it is shown', () => {
        renderBar({ onOpenArchive: jest.fn(), archiveActive: true });
        expect(screen.getByRole('menuitem', { name: /archive/i })).toHaveAttribute('aria-current', 'page');
    });
});
