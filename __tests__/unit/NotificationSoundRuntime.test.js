/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import NotificationSoundRuntime from '@/components/NotificationSoundRuntime';

describe('NotificationSoundRuntime', () => {
    let playMock;
    let nowMs;
    let dateNowSpy;

    const currentUserId = 'user-a';
    const otherUserId = 'user-b';
    const thirdUserId = 'user-c';

    const makeMessage = ({ id, fromId, toId }) => ({
        id,
        fromId,
        toId,
        timestamp: `2026-02-13T10:00:0${id}.000Z`,
        content: `msg-${id}`,
    });

    beforeEach(() => {
        playMock = jest.fn().mockResolvedValue(undefined);
        nowMs = 10_000;

        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: jest.fn().mockReturnValue({ matches: true }),
        });

        Object.defineProperty(window.navigator, 'standalone', {
            configurable: true,
            value: false,
        });

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });

        global.Audio = jest.fn(() => ({ play: playMock }));
        dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    });

    afterEach(() => {
        dateNowSpy.mockRestore();
    });

    test('does not chime on initial hydration snapshot', () => {
        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[makeMessage({ id: '1', fromId: otherUserId, toId: currentUserId })]}
                allMessagesLoading={false}
            />
        );

        expect(playMock).not.toHaveBeenCalled();
    });

    test('plays chime for new incoming message to current user after hydration', () => {
        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        // Hydration baseline
        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={false}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[makeMessage({ id: '1', fromId: otherUserId, toId: currentUserId })]}
                allMessagesLoading={false}
            />
        );

        expect(playMock).toHaveBeenCalledTimes(1);
    });

    test('suppresses chime when muted', () => {
        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={false}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={false}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={false}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={false}
                currentUserId={currentUserId}
                allMessages={[makeMessage({ id: '2', fromId: otherUserId, toId: currentUserId })]}
                allMessagesLoading={false}
            />
        );

        expect(playMock).not.toHaveBeenCalled();
    });

    test('suppresses chime when app is not standalone', () => {
        window.matchMedia.mockReturnValue({ matches: false });

        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={false}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[makeMessage({ id: '3', fromId: otherUserId, toId: currentUserId })]}
                allMessagesLoading={false}
            />
        );

        expect(playMock).not.toHaveBeenCalled();
    });

    test('suppresses chime when document is not visible', () => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
        });

        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={false}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[makeMessage({ id: '4', fromId: otherUserId, toId: currentUserId })]}
                allMessagesLoading={false}
            />
        );

        expect(playMock).not.toHaveBeenCalled();
    });

    test('deduplicates chimes within one second', () => {
        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={false}
            />
        );

        const first = makeMessage({ id: '5', fromId: otherUserId, toId: currentUserId });
        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[first]}
                allMessagesLoading={false}
            />
        );
        expect(playMock).toHaveBeenCalledTimes(1);

        nowMs += 500;
        const second = makeMessage({ id: '6', fromId: otherUserId, toId: currentUserId });
        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[first, second]}
                allMessagesLoading={false}
            />
        );
        expect(playMock).toHaveBeenCalledTimes(1);

        nowMs += 1001;
        const third = makeMessage({ id: '7', fromId: otherUserId, toId: currentUserId });
        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[first, second, third]}
                allMessagesLoading={false}
            />
        );
        expect(playMock).toHaveBeenCalledTimes(2);
    });

    test('does not chime for new messages between other users', () => {
        const { rerender } = render(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={true}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[]}
                allMessagesLoading={false}
            />
        );

        rerender(
            <NotificationSoundRuntime
                soundEnabled={true}
                currentUserId={currentUserId}
                allMessages={[makeMessage({ id: '8', fromId: otherUserId, toId: thirdUserId })]}
                allMessagesLoading={false}
            />
        );

        expect(playMock).not.toHaveBeenCalled();
    });
});
