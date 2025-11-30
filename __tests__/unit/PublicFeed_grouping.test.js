
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PublicFeed from '@/components/PublicFeed';
import '@testing-library/jest-dom';

describe('PublicFeed Grouping Logic', () => {
    const allUsers = [
        { id: 'jed', name: 'Jed', recipientId: 'louis', gifterId: 'louis' },
        { id: 'louis', name: 'Louis', recipientId: 'jed', gifterId: 'jed' }
    ];

    test('groups messages by conversationId correctly', () => {
        // Scenario: Jed is Santa to Louis (conversation 1), Louis is Santa to Jed (conversation 2)
        const convJedSanta = 'santa_jed_recipient_louis';
        const convLouisSanta = 'santa_louis_recipient_jed';

        const messages = [
            // Thread 1: Jed's Gift Exchange (Louis is Santa)
            { id: '1', fromId: 'louis', toId: 'jed', content: 'Ho ho ho', timestamp: '2023-01-01', conversationId: convLouisSanta },
            { id: '2', fromId: 'jed', toId: 'louis', content: 'Thanks Santa', timestamp: '2023-01-02', conversationId: convLouisSanta },

            // Thread 2: Louis's Gift Exchange (Jed is Santa)
            { id: '3', fromId: 'jed', toId: 'louis', content: 'I am your Santa', timestamp: '2023-01-03', conversationId: convJedSanta },
        ];

        render(<PublicFeed messages={messages} allUsers={allUsers} />);

        // Should see two distinct threads
        // Thread 1: "Jed's Gift Exchange" (Recipient is Jed)
        expect(screen.getByText("🎁 Jed's Gift Exchange")).toBeInTheDocument();

        // Thread 2: "Louis's Gift Exchange" (Recipient is Louis)
        expect(screen.getByText("🎁 Louis's Gift Exchange")).toBeInTheDocument();

        // Verify content grouping
        // Click on Jed's thread
        fireEvent.click(screen.getByText("🎁 Jed's Gift Exchange"));
        expect(screen.getByText('Ho ho ho')).toBeInTheDocument();
        expect(screen.getByText('Thanks Santa')).toBeInTheDocument();
        expect(screen.queryByText('I am your Santa')).not.toBeInTheDocument();
    });

    test('handles legacy messages (fallback logic)', () => {
        const messages = [
            // Legacy: Louis -> Jed (Louis is Santa)
            // isSantaMsg derived as true because Louis is Santa to Jed
            { id: 'legacy1', fromId: 'louis', toId: 'jed', content: 'Legacy Santa', timestamp: '2023-01-01' },
        ];

        render(<PublicFeed messages={messages} allUsers={allUsers} />);

        // Should group by Recipient (Jed)
        expect(screen.getByText("🎁 Jed's Gift Exchange")).toBeInTheDocument();
    });
});
