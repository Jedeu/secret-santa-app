/**
 * @jest-environment jsdom
 */

const mockDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockDeleteDoc = jest.fn();

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    getDoc: (...args) => mockGetDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    deleteDoc: (...args) => mockDeleteDoc(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
}));

import { toggleReaction } from '@/lib/reactions-client';

describe('reactions-client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDoc.mockReturnValue('reactionDocRef');
    });

    test('creates reaction on first toggle', async () => {
        mockGetDoc.mockResolvedValue({ exists: () => false });
        mockSetDoc.mockResolvedValue(undefined);

        const result = await toggleReaction('msg-1', 'user-1', '👍');

        expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'reactions', 'msg-1_user-1_👍');
        expect(mockSetDoc).toHaveBeenCalledWith('reactionDocRef', expect.objectContaining({
            messageId: 'msg-1',
            userId: 'user-1',
            emoji: '👍',
            createdAt: expect.any(String),
        }));
        expect(result).toEqual({ action: 'added' });
    });

    test('removes reaction when existing doc is present', async () => {
        mockGetDoc.mockResolvedValue({ exists: () => true });
        mockDeleteDoc.mockResolvedValue(undefined);

        const result = await toggleReaction('msg-2', 'user-2', '🎄');

        expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'reactions', 'msg-2_user-2_🎄');
        expect(mockDeleteDoc).toHaveBeenCalledWith('reactionDocRef');
        expect(result).toEqual({ action: 'removed' });
    });
});
