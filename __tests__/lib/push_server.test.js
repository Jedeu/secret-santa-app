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
    beforeEach(() => {
        jest.clearAllMocks();
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

    test('sendIncomingMessagePush sends generic notification payload and link', async () => {
        const queryChain = {
            where: jest.fn(),
            get: jest.fn(),
        };

        queryChain.where.mockReturnValue(queryChain);
        queryChain.get.mockResolvedValue({
            empty: false,
            docs: [
                { data: () => ({ token: 'push-token-1' }) },
                { data: () => ({ token: 'push-token-1' }) }, // de-duped
            ],
        });

        firestore.collection.mockImplementation((name) => {
            if (name === 'pushTokens') {
                return queryChain;
            }

            throw new Error(`Unexpected collection: ${name}`);
        });

        messaging.sendEachForMulticast.mockResolvedValue({
            successCount: 1,
            failureCount: 0,
            responses: [{ success: true }],
        });

        const result = await sendIncomingMessagePush({
            toUserId: 'recipient-123',
            conversationId: 'conv-123',
        });

        expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(
            expect.objectContaining({
                tokens: ['push-token-1'],
                notification: {
                    title: 'Secret Santa',
                    body: 'You have a new message',
                },
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
});
