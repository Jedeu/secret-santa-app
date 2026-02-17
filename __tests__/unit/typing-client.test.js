/**
 * @jest-environment jsdom
 */

const mockDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockDeleteDoc = jest.fn();

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    deleteDoc: (...args) => mockDeleteDoc(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
}));

import { clearTyping, setTyping } from '@/lib/typing-client';

describe('typing-client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockDoc.mockReturnValue('typingDocRef');
        mockSetDoc.mockResolvedValue(undefined);
        mockDeleteDoc.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('debounces typing writes to one write per 2 seconds', async () => {
        setTyping('user1', 'conv1');
        setTyping('user1', 'conv1');
        setTyping('user1', 'conv1');

        expect(mockSetDoc).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(mockSetDoc).toHaveBeenCalledWith('typingDocRef', expect.objectContaining({
            userId: 'user1',
            conversationId: 'conv1',
            typingAt: expect.any(String),
        }));
    });

    test('clearTyping cancels pending write and deletes typing doc', async () => {
        setTyping('user1', 'conv2');
        clearTyping('user1', 'conv2');

        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
        expect(mockDeleteDoc).toHaveBeenCalledWith('typingDocRef');
    });

    test('clearTyping still deletes doc when no pending timeout exists', () => {
        clearTyping('user1', 'conv3');
        expect(mockDeleteDoc).toHaveBeenCalledWith('typingDocRef');
    });
});
