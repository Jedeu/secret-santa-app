import {
    cleanupInvalidTokens,
    sendIncomingMessagePush,
} from '@/lib/push-server';
import { firestore, messaging } from '@/lib/firebase';

jest.mock('@/lib/firebase', () => ({
    firestore: {
        collection: jest.fn(),
        batch: jest.fn(),
    },
    messaging: {
        sendEachForMulticast: jest.fn(),
    },
}));

describe('push-server helpers', () => {
    function mockEnabledPushTokens(tokens = ['push-token-1']) {
        const queryChain = {
            where: jest.fn(),
            get: jest.fn(),
        };

        queryChain.where.mockReturnValue(queryChain);
        queryChain.get.mockResolvedValue({
            empty: false,
            docs: tokens.map((token) => ({ data: () => ({ token }) })),
        });

        firestore.collection.mockImplementation((name) => {
            if (name === 'pushTokens') {
                return queryChain;
            }

            throw new Error(`Unexpected collection: ${name}`);
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        messaging.sendEachForMulticast.mockResolvedValue({
            successCount: 1,
            failureCount: 0,
            responses: [{ success: true }],
        });
    });

    test('cleanupInvalidTokens deletes invalid registration tokens only', async () => {
        const batchDelete = jest.fn();
        const batchCommit = jest.fn().mockResolvedValue(undefined);

        firestore.batch.mockReturnValue({
            delete: batchDelete,
            commit: batchCommit,
        });

        const docMock = jest.fn((id) => ({ id }));

        firestore.collection.mockImplementation((name) => {
            if (name === 'pushTokens') {
                return {
                    doc: docMock,
                };
            }

            throw new Error(`Unexpected collection: ${name}`);
        });

        const removedCount = await cleanupInvalidTokens(
            ['token-a', 'token-b'],
            {
                responses: [
                    { success: false, error: { code: 'messaging/invalid-registration-token' } },
                    { success: false, error: { code: 'messaging/internal-error' } },
                ],
            }
        );

        expect(removedCount).toBe(1);
        expect(docMock).toHaveBeenCalledTimes(1);
        expect(batchDelete).toHaveBeenCalledTimes(1);
        expect(batchCommit).toHaveBeenCalledTimes(1);
    });

    test('sendIncomingMessagePush sends recipient contextual notification copy', async () => {
        mockEnabledPushTokens(['push-token-1', 'push-token-1']);

        const result = await sendIncomingMessagePush({
            toUserId: 'recipient-123',
            conversationId: 'santa_santa-123_recipient_recipient-123',
            fromUserId: 'recipient-123',
        });

        expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
            expect.objectContaining({
                tokens: ['push-token-1'],
                notification: {
                    title: 'Secret Santa',
                    body: 'You have a new message from your recipient',
                },
                data: expect.objectContaining({
                    senderRole: 'recipient',
                    notificationBody: 'You have a new message from your recipient',
                }),
                webpush: expect.objectContaining({
                    fcmOptions: {
                        link: '/',
                    },
                }),
            })
        );

        expect(result).toMatchObject({
            totalTokens: 1,
            successCount: 1,
            failureCount: 0,
            cleanedTokenCount: 0,
        });
    });

    test('sendIncomingMessagePush sends Santa contextual notification copy', async () => {
        mockEnabledPushTokens(['push-token-1']);

        await sendIncomingMessagePush({
            toUserId: 'recipient-123',
            conversationId: 'santa_santa-123_recipient_recipient-123',
            fromUserId: 'santa-123',
        });

        expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
            expect.objectContaining({
                notification: {
                    title: 'Secret Santa',
                    body: 'You have a new message from Santa',
                },
                data: expect.objectContaining({
                    senderRole: 'santa',
                    notificationBody: 'You have a new message from Santa',
                }),
            })
        );
    });

    test('sendIncomingMessagePush falls back to generic copy when sender role is unknown', async () => {
        mockEnabledPushTokens(['push-token-1']);

        await sendIncomingMessagePush({
            toUserId: 'recipient-123',
            conversationId: 'invalid-conversation-id',
            fromUserId: 'mystery-user',
        });

        expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
            expect.objectContaining({
                notification: {
                    title: 'Secret Santa',
                    body: 'You have a new message',
                },
                data: expect.objectContaining({
                    senderRole: '',
                    notificationBody: 'You have a new message',
                }),
            })
        );
    });
});
