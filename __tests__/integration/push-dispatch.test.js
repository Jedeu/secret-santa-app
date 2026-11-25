/**
 * Push dispatch against the Firestore emulator (Admin SDK): the unread count read from
 * lastRead and messages. FCM is replaced by a mock, so no push is ever sent.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/firebase';
import { sendIncomingMessagePush } from '@/lib/push-server';
import { yearCollectionPath } from '@/lib/year-paths';
import { clearEmulatorFirestore } from './helpers/emulator-admin';

const mockSendEachForMulticast = jest.fn();

jest.mock('@/lib/firebase', () => {
    const actual = jest.requireActual('@/lib/firebase');
    return {
        ...actual,
        messaging: { sendEachForMulticast: (...args) => mockSendEachForMulticast(...args) },
    };
});

const YEAR = 2026;
const SANTA = 'it-push-santa';
const RECIPIENT = 'it-push-recipient';
const THEIR_RECIPIENT = 'it-push-their-recipient';
const CHAT = `santa_${SANTA}_recipient_${RECIPIENT}`;
const OTHER_CHAT = `santa_${RECIPIENT}_recipient_${THEIR_RECIPIENT}`;

function collection(name) {
    return firestore.collection(yearCollectionPath(YEAR, name).join('/'));
}

async function seedMessage(id, fields) {
    const message = { id, content: 'hi', ...fields };
    await collection('messages').doc(id).set(message);
    return message;
}

describe('push dispatch (emulator)', () => {
    let savedFlag;

    beforeAll(() => {
        savedFlag = process.env.PUSH_DISPATCH_ENABLED;
        process.env.PUSH_DISPATCH_ENABLED = 'true';
    });

    afterAll(() => {
        if (savedFlag === undefined) delete process.env.PUSH_DISPATCH_ENABLED;
        else process.env.PUSH_DISPATCH_ENABLED = savedFlag;
    });

    beforeEach(async () => {
        await clearEmulatorFirestore();
        mockSendEachForMulticast.mockReset();
        mockSendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });
        await firestore.collection('system').doc('lifecycle').set({ epoch: 3, state: 'active', year: YEAR });
        await firestore.collection('pushTokens').doc('it-push-row').set({
            userId: RECIPIENT, token: 'it-fake-device-token', enabled: true, revision: 'rev-1',
        });
    });

    test('counts messages after lastRead in this chat, and unread in both chats for the badge', async () => {
        // Read up to 09:00 in the Santa chat: one earlier message is read, two later ones are not.
        await collection('lastRead').doc(`${RECIPIENT}_${CHAT}`).set({
            userId: RECIPIENT, conversationId: CHAT, lastReadAt: Timestamp.fromDate(new Date('2026-12-09T09:00:00.000Z')),
        });
        await seedMessage('m1', { fromId: SANTA, toId: RECIPIENT, conversationId: CHAT, timestamp: '2026-12-09T09:00:00.000Z' });
        await seedMessage('m2', { fromId: SANTA, toId: RECIPIENT, conversationId: CHAT, timestamp: '2026-12-09T09:30:00.000Z' });
        // The receiver's own message in the same chat never counts.
        await seedMessage('m3', { fromId: RECIPIENT, toId: SANTA, conversationId: CHAT, timestamp: '2026-12-09T09:35:00.000Z' });
        const latest = await seedMessage('m4', {
            fromId: SANTA, toId: RECIPIENT, conversationId: CHAT, timestamp: '2026-12-09T09:41:00.000Z', content: 'Did you get my hint?',
        });
        // Never opened the other chat: everything in it is unread.
        await seedMessage('m5', { fromId: THEIR_RECIPIENT, toId: RECIPIENT, conversationId: OTHER_CHAT, timestamp: '2026-12-09T08:00:00.000Z' });

        await sendIncomingMessagePush({
            year: YEAR,
            message: latest,
            receiver: { recipientId: THEIR_RECIPIENT, gifterId: SANTA },
        });

        expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
        const payload = mockSendEachForMulticast.mock.calls[0][0];
        expect(payload.tokens).toEqual(['it-fake-device-token']);
        expect(payload.notification).toEqual({ title: '🎅 Your Santa · 2 new', body: 'Did you get my hint?' });
        expect(payload.data).toMatchObject({ chat: 'santa', unreadTotal: '3' });
    });
});
