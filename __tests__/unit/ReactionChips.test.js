/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ReactionChips from '@/components/ReactionChips';

describe('ReactionChips', () => {
    test('groups reactions by emoji with counts', () => {
        render(
            <ReactionChips
                messageId="m1"
                currentUserId="u1"
                onToggle={null}
                allReactions={[
                    { messageId: 'm1', userId: 'u1', emoji: '👍' },
                    { messageId: 'm1', userId: 'u2', emoji: '👍' },
                    { messageId: 'm1', userId: 'u3', emoji: '🎄' },
                    { messageId: 'm2', userId: 'u4', emoji: '👍' },
                ]}
            />
        );

        expect(screen.getByText('👍 2')).toBeInTheDocument();
        expect(screen.getByText('🎄 1')).toBeInTheDocument();
    });

    test('calls onToggle when interactive chip is clicked', () => {
        const onToggle = jest.fn();
        render(
            <ReactionChips
                messageId="m1"
                currentUserId="u1"
                onToggle={onToggle}
                allReactions={[
                    { messageId: 'm1', userId: 'u1', emoji: '👍' },
                ]}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: '👍 reaction count 1' }));
        expect(onToggle).toHaveBeenCalledWith('👍');
    });
});
