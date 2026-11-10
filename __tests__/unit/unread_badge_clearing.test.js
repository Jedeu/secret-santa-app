/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRealtimeUnreadCounts, updateLastReadTimestamp } from '../../src/hooks/useRealtimeMessages';
import { RealtimeMessagesProvider, useRealtimeMessagesContext } from '../../src/context/RealtimeMessagesContext';
import { onSnapshot } from 'firebase/firestore';
import { getConversationId } from '../../src/lib/message-utils';

// Mock dependencies
jest.mock('../../src/lib/firebase-client', () => ({
    firestore: {}
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    onSnapshot: jest.fn(),
    orderBy: jest.fn()
}));

jest.mock('../../src/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

// Mock useUser
jest.mock('../../src/hooks/useUser', () => ({
    useUser: jest.fn(() => ({
        user: { id: 'user1', name: 'Test User' },
        loading: false
    }))
}));

// Stateful lastReadClient mock: accepts only advancing, valid observed timestamps.
const mockLastReadStore = new Map();
const mockMarkerCallbacks = new Map();

jest.mock('../../src/lib/lastReadClient', () => ({
    updateLastReadTimestamp: jest.fn((userId, conversationId, observedAt) => {
        if (!userId || !conversationId || typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
            return false;
        }
        const key = `${userId}_${conversationId}`;
        const current = mockLastReadStore.get(key);
        if (current && Date.parse(observedAt) <= Date.parse(current)) {
            return false;
        }
        mockLastReadStore.set(key, observedAt);
        return true;
    }),
    getLastReadTimestamp: jest.fn((userId, conversationId) => {
        const key = `${userId}_${conversationId}`;
        return Promise.resolve(mockLastReadStore.get(key) || new Date(0).toISOString());
    }),
    getCachedTimestamp: jest.fn((userId, conversationId) => {
        const key = `${userId}_${conversationId}`;
        return mockLastReadStore.get(key) || new Date(0).toISOString();
    }),
    subscribeToLastRead: jest.fn((userId, conversationId, callback) => {
        mockMarkerCallbacks.set(`${userId}_${conversationId}`, callback);
        return () => mockMarkerCallbacks.delete(`${userId}_${conversationId}`);
    }),
    flushPendingWrites: jest.fn(() => Promise.resolve()),
    resetLastReadState: jest.fn(),
}));

import { subscribeToLastRead as mockSubscribeToLastRead } from '../../src/lib/lastReadClient';

// Helper to create mock snapshot
function createMockSnapshot(messages) {
    return {
        forEach: (cb) => messages.forEach(msg => cb({ data: () => msg })),
        size: messages.length,
        metadata: { fromCache: false },
        docChanges: () => messages.map(() => ({}))
    };
}

describe('Unread Badge Clearing', () => {
    let providerSnapshotCallback;

    // Conversation IDs in new format
    const recipientConvId = getConversationId('user1', 'recipient1');
    const santaConvId = getConversationId('santa1', 'user1');

    beforeEach(() => {
        jest.clearAllMocks();
        mockLastReadStore.clear();
        mockMarkerCallbacks.clear();

        providerSnapshotCallback = null;

        onSnapshot.mockImplementation((query, options, callback) => {
            // Provider creates messages + reactions listeners. First is messages.
            if (!providerSnapshotCallback) {
                providerSnapshotCallback = callback;
            }
            return jest.fn();
        });
    });

    const wrapper = ({ children }) => (
        <RealtimeMessagesProvider>{children}</RealtimeMessagesProvider>
    );

    async function renderCounts(userId = 'user1', recipientId = 'recipient1', gifterId = 'santa1') {
        const rendered = renderHook(() => ({
            counts: useRealtimeUnreadCounts(userId, recipientId, gifterId),
            context: useRealtimeMessagesContext(),
        }), { wrapper });
        await waitFor(() => {
            expect(mockSubscribeToLastRead).toHaveBeenCalled();
        });
        return rendered;
    }

    function deliver(messages) {
        act(() => {
            if (providerSnapshotCallback) {
                providerSnapshotCallback(createMockSnapshot(messages));
            }
        });
    }

    test('subscribes to both own markers', async () => {
        await renderCounts();

        expect(mockSubscribeToLastRead).toHaveBeenCalledWith('user1', recipientConvId, expect.any(Function));
        expect(mockSubscribeToLastRead).toHaveBeenCalledWith('user1', santaConvId, expect.any(Function));
    });

    describe('Badge appears when new message arrives', () => {
        it('should show unread count when messages arrive after lastRead', async () => {
            const { result } = await renderCounts();

            deliver([{ fromId: 'recipient1', toId: 'user1', timestamp: new Date().toISOString(), conversationId: recipientConvId }]);

            expect(result.current.counts.recipientUnread).toBe(1);
        });

        it('should show correct count for multiple unread messages', async () => {
            const { result } = await renderCounts();

            const now = new Date();
            deliver([
                { fromId: 'recipient1', toId: 'user1', timestamp: new Date(now.getTime() - 1000).toISOString(), conversationId: recipientConvId },
                { fromId: 'recipient1', toId: 'user1', timestamp: new Date(now.getTime() - 500).toISOString(), conversationId: recipientConvId },
                { fromId: 'recipient1', toId: 'user1', timestamp: now.toISOString(), conversationId: recipientConvId },
            ]);

            expect(result.current.counts.recipientUnread).toBe(3);
        });
    });

    describe('Badge clears when user visits tab', () => {
        it('should clear badge immediately when the observed boundary is recorded', async () => {
            const { result } = await renderCounts();
            const messageTime = new Date().toISOString();

            deliver([{ fromId: 'recipient1', toId: 'user1', timestamp: messageTime, conversationId: recipientConvId }]);
            expect(result.current.counts.recipientUnread).toBe(1);

            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId, messageTime);
            });

            expect(result.current.counts.recipientUnread).toBe(0);
        });

        it('should clear santa badge when visiting santa tab', async () => {
            const { result } = await renderCounts();
            const messageTime = new Date().toISOString();

            deliver([{ fromId: 'santa1', toId: 'user1', timestamp: messageTime, conversationId: santaConvId }]);
            expect(result.current.counts.santaUnread).toBe(1);

            act(() => {
                updateLastReadTimestamp('user1', 'santa1', santaConvId, messageTime);
            });

            expect(result.current.counts.santaUnread).toBe(0);
        });

        it('a remote marker callback clears the badge (read on another device)', async () => {
            const { result } = await renderCounts();
            const messageTime = new Date().toISOString();

            deliver([{ fromId: 'recipient1', toId: 'user1', timestamp: messageTime, conversationId: recipientConvId }]);
            expect(result.current.counts.recipientUnread).toBe(1);

            act(() => {
                mockLastReadStore.set(`user1_${recipientConvId}`, messageTime);
                mockMarkerCallbacks.get(`user1_${recipientConvId}`)(messageTime);
            });

            expect(result.current.counts.recipientUnread).toBe(0);
        });

        it('a rejected (non-advancing) update does not notify subscribers', async () => {
            const { result } = await renderCounts();
            const later = '2026-01-02T00:00:00.000Z';
            const earlier = '2026-01-01T00:00:00.000Z';
            const listener = jest.fn();
            const unsubscribe = result.current.context.subscribeToLastReadChanges(listener);

            act(() => {
                expect(updateLastReadTimestamp('user1', 'recipient1', recipientConvId, later)).toBe(true);
            });
            expect(listener).toHaveBeenCalledTimes(1);

            act(() => {
                expect(updateLastReadTimestamp('user1', 'recipient1', recipientConvId, earlier)).toBe(false);
                expect(updateLastReadTimestamp('user1', 'recipient1', recipientConvId, null)).toBe(false);
            });
            expect(listener).toHaveBeenCalledTimes(1);
            unsubscribe();
        });
    });

    describe('Badge respects conversation routing', () => {
        it('should not count messages with a mismatched explicit conversationId', async () => {
            const { result } = await renderCounts();

            deliver([{
                fromId: 'recipient1',
                toId: 'user1',
                timestamp: new Date().toISOString(),
                conversationId: 'santa_wrong_recipient_wrong'
            }]);

            expect(result.current.counts.recipientUnread).toBe(0);
        });

        it("a mutual pair's legacy row counts in one tab only", async () => {
            const { result } = await renderCounts('user1', 'peer', 'peer');

            deliver([{ id: 'legacy-1', fromId: 'peer', toId: 'user1', timestamp: new Date().toISOString() }]);

            expect(result.current.counts.recipientUnread + result.current.counts.santaUnread).toBe(1);
        });
    });

    describe('Works for both Santa and Recipient tabs', () => {
        it('should track both counts independently', async () => {
            const { result } = await renderCounts();
            const now = new Date().toISOString();

            deliver([
                { fromId: 'recipient1', toId: 'user1', timestamp: now, conversationId: recipientConvId },
                { fromId: 'santa1', toId: 'user1', timestamp: now, conversationId: santaConvId },
                { fromId: 'santa1', toId: 'user1', timestamp: now, conversationId: santaConvId },
            ]);

            expect(result.current.counts.recipientUnread).toBe(1);
            expect(result.current.counts.santaUnread).toBe(2);

            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId, now);
            });

            expect(result.current.counts.recipientUnread).toBe(0);
            expect(result.current.counts.santaUnread).toBe(2);

            act(() => {
                updateLastReadTimestamp('user1', 'santa1', santaConvId, now);
            });

            expect(result.current.counts.recipientUnread).toBe(0);
            expect(result.current.counts.santaUnread).toBe(0);
        });
    });

    describe('Badge clears when new message arrives while viewing tab', () => {
        it('marks up to the newest observed message, so a later message is unread until observed', async () => {
            const { result } = await renderCounts();
            const first = '2024-12-01T10:00:00.000Z';
            const second = '2024-12-01T10:00:01.000Z';

            deliver([{ fromId: 'recipient1', toId: 'user1', timestamp: first, conversationId: recipientConvId }]);
            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId, first);
            });
            expect(result.current.counts.recipientUnread).toBe(0);

            deliver([
                { fromId: 'recipient1', toId: 'user1', timestamp: first, conversationId: recipientConvId },
                { fromId: 'recipient1', toId: 'user1', timestamp: second, conversationId: recipientConvId },
            ]);
            expect(result.current.counts.recipientUnread).toBe(1);

            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId, second);
            });
            expect(result.current.counts.recipientUnread).toBe(0);
        });

        it('should handle rapid sequential messages while viewing', async () => {
            const { result } = await renderCounts();
            const base = Date.parse('2024-12-01T10:00:00.000Z');
            const messages = [];

            for (let i = 1; i <= 3; i++) {
                const timestamp = new Date(base + i * 100).toISOString();
                messages.push({ fromId: 'recipient1', toId: 'user1', timestamp, conversationId: recipientConvId });
                deliver([...messages]);

                act(() => {
                    updateLastReadTimestamp('user1', 'recipient1', recipientConvId, timestamp);
                });

                expect(result.current.counts.recipientUnread).toBe(0);
            }
        });
    });
});
