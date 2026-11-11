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
import { setWritableScope } from '@/lib/year-client';

describe('reactions-client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWritableScope({ key: 'a', year: 2025 });
        mockDoc.mockReturnValue('reactionDocRef');
    });

    afterEach(() => {
        setWritableScope(null);
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

    test('a 2026 scope toggles under years/2026/reactions', async () => {
        setWritableScope({ key: 'b', year: 2026 });
        mockGetDoc.mockResolvedValue({ exists: () => false });
        mockSetDoc.mockResolvedValue(undefined);

        await toggleReaction('msg-3', 'user-3', '👍');

        expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'years', '2026', 'reactions', 'msg-3_user-3_👍');
    });

    test('without a scope it throws and reads nothing', async () => {
        setWritableScope(null);

        await expect(toggleReaction('msg-4', 'user-4', '👍')).rejects.toThrow('Reactions are unavailable right now');
        expect(mockGetDoc).not.toHaveBeenCalled();
        expect(mockSetDoc).not.toHaveBeenCalled();
    });

    test('a getDoc held across a scope change throws and writes nothing', async () => {
        let resolveGet;
        mockGetDoc.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

        const pending = toggleReaction('msg-5', 'user-5', '👍');
        setWritableScope({ key: 'b', year: 2026 });
        resolveGet({ exists: () => false });

        await expect(pending).rejects.toThrow('Reactions are unavailable right now');
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(mockDeleteDoc).not.toHaveBeenCalled();
    });
});
