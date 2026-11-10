/**
 * @jest-environment jsdom
 *
 * PublicFeed read state: per-user markers (no shared localStorage), observed-boundary
 * marking on open, and marking of new messages while a thread is open and visible.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

const THREAD_ID = 'santa_alpha_recipient_beta';
const THREAD_NAME = "🎁 Beta's Gift Exchange";
const allUsers = [
    { id: 'alpha', name: 'Alpha', recipientId: 'beta' },
    { id: 'beta', name: 'Beta', gifterId: 'alpha' },
    { id: 'gamma', name: 'Gamma' },
];
const FIRST = '2026-01-01T10:00:00.000Z';
const SECOND = '2026-01-01T11:00:00.000Z';
const firstMessage = { id: 'm1', fromId: 'alpha', toId: 'beta', content: 'First', timestamp: FIRST, conversationId: THREAD_ID };
const secondMessage = { id: 'm2', fromId: 'beta', toId: 'alpha', content: 'Second', timestamp: SECOND, conversationId: THREAD_ID };

function setVisibility(state) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function badge() {
    return screen.queryByText(/^\d+$/);
}

describe('PublicFeed read state', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        setVisibility('visible');
        mockUpdateLastReadTimestamp.mockReturnValue(true);
        mockGetCachedTimestamp.mockReturnValue(undefined);
        mockGetLastReadTimestamp.mockResolvedValue(new Date(0).toISOString());
    });

    afterEach(() => {
        setVisibility('visible');
    });

    test('another user shows their own read state (keyed remount, no shared storage)', async () => {
        mockGetLastReadTimestamp.mockImplementation((userId) => Promise.resolve(
            userId === 'gamma' ? SECOND : new Date(0).toISOString()
        ));

        const { rerender } = render(
            <PublicFeed key="alpha" messages={[firstMessage]} allUsers={allUsers} userId="alpha" />
        );
        await waitFor(() => expect(badge()).toHaveTextContent('1'));

        rerender(<PublicFeed key="gamma" messages={[firstMessage]} allUsers={allUsers} userId="gamma" />);
        await waitFor(() => {
            expect(mockGetLastReadTimestamp).toHaveBeenCalledWith('gamma', `publicFeed_${THREAD_ID}`);
        });
        await waitFor(() => expect(badge()).toBeNull());

        expect(localStorage.length).toBe(0);
    });

    test('the legacy key is removed and never read', async () => {
        localStorage.setItem('publicFeedLastViewed', JSON.stringify({ [THREAD_ID]: '2099-01-01T00:00:00.000Z' }));
        const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

        render(<PublicFeed messages={[firstMessage]} allUsers={allUsers} userId="alpha" />);
        await waitFor(() => expect(badge()).toHaveTextContent('1'));

        const legacyReads = getItemSpy.mock.calls.filter(([key]) => key === 'publicFeedLastViewed').length;
        getItemSpy.mockRestore();
        expect(legacyReads).toBe(0);
        expect(localStorage.getItem('publicFeedLastViewed')).toBeNull();
    });

    test('opening a thread marks it read up to its latest message timestamp', async () => {
        render(<PublicFeed messages={[firstMessage]} allUsers={allUsers} userId="alpha" />);
        await waitFor(() => expect(badge()).toHaveTextContent('1'));

        fireEvent.click(screen.getByText(THREAD_NAME));

        expect(mockUpdateLastReadTimestamp).toHaveBeenCalledWith('alpha', `publicFeed_${THREAD_ID}`, FIRST);
    });

    test('a new message while the thread is open and visible is marked read; unread is 0 after Back', async () => {
        const { rerender } = render(<PublicFeed messages={[firstMessage]} allUsers={allUsers} userId="alpha" />);
        await waitFor(() => expect(badge()).toHaveTextContent('1'));
        fireEvent.click(screen.getByText(THREAD_NAME));

        rerender(<PublicFeed messages={[firstMessage, secondMessage]} allUsers={allUsers} userId="alpha" />);

        expect(mockUpdateLastReadTimestamp).toHaveBeenCalledWith('alpha', `publicFeed_${THREAD_ID}`, SECOND);

        fireEvent.click(screen.getByText('← Back'));
        expect(screen.getByText(THREAD_NAME)).toBeInTheDocument();
        expect(badge()).toBeNull();
    });

    test('no write while hidden; the open thread is marked once the tab becomes visible', async () => {
        const { rerender } = render(<PublicFeed messages={[firstMessage]} allUsers={allUsers} userId="alpha" />);
        await waitFor(() => expect(badge()).toHaveTextContent('1'));
        fireEvent.click(screen.getByText(THREAD_NAME));
        mockUpdateLastReadTimestamp.mockClear();

        setVisibility('hidden');
        rerender(<PublicFeed messages={[firstMessage, secondMessage]} allUsers={allUsers} userId="alpha" />);

        expect(mockUpdateLastReadTimestamp).not.toHaveBeenCalled();

        act(() => {
            setVisibility('visible');
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(mockUpdateLastReadTimestamp).toHaveBeenCalledWith('alpha', `publicFeed_${THREAD_ID}`, SECOND);
    });
});
