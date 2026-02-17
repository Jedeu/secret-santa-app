/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PublicFeed from '@/components/PublicFeed';
import '@testing-library/jest-dom';

const mockUpdateLastReadTimestamp = jest.fn();
const mockGetCachedTimestamp = jest.fn();
const mockGetLastReadTimestamp = jest.fn();

jest.mock('@/lib/lastReadClient', () => ({
    updateLastReadTimestamp: (...args) => mockUpdateLastReadTimestamp(...args),
    getCachedTimestamp: (...args) => mockGetCachedTimestamp(...args),
    getLastReadTimestamp: (...args) => mockGetLastReadTimestamp(...args),
}));

describe('PublicFeed lastViewed hydration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    test('hydrates thread lastViewed from Firestore so stale localStorage does not inflate unread badge', async () => {
        const threadId = 'santa_jed_recipient_louis';
        const allUsers = [
            { id: 'jed', name: 'Jed' },
            { id: 'louis', name: 'Louis' }
        ];

        const messages = [
            {
                id: 'm1',
                fromId: 'jed',
                toId: 'louis',
                content: 'hello',
                timestamp: '2023-01-01T12:00:00.000Z',
                conversationId: threadId
            }
        ];

        mockGetCachedTimestamp.mockReturnValue(undefined);
        mockGetLastReadTimestamp.mockResolvedValue('2023-01-02T12:00:00.000Z');

        render(<PublicFeed messages={messages} allUsers={allUsers} userId="jed" />);

        await waitFor(() => {
            expect(mockGetLastReadTimestamp).toHaveBeenCalledWith('jed', `publicFeed_${threadId}`);
        });

        await waitFor(() => {
            expect(screen.queryByText('1')).not.toBeInTheDocument();
        });
    });
});
