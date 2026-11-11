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

import { clearTyping, resetTypingState, setTyping } from '@/lib/typing-client';
import { setWritableScope } from '@/lib/year-client';

describe('typing-client', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        setWritableScope({ key: 'a', year: 2025 });
        mockDoc.mockReturnValue('typingDocRef');
        mockSetDoc.mockResolvedValue(undefined);
        mockDeleteDoc.mockResolvedValue(undefined);
    });

    afterEach(() => {
        setWritableScope(null);
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
        expect(mockDoc).toHaveBeenCalledWith({ _isMock: true }, 'typing', 'conv1_user1');

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

    test('setDoc rejection is caught and logged, not an unhandled rejection', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);

        try {
            mockSetDoc.mockRejectedValue(new Error('offline'));

            // Leading write (immediate) and trailing write both take the rejecting path
            setTyping('user1', 'conv4');
            setTyping('user1', 'conv4');
            jest.advanceTimersByTime(2000);

            // Flush microtasks so rejections would surface
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSetDoc).toHaveBeenCalledTimes(2);
            expect(consoleError).toHaveBeenCalledWith(
                'Failed to write typing state:',
                expect.any(Error)
            );
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
            consoleError.mockRestore();
        }
    });

    test('a 2026 scope writes under years/2026/typing', () => {
        setWritableScope({ key: 'b', year: 2026 });

        setTyping('user1', 'conv5');

        expect(mockDoc).toHaveBeenCalledWith({ _isMock: true }, 'years', '2026', 'typing', 'conv5_user1');
    });

    test('without a scope nothing is written', () => {
        setWritableScope(null);

        setTyping('user1', 'conv6');
        jest.advanceTimersByTime(5000);

        expect(mockSetDoc).not.toHaveBeenCalled();
    });

    test('a trailing write is dropped after a scope change', async () => {
        setTyping('user1', 'conv7'); // leading write under scope a
        setTyping('user1', 'conv7'); // trailing write scheduled under scope a
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        setWritableScope({ key: 'b', year: 2026 });
        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    test('clearTyping without a scope clears timers but sends no delete', async () => {
        setTyping('user1', 'conv8');
        setTyping('user1', 'conv8'); // trailing write scheduled
        setWritableScope(null);

        clearTyping('user1', 'conv8');
        jest.advanceTimersByTime(2000);
        await Promise.resolve();

        expect(mockDeleteDoc).not.toHaveBeenCalled();
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    test('resetTypingState cancels pending trailing writes and the throttle window', async () => {
        setTyping('user1', 'conv9');
        setTyping('user1', 'conv9'); // trailing write scheduled
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        resetTypingState();
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        // The throttle window was forgotten: the next keystroke writes immediately.
        setTyping('user1', 'conv9');
        expect(mockSetDoc).toHaveBeenCalledTimes(2);
    });
});
