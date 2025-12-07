/** @jest-environment jsdom */

/**
 * Tests for the unread badge clearing behavior.
 * Verifies that badges clear immediately when updateLastReadTimestamp is called.
 */

import { renderHook, act } from '@testing-library/react';
import { useRealtimeUnreadCounts, updateLastReadTimestamp } from '../../src/hooks/useRealtimeMessages';
import { getConversationId } from '../../src/lib/message-utils';

// Mock Firebase
jest.mock('../../src/lib/firebase-client', () => ({
    firestore: {}
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    onSnapshot: jest.fn()
}));

jest.mock('../../src/lib/firestore-listener-tracker', () => ({
    logListenerCreated: jest.fn(),
    logListenerDestroyed: jest.fn(),
    logSnapshotReceived: jest.fn(),
}));

jest.mock('../../src/lib/lastReadClient', () => ({
    updateLastReadTimestamp: jest.fn(),
    getCachedTimestamp: jest.fn()
}));

import { onSnapshot } from 'firebase/firestore';

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
    let recipientSnapshotCallback;
    let santaSnapshotCallback;

    // Conversation IDs in new format
    const recipientConvId = getConversationId('user1', 'recipient1'); // santa_user1_recipient_recipient1
    const santaConvId = getConversationId('santa1', 'user1'); // santa_santa1_recipient_user1

    beforeEach(() => {
        jest.clearAllMocks();

        // Reset snapshot callbacks
        recipientSnapshotCallback = null;
        santaSnapshotCallback = null;

        // Mock onSnapshot to capture callbacks
        let callCount = 0;
        onSnapshot.mockImplementation((query, options, callback) => {
            callCount++;
            // First call is for recipient, second for santa
            if (callCount === 1) {
                recipientSnapshotCallback = callback;
            } else if (callCount === 2) {
                santaSnapshotCallback = callback;
            }
            return jest.fn(); // unsubscribe function
        });

        // Mock localStorage
        const store = {};
        global.localStorage = {
            getItem: (key) => store[key] || null,
            setItem: (key, value) => { store[key] = value; },
            clear: () => Object.keys(store).forEach(k => delete store[k])
        };
    });

    describe('Badge appears when new message arrives', () => {
        it('should show unread count when messages arrive after lastRead', async () => {
            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            // Simulate messages arriving that are newer than lastRead (epoch)
            act(() => {
                if (recipientSnapshotCallback) {
                    recipientSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: new Date().toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        }
                    ]));
                }
            });

            expect(result.current.recipientUnread).toBe(1);
        });

        it('should show correct count for multiple unread messages', async () => {
            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            const now = new Date();
            act(() => {
                if (recipientSnapshotCallback) {
                    recipientSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: new Date(now.getTime() - 1000).toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        },
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: new Date(now.getTime() - 500).toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        },
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: now.toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        }
                    ]));
                }
            });

            expect(result.current.recipientUnread).toBe(3);
        });
    });

    describe('Badge clears when user visits tab', () => {
        it('should clear badge immediately when updateLastReadTimestamp is called', async () => {
            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            const messageTime = new Date();

            // First, simulate a message arriving
            act(() => {
                if (recipientSnapshotCallback) {
                    recipientSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: messageTime.toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        }
                    ]));
                }
            });

            expect(result.current.recipientUnread).toBe(1);

            // Now simulate user visiting the tab (calls updateLastReadTimestamp)
            // This should trigger recalculation with updated lastRead
            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId);
            });

            // Badge should be cleared because lastRead is now >= message timestamp
            expect(result.current.recipientUnread).toBe(0);
        });

        it('should clear santa badge when visiting santa tab', async () => {
            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            const messageTime = new Date();

            // Simulate santa message arriving
            act(() => {
                if (santaSnapshotCallback) {
                    santaSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'santa1',
                            toId: 'user1',
                            timestamp: messageTime.toISOString(),
                            conversationId: 'santa_santa1_recipient_user1'
                        }
                    ]));
                }
            });

            expect(result.current.santaUnread).toBe(1);

            // User visits santa tab
            act(() => {
                updateLastReadTimestamp('user1', 'santa1', santaConvId);
            });

            expect(result.current.santaUnread).toBe(0);
        });
    });

    describe('Badge respects conversation ID matching', () => {
        it('should not count messages with wrong conversationId', async () => {
            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            act(() => {
                if (recipientSnapshotCallback) {
                    recipientSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: new Date().toISOString(),
                            conversationId: 'santa_wrong_recipient_wrong' // Wrong conversation
                        }
                    ]));
                }
            });

            // Should not count because conversationId doesn't match
            expect(result.current.recipientUnread).toBe(0);
        });
    });

    describe('Works for both Santa and Recipient tabs', () => {
        it('should track both counts independently', async () => {
            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            const now = new Date();

            // Recipient message
            act(() => {
                if (recipientSnapshotCallback) {
                    recipientSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: now.toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        }
                    ]));
                }
            });

            // Santa message
            act(() => {
                if (santaSnapshotCallback) {
                    santaSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'santa1',
                            toId: 'user1',
                            timestamp: now.toISOString(),
                            conversationId: 'santa_santa1_recipient_user1'
                        },
                        {
                            fromId: 'santa1',
                            toId: 'user1',
                            timestamp: now.toISOString(),
                            conversationId: 'santa_santa1_recipient_user1'
                        }
                    ]));
                }
            });

            expect(result.current.recipientUnread).toBe(1);
            expect(result.current.santaUnread).toBe(2);

            // Clear only recipient badge
            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId);
            });

            expect(result.current.recipientUnread).toBe(0);
            expect(result.current.santaUnread).toBe(2); // Still has santa messages

            // Clear santa badge
            act(() => {
                updateLastReadTimestamp('user1', 'santa1', santaConvId);
            });

            expect(result.current.recipientUnread).toBe(0);
            expect(result.current.santaUnread).toBe(0);
        });
    });

    describe('Badge clears when new message arrives while viewing tab', () => {
        it('should clear badge when new message arrives while user is viewing the tab', async () => {
            // Use fake timers to control time precisely
            jest.useFakeTimers();
            const baseTime = new Date('2024-12-01T10:00:00.000Z');
            jest.setSystemTime(baseTime);

            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            // T0: User views the tab (calls updateLastReadTimestamp)
            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId);
            });

            // T1: Advance time by 1 second, then a message arrives
            jest.setSystemTime(new Date(baseTime.getTime() + 1000));
            const messageTime = new Date(); // This is T0 + 1 second

            act(() => {
                if (recipientSnapshotCallback) {
                    recipientSnapshotCallback(createMockSnapshot([
                        {
                            fromId: 'recipient1',
                            toId: 'user1',
                            timestamp: messageTime.toISOString(),
                            conversationId: 'santa_user1_recipient_recipient1'
                        }
                    ]));
                }
            });

            // Badge shows 1 because message timestamp (T1) > lastRead (T0)
            expect(result.current.recipientUnread).toBe(1);

            // T2: Advance time by another second, simulate Chat's useEffect re-running
            jest.setSystemTime(new Date(baseTime.getTime() + 2000));
            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId);
            });

            // Badge should now be cleared because lastRead (T2) >= message timestamp (T1)
            expect(result.current.recipientUnread).toBe(0);

            jest.useRealTimers();
        });

        it('should handle rapid sequential messages while viewing', async () => {
            // Use fake timers to control time precisely
            jest.useFakeTimers();
            const baseTime = new Date('2024-12-01T10:00:00.000Z');
            jest.setSystemTime(baseTime);

            const { result } = renderHook(() =>
                useRealtimeUnreadCounts('user1', 'recipient1', 'santa1')
            );

            // T0: User starts viewing
            act(() => {
                updateLastReadTimestamp('user1', 'recipient1', recipientConvId);
            });

            // Simulate 3 rapid messages at T1, T2, T3
            // After each message, updateLastReadTimestamp is called (simulating Chat's useEffect)
            for (let i = 1; i <= 3; i++) {
                // Advance time for message arrival
                jest.setSystemTime(new Date(baseTime.getTime() + i * 100));
                const messageTime = new Date();

                act(() => {
                    if (recipientSnapshotCallback) {
                        recipientSnapshotCallback(createMockSnapshot([
                            {
                                fromId: 'recipient1',
                                toId: 'user1',
                                timestamp: messageTime.toISOString(),
                                conversationId: 'santa_user1_recipient_recipient1'
                            }
                        ]));
                    }
                });

                // Message arrives, badge would be 1 (message is newer than previous lastRead)
                // But immediately, updateLastReadTimestamp is called (Chat's useEffect)
                // Advance time slightly to ensure lastRead > message timestamp
                jest.setSystemTime(new Date(baseTime.getTime() + i * 100 + 1));
                act(() => {
                    updateLastReadTimestamp('user1', 'recipient1', recipientConvId);
                });

                // Badge should be 0 because we just called updateLastReadTimestamp
                expect(result.current.recipientUnread).toBe(0);
            }

            jest.useRealTimers();
        });
    });
});
