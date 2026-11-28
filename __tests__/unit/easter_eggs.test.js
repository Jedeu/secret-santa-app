/** @jest-environment jsdom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import {
    PLAIN_SANTA_TYPING,
    SANTA_TYPING_VARIANTS,
    pickSantaTypingLine,
    findMagicEffects,
    isChristmasDay,
    readDevEggOverrides,
    onEasterEgg,
    triggerEasterEgg,
} from '@/lib/easter-eggs';
import MagicWordsRuntime from '@/components/MagicWordsRuntime';
import Chat from '@/components/Chat';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { getCachedTimestamp, getRemoteTimestamp } from '@/lib/lastReadClient';

jest.mock('@/lib/lastReadClient', () => ({
    getCachedTimestamp: jest.fn(),
    getRemoteTimestamp: jest.fn()
}));

jest.mock('@/hooks/useRealtimeMessages', () => ({
    updateLastReadTimestamp: jest.fn(),
    useOtherUserLastRead: jest.fn(() => null)
}));
jest.mock('@/hooks/useTypingIndicator', () => ({
    useTypingIndicator: jest.fn(() => false)
}));
jest.mock('@/lib/typing-client', () => ({ setTyping: jest.fn(), clearTyping: jest.fn() }));
jest.mock('@/components/ClientProviders', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/lib/message-outbox', () => ({
    enqueueMessage: jest.fn(),
    getConversationOutboxMessages: jest.fn(() => []),
    subscribeOutbox: jest.fn(() => jest.fn()),
    drainOutboxForUser: jest.fn(() => Promise.resolve({})),
    retryOutboxMessage: jest.fn(() => true),
    createClientMessageId: jest.fn(() => 'client-id')
}));
jest.mock('react-markdown', () => {
    const MockReactMarkdown = ({ children }) => <div>{children}</div>;
    MockReactMarkdown.displayName = 'MockReactMarkdown';
    return MockReactMarkdown;
});
jest.mock('remark-gfm', () => () => { });
jest.mock('emoji-picker-react', () => () => null);

window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Santa typing line', () => {
    it('is plain unless the roll lands in the variant band, and then picks a variant', () => {
        expect(pickSantaTypingLine(() => 0.25)).toBe(PLAIN_SANTA_TYPING);
        expect(pickSantaTypingLine(() => 0.99)).toBe(PLAIN_SANTA_TYPING);
        const rolls = [0.1, 0.999];
        expect(pickSantaTypingLine(() => rolls.shift())).toBe(SANTA_TYPING_VARIANTS[SANTA_TYPING_VARIANTS.length - 1]);
    });

    function renderChat(isSantaChat) {
        const element = (
            <Chat
                currentUser={{ id: 'me', name: 'Me' }}
                authUid="uid-1"
                otherUser={isSantaChat ? { id: 'santa', name: 'Santa' } : { id: 'rec', name: 'Robin' }}
                isSantaChat={isSantaChat}
                unreadCount={0}
                messages={[]}
                conversationId={isSantaChat ? 'santa_santa_recipient_me' : 'santa_me_recipient_rec'}
            />
        );
        const view = render(element);
        return { ...view, rerenderSame: () => view.rerender(element) };
    }

    it('keeps one line per typing session on the Santa tab and picks again for the next', () => {
        const random = jest.spyOn(Math, 'random').mockReturnValue(0.1);
        useTypingIndicator.mockReturnValue(true);
        const view = renderChat(true);
        const first = SANTA_TYPING_VARIANTS[0];
        expect(screen.getByText(first)).toBeInTheDocument();

        // Re-renders within the session keep the line even if the roll would change.
        random.mockReturnValue(0.9);
        view.rerenderSame();
        expect(screen.getByText(first)).toBeInTheDocument();

        useTypingIndicator.mockReturnValue(false);
        view.unmount();
        useTypingIndicator.mockReturnValue(true);
        renderChat(true);
        expect(screen.getByText(PLAIN_SANTA_TYPING)).toBeInTheDocument();
        random.mockRestore();
    });

    it('never uses a variant on the Recipient tab', () => {
        const random = jest.spyOn(Math, 'random').mockReturnValue(0);
        useTypingIndicator.mockReturnValue(true);
        renderChat(false);
        expect(screen.getByText('Robin is typing...')).toBeInTheDocument();
        random.mockRestore();
    });
});

describe('magic words', () => {
    it('finds each phrase in any case and spacing, and nothing else', () => {
        expect(findMagicEffects('Let  it SNOW please')).toEqual(['snow']);
        expect(findMagicEffects('Ho, ho, ho!')).toEqual(['jingle']);
        expect(findMagicEffects('merry Christmas and let it snow')).toEqual(['snow', 'confetti']);
        expect(findMagicEffects('Merry Xmas')).toEqual(['confetti']);
        expect(findMagicEffects('snowfall, hoho, merry')).toEqual([]);
        expect(findMagicEffects('outlet it snowed')).toEqual([]);
        expect(findMagicEffects(null)).toEqual([]);
    });
});

describe('Christmas Day', () => {
    it('is December 25 by the local date only', () => {
        expect(isChristmasDay(new Date(2026, 11, 25, 0, 0))).toBe(true);
        expect(isChristmasDay(new Date(2026, 11, 25, 23, 59))).toBe(true);
        expect(isChristmasDay(new Date(2026, 11, 24, 23, 59))).toBe(false);
        expect(isChristmasDay(new Date(2026, 11, 26, 0, 0))).toBe(false);
        expect(isChristmasDay(new Date(2026, 10, 25))).toBe(false);
    });

    it('honours ?xmas=1 only in development', () => {
        expect(readDevEggOverrides('?xmas=1', 'development')).toEqual({ christmas: true });
        expect(readDevEggOverrides('?xmas=1', 'production')).toEqual({ christmas: false });
        expect(readDevEggOverrides('?xmas=1', 'test')).toEqual({ christmas: false });
        expect(readDevEggOverrides('', 'development')).toEqual({ christmas: false });
    });
});

describe('MagicWordsRuntime', () => {
    const conversation = 'santa_a_recipient_b';
    const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
    const msg = (id, content, fromId = 'a', msAgo = 1000) => ({ id, fromId, toId: 'b', content, timestamp: at(msAgo), conversationId: conversation });
    let fired;
    let unsubscribe;
    let play;

    beforeEach(() => {
        fired = [];
        unsubscribe = onEasterEgg((effect) => fired.push(effect));
        play = jest.fn(() => Promise.resolve());
        global.Audio = jest.fn(() => ({ play }));
        // Viewer 'b' read everything up to now unless a test says otherwise.
        getCachedTimestamp.mockReturnValue(at(0));
        getRemoteTimestamp.mockReturnValue(undefined);
    });
    afterEach(() => {
        unsubscribe();
        delete global.Audio;
    });

    function renderRuntime(props) {
        let current = { chatKey: conversation, viewerId: 'b', messages: [], loading: false, soundOn: true, ...props };
        const view = render(<MagicWordsRuntime {...current} />);
        return {
            update: (next) => {
                current = { ...current, ...next };
                view.rerender(<MagicWordsRuntime {...current} />);
            },
        };
    }

    it('stays silent for the loaded history and fires for new live messages from either side', () => {
        const history = [msg('1', 'let it snow'), msg('2', 'merry christmas')];
        const { update } = renderRuntime({ loading: true, messages: [] });
        update({ loading: false, messages: history });
        expect(fired).toEqual([]);

        update({ messages: [...history, msg('3', 'Merry Christmas!', 'b')] });
        expect(fired).toEqual(['confetti']);

        update({ messages: [...history, msg('3', 'Merry Christmas!', 'b'), msg('4', 'let it snow', 'a')] });
        expect(fired).toEqual(['confetti', 'snow']);
    });

    it('never fires on opening or switching chats with nothing unread, or outside a chat', () => {
        const { update } = renderRuntime({ chatKey: null, messages: [msg('1', 'let it snow')] });
        update({ chatKey: conversation, messages: [msg('1', 'let it snow')] });
        update({ chatKey: 'santa_b_recipient_c', messages: [msg('2', 'let it snow')] });
        update({ chatKey: null, messages: [] });
        expect(fired).toEqual([]);
    });

    it('stays silent when the server fills in history the cache lacked, however recent', () => {
        // `loading` stays true until the server confirms the list (page.js passes
        // allMessagesLoading || !allMessagesSynced): an empty cache, then the server adds a
        // message sent 5 s before opening.
        const { update } = renderRuntime({ loading: true, messages: [] });
        update({ loading: false, messages: [msg('earlier', 'merry christmas', 'b', 5 * 1000)] });
        expect(fired).toEqual([]);
        update({ messages: [msg('earlier', 'merry christmas', 'b', 5 * 1000), msg('live', 'let it snow', 'b', 0)] });
        expect(fired).toEqual(['snow']);
    });

    it('replays unread magic words once on opening, read before the chat moves the marker', () => {
        getCachedTimestamp.mockReturnValue(at(10 * 1000));
        const history = [
            msg('read', 'let it snow', 'a', 20 * 1000),
            msg('u1', 'let it snow', 'a', 5 * 1000),
            msg('u2', 'Let it snow!!', 'a', 4 * 1000),
            msg('u3', 'merry xmas', 'a', 3 * 1000),
            { ...msg('mine', 'ho ho ho', 'b', 2 * 1000), toId: 'a' },
        ];
        const { update } = renderRuntime({ loading: true, messages: history.slice(0, 2) });
        // Chat's mount effect advances the marker before the server confirms the list.
        getCachedTimestamp.mockReturnValue(at(0));
        update({ loading: false, messages: history });
        expect(fired).toEqual(['snow', 'confetti']);
        expect(global.Audio).not.toHaveBeenCalled();

        // Reopening never replays them, even with the marker unchanged.
        getCachedTimestamp.mockReturnValue(at(10 * 1000));
        update({ chatKey: null, messages: [] });
        update({ chatKey: conversation, messages: history });
        expect(fired).toEqual(['snow', 'confetti']);
    });

    it('on a cold start replays against the marker Firestore reports, and stays quiet until it is known', () => {
        getCachedTimestamp.mockReturnValue(undefined);
        const history = [msg('read', 'merry christmas', 'a', 20 * 1000), msg('u1', 'let it snow', 'a', 5 * 1000)];
        const { update } = renderRuntime({ loading: true, messages: [] });
        getRemoteTimestamp.mockReturnValue(at(10 * 1000));
        update({ loading: false, messages: history });
        expect(fired).toEqual(['snow']);

        getRemoteTimestamp.mockReturnValue(undefined);
        const other = renderRuntime({ chatKey: 'santa_b_recipient_c', loading: true, messages: [] });
        other.update({ loading: false, messages: [{ ...msg('u9', 'let it snow', 'c', 1000), conversationId: 'santa_b_recipient_c' }] });
        expect(fired).toEqual(['snow']);
    });

    it('plays the jingle only while sound is on', () => {
        const { update } = renderRuntime({ soundOn: false, messages: [] });
        update({ messages: [msg('1', 'ho ho ho')] });
        expect(global.Audio).not.toHaveBeenCalled();
        update({ soundOn: true, messages: [msg('1', 'ho ho ho'), msg('2', 'HO HO HO')] });
        expect(global.Audio).toHaveBeenCalledWith('/sounds/jingle.wav');
        expect(play).toHaveBeenCalledTimes(1);
        expect(fired).toEqual([]);
    });
});

describe('event bus', () => {
    it('delivers known effects and drops unknown ones', () => {
        const seen = [];
        const off = onEasterEgg((effect) => seen.push(effect));
        act(() => {
            triggerEasterEgg('grinch');
            triggerEasterEgg('fireworks');
        });
        off();
        triggerEasterEgg('snow');
        expect(seen).toEqual(['grinch']);
    });
});
