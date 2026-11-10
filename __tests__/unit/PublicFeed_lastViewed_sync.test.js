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

describe('PublicFeed hydrates from Firestore markers', () => {
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

    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    test('hydrates thread markers from Firestore so no stale unread badge is shown', async () => {
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

    test('a seeded legacy publicFeedLastViewed key is removed and does not affect the badge', async () => {
        // Legacy value claims the thread was viewed long after the message; it must be ignored.
        localStorage.setItem('publicFeedLastViewed', JSON.stringify({ [threadId]: '2099-01-01T00:00:00.000Z' }));
        const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
        mockGetCachedTimestamp.mockReturnValue(undefined);
        mockGetLastReadTimestamp.mockResolvedValue(new Date(0).toISOString());

        render(<PublicFeed messages={messages} allUsers={allUsers} userId="jed" />);

        await waitFor(() => {
            expect(screen.getByText('1')).toBeInTheDocument();
        });
        const legacyReads = getItemSpy.mock.calls.filter(([key]) => key === 'publicFeedLastViewed').length;
        getItemSpy.mockRestore();

        expect(legacyReads).toBe(0);
        expect(localStorage.getItem('publicFeedLastViewed')).toBeNull();
    });
});
