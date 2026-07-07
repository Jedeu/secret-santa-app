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

    test('writes immediately on first keystroke, then throttles to one trailing write per 2 seconds', async () => {
        // Leading edge: first call writes right away.
        setTyping('user1', 'conv1');
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(mockSetDoc).toHaveBeenCalledWith('typingDocRef', expect.objectContaining({
            userId: 'user1',
            conversationId: 'conv1',
            typingAt: expect.any(String),
        }));

        // Rapid subsequent keystrokes within the window do not add writes.
        setTyping('user1', 'conv1');
        setTyping('user1', 'conv1');
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        // A single trailing write fires once the throttle window elapses.
        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });

    test('clearTyping cancels pending trailing write and deletes typing doc', async () => {
        setTyping('user1', 'conv2'); // leading-edge write fires immediately
        setTyping('user1', 'conv2'); // schedules a trailing write within the window
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        clearTyping('user1', 'conv2'); // cancels the pending trailing write

        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        // No trailing write landed; only the single leading write remains.
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
        expect(mockDeleteDoc).toHaveBeenCalledWith('typingDocRef');
    });

    test('clearTyping still deletes doc when no pending timeout exists', () => {
        clearTyping('user1', 'conv3');
        expect(mockDeleteDoc).toHaveBeenCalledWith('typingDocRef');
    });
});
