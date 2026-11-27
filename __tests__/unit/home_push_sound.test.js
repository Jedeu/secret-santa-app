/**
 * @jest-environment jsdom
 *
 * Home (src/app/page.js): sound is a sub-setting of push notifications.
 * - NotificationSoundRuntime gets soundEnabled && pushOn, so with push off no chime can play
 *   even while the stored sound preference is on; the stored preference itself is kept.
 * - The "HI {NAME}" menu lists Push notifications, then "Sound on" only while push is
 *   effectively on, then Sign out.
 *
 * PushNotificationsControl is a stub that reports a test-controlled effective state through
 * the same onEffectiveChange callback the real control uses. Synthetic fixtures only.
 */

import Home from '@/app/page';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useUser } from '@/hooks/useUser';

const mockSoundProps = [];
const mockPush = { on: false, report: null };

jest.mock('@/hooks/useUser', () => ({
    useUser: jest.fn()
}));

jest.mock('@/components/NotificationSoundRuntime', () => {
    const MockNotificationSoundRuntime = (props) => {
        mockSoundProps.push(props);
        return null;
    };
    MockNotificationSoundRuntime.displayName = 'MockNotificationSoundRuntime';
    return MockNotificationSoundRuntime;
});

jest.mock('@/components/PushNotificationsControl', () => {
    const { useEffect } = jest.requireActual('react');
    const MockPushNotificationsControl = ({ onEffectiveChange }) => {
        mockPush.report = onEffectiveChange;
        useEffect(() => {
            onEffectiveChange?.(mockPush.on);
        }, [onEffectiveChange]);
        return <div role="switch" aria-checked={mockPush.on}>Push notifications</div>;
    };
    MockPushNotificationsControl.displayName = 'MockPushNotificationsControl';
    return MockPushNotificationsControl;
});

jest.mock('@/components/PushNotificationsRuntime', () => () => null);
jest.mock('@/components/MessageOutboxRuntime', () => () => null);

jest.mock('@/components/Chat', () => {
    const MockChat = () => <div data-testid="chat-component">Chat</div>;
    MockChat.displayName = 'MockChat';
    return MockChat;
});

jest.mock('@/components/PublicFeed', () => {
    const MockPublicFeed = () => <div data-testid="feed-component">Feed</div>;
    MockPublicFeed.displayName = 'MockPublicFeed';
    return MockPublicFeed;
});

jest.mock('@/hooks/useRealtimeMessages', () => ({
    useRealtimeAllMessages: jest.fn(() => []),
    useRealtimeAllMessagesLoading: jest.fn(() => false),
    useRealtimeAllMessagesSynced: jest.fn(() => true),
    useRealtimeAllReactions: jest.fn(() => []),
    useRealtimeUnreadCounts: jest.fn(() => ({ recipientUnread: 0, santaUnread: 0 }))
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    doc: jest.fn(),
    getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
    query: jest.fn(),
    where: jest.fn(),
    onSnapshot: jest.fn(() => jest.fn()),
    serverTimestamp: jest.fn()
}));

jest.mock('@/lib/sign-out', () => ({
    signOutCurrentUser: jest.fn(() => Promise.resolve())
}));

jest.mock('@/lib/config', () => ({
    ADMIN_EMAILS: [],
    isAdmin: () => false,
}));

const SEASON = { year: 2026, state: 'active', epoch: 2, closedYears: [] };
const USER = {
    id: 'user-a', name: 'Alpha', email: 'alpha@example.test',
    recipientId: 'user-b', gifterId: 'user-c'
};

function renderHome() {
    useUser.mockReturnValue({
        user: USER,
        authUid: 'uid-a',
        authEmail: USER.email,
        season: SEASON,
        loading: false,
        error: null,
        refreshUser: jest.fn(),
        acknowledgeReveal: jest.fn()
    });
    return render(<Home />);
}

const lastSoundProp = () => mockSoundProps[mockSoundProps.length - 1].soundEnabled;

// The bar renders twice (phone header and desktop sidebar); both are the same menu.
function openMenu() {
    fireEvent.click(screen.getAllByTestId('user-greeting')[0]);
    return screen.getAllByRole('menu', { name: 'Account' })[0];
}

describe('Home: sound is gated on push', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSoundProps.length = 0;
        mockPush.on = false;
        mockPush.report = null;
        window.localStorage.clear();
    });

    test('push off: no chime even though sound is stored as on, and the stored preference is kept', async () => {
        window.localStorage.setItem('soundEnabled', 'true');
        renderHome();

        await waitFor(() => expect(mockSoundProps.length).toBeGreaterThan(0));
        expect(lastSoundProp()).toBe(false);
        expect(window.localStorage.getItem('soundEnabled')).toBe('true');
    });

    test('push on: the chime follows the stored sound preference', async () => {
        mockPush.on = true;
        window.localStorage.setItem('soundEnabled', 'true');
        renderHome();

        await waitFor(() => expect(lastSoundProp()).toBe(true));
    });

    test('push on but sound stored off: no chime', async () => {
        mockPush.on = true;
        window.localStorage.setItem('soundEnabled', 'false');
        renderHome();

        await waitFor(() => expect(mockPush.report).not.toBeNull());
        expect(lastSoundProp()).toBe(false);
    });

    test('turning push off silences the chime; turning it back on restores the last sound choice', async () => {
        mockPush.on = true;
        window.localStorage.setItem('soundEnabled', 'true');
        renderHome();
        await waitFor(() => expect(lastSoundProp()).toBe(true));

        act(() => mockPush.report(false));
        expect(lastSoundProp()).toBe(false);

        act(() => mockPush.report(true));
        expect(lastSoundProp()).toBe(true);
    });
});

describe('Home: the HI {NAME} menu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSoundProps.length = 0;
        mockPush.on = false;
        mockPush.report = null;
        window.localStorage.clear();
    });

    test('the bar reads "Hi Alpha" (shown uppercase) and the menu starts closed', async () => {
        renderHome();
        await waitFor(() => expect(mockPush.report).not.toBeNull());
        expect(screen.getAllByTestId('user-greeting')[0]).toHaveTextContent('Hi Alpha');
        expect(screen.getAllByRole('button', { name: /hi alpha/i })[0]).toHaveAttribute('aria-expanded', 'false');
    });

    test('push off: the menu has Push notifications and Sign out, and no Sound row', async () => {
        renderHome();
        await waitFor(() => expect(mockPush.report).not.toBeNull());
        const menu = openMenu();

        const rows = [...menu.children].map((child) => child.textContent.trim());
        expect(rows).toEqual(['Push notifications', 'Sign out']);
        expect(screen.queryByRole('switch', { name: 'Sound on' })).not.toBeInTheDocument();
    });

    test('push on: "Sound on" appears between Push notifications and Sign out, and toggles the preference', async () => {
        mockPush.on = true;
        window.localStorage.setItem('soundEnabled', 'true');
        renderHome();
        await waitFor(() => expect(lastSoundProp()).toBe(true));
        const menu = openMenu();

        const rows = [...menu.children].map((child) => child.textContent.trim());
        expect(rows).toEqual(['Push notifications', 'Sound on', 'Sign out']);

        const sound = screen.getAllByRole('switch', { name: 'Sound on' })[0];
        expect(sound).toHaveAttribute('aria-checked', 'true');
        expect(menu).not.toHaveTextContent(/\bOn\b|\bOff\b/);

        fireEvent.click(sound);
        expect(sound).toHaveAttribute('aria-checked', 'false');
        expect(window.localStorage.getItem('soundEnabled')).toBe('false');
        expect(lastSoundProp()).toBe(false);
    });

    test('the Sound row disappears as soon as push turns off', async () => {
        mockPush.on = true;
        renderHome();
        await waitFor(() => expect(lastSoundProp()).toBe(true));
        openMenu();
        expect(screen.getAllByRole('switch', { name: 'Sound on' }).length).toBeGreaterThan(0);

        act(() => mockPush.report(false));
        expect(screen.queryByRole('switch', { name: 'Sound on' })).not.toBeInTheDocument();
    });
});
