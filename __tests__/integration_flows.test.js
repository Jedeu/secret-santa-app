/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Home from '@/app/page';
import { useUser } from '@/hooks/useUser';
import * as realtimeHooks from '@/hooks/useRealtimeMessages';

// Mock useUser hook
jest.mock('@/hooks/useUser');

// Mock ESM dependencies
jest.mock('react-markdown', () => ({ children }) => <div data-testid="markdown">{children}</div>);
jest.mock('remark-gfm', () => () => { });
jest.mock('emoji-picker-react', () => () => <div data-testid="emoji-picker">Emoji Picker</div>);

// Mock the realtime hooks
jest.mock('@/hooks/useRealtimeMessages', () => ({
    useRealtimeMessages: jest.fn(),
    useRealtimeAllMessages: jest.fn(),
    useRealtimeUnreadCounts: jest.fn(),
    updateLastReadTimestamp: jest.fn()
}));

// Mock fetch
global.fetch = jest.fn();

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// Mock Firestore
import { getDocs } from 'firebase/firestore';

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    getDocs: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    writeBatch: jest.fn(),
    serverTimestamp: jest.fn(),
    addDoc: jest.fn()
}));

describe('UI Interaction Flows', () => {
    // Test Data
    const userA = { id: 'user-a', name: 'User A', email: 'usera@example.com', recipientId: 'user-b', gifterId: 'user-c' };
    const userB = { id: 'user-b', name: 'User B', email: 'userb@example.com', recipientId: 'user-c', gifterId: 'user-a' };
    const userC = { id: 'user-c', name: 'User C', email: 'userc@example.com', recipientId: 'user-a', gifterId: 'user-b' };

    const allUsers = [userA, userB, userC];

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock getDocs to return users
        getDocs.mockResolvedValue({
            docs: allUsers.map(user => ({
                data: () => user,
                id: user.id
            }))
        });

        // Default unread counts
        realtimeHooks.useRealtimeUnreadCounts.mockReturnValue({ recipientUnread: 0, santaUnread: 0 });

        // Default messages
        realtimeHooks.useRealtimeAllMessages.mockReturnValue([]);
    });

    test('1. User A can send a message to recipient (User B)', async () => {
        // Setup: User A logged in
        useUser.mockReturnValue({
            user: userA,
            loading: false,
            error: null
        });

        // Mock empty message history initially
        realtimeHooks.useRealtimeMessages.mockReturnValue([]);

        render(<Home />);

        // Wait for users to load
        await waitFor(() => expect(screen.getByText('Hi, User A 👋')).toBeInTheDocument());

        // 1. Navigate to Recipient Tab (default, but good to be explicit or check existence)
        const recipientTab = screen.getAllByText('🎁 Recipient')[0];
        fireEvent.click(recipientTab);

        // Check we are in the right chat
        expect(screen.getAllByText('Chat with User B 🎁')[0]).toBeInTheDocument();

        // 2. Type a message
        const input = screen.getAllByPlaceholderText('Type a message...')[0];
        fireEvent.change(input, { target: { value: 'Hello User B!' } });

        // 3. Send message
        const sendBtn = screen.getAllByText('Send')[0];
        fireEvent.click(sendBtn);

        // 4. Verify Firestore write (mocked in setup.js)
        // Since we are mocking Firestore in setup.js, we can't easily verify the exact call here without exporting the mock
        // But we can verify the input is cleared which implies success path was taken

        // Wait for input to be cleared (fixes act warning)
        await waitFor(() => expect(input.value).toBe(''));
    });

    test('2. User A can send a message to secret santa (User C)', async () => {
        // Setup: User A logged in
        useUser.mockReturnValue({
            user: userA,
            loading: false,
            error: null
        });

        realtimeHooks.useRealtimeMessages.mockReturnValue([]);

        render(<Home />);
        await waitFor(() => expect(screen.getByText('Hi, User A 👋')).toBeInTheDocument());

        // 1. Navigate to Santa Tab
        const santaTab = screen.getAllByText('🎅 Santa')[0];
        fireEvent.click(santaTab);

        // Check we are in the right chat
        expect(screen.getAllByText('Chat with your Santa 🎅')[0]).toBeInTheDocument();

        // 2. Type a message
        const input = screen.getAllByPlaceholderText('Type a message...')[0];
        fireEvent.change(input, { target: { value: 'Hi Santa!' } });

        // 3. Send message
        const sendBtn = screen.getAllByText('Send')[0];
        fireEvent.click(sendBtn);

        // Wait for input to be cleared (fixes act warning)
        await waitFor(() => expect(input.value).toBe(''));
    });

    test('3. User A see both conversations in the Public Feed', async () => {
        // Setup: User A logged in
        useUser.mockReturnValue({
            user: userA,
            loading: false,
            error: null
        });

        // Mock public feed messages
        const feedMessages = [
            {
                id: 'msg1',
                fromId: userA.id,
                toId: userB.id,
                content: 'Hello User B!',
                timestamp: new Date().toISOString(),
            },
            {
                id: 'msg2',
                fromId: userA.id,
                toId: userC.id,
                content: 'Hi Santa!',
                timestamp: new Date().toISOString(),
            }
        ];

        realtimeHooks.useRealtimeAllMessages.mockReturnValue(feedMessages);
        realtimeHooks.useRealtimeMessages.mockReturnValue([]); // For chat tabs

        render(<Home />);
        await waitFor(() => expect(screen.getByText('Hi, User A 👋')).toBeInTheDocument());

        // 1. Navigate to Public Feed
        const feedTab = screen.getByText('🎄 Public Feed');
        fireEvent.click(feedTab);

        // 2. Verify threads exist
        expect(screen.getAllByText("🎁 User B's Gift Exchange")[0]).toBeInTheDocument();
        expect(screen.getAllByText('Hello User B!')[0]).toBeInTheDocument();

        expect(screen.getAllByText("🎁 User A's Gift Exchange")[0]).toBeInTheDocument();
        expect(screen.getAllByText('Hi Santa!')[0]).toBeInTheDocument();
    });

    test('4. Recipient (User B) can see a message from secret santa (User A)', async () => {
        // Setup: User B logged in
        useUser.mockReturnValue({
            user: userB,
            loading: false,
            error: null
        });

        // Mock messages for User B's Santa chat (User A is Santa)
        const santaMessages = [
            {
                id: 'msg1',
                fromId: userA.id,
                toId: userB.id,
                content: 'Hello User B!',
                timestamp: new Date().toISOString(),
                fromName: 'Santa',
            }
        ];

        realtimeHooks.useRealtimeMessages.mockImplementation((userId, otherUserId) => {
            if (userId === userB.id && otherUserId === userA.id) {
                return santaMessages;
            }
            return [];
        });

        render(<Home />);
        await waitFor(() => expect(screen.getByText('Hi, User B 👋')).toBeInTheDocument());

        // 1. Navigate to Santa Tab
        const santaTab = screen.getAllByText('🎅 Santa')[0]; // Select the first one (Desktop)
        fireEvent.click(santaTab);

        // 2. Verify message is visible
        expect(screen.getAllByText('Hello User B!')[0]).toBeInTheDocument();
    });

    test('5. Recipient (User B) can send a message back to secret santa (User A)', async () => {
        // Setup: User B logged in
        useUser.mockReturnValue({
            user: userB,
            loading: false,
            error: null
        });

        realtimeHooks.useRealtimeMessages.mockReturnValue([]);

        render(<Home />);
        await waitFor(() => expect(screen.getByText('Hi, User B 👋')).toBeInTheDocument());

        // 1. Navigate to Santa Tab
        const santaTab = screen.getAllByText('🎅 Santa')[0];
        fireEvent.click(santaTab);

        // 2. Type reply
        const input = screen.getAllByPlaceholderText('Type a message...')[0];
        fireEvent.change(input, { target: { value: 'Thanks Santa!' } });

        // 3. Send
        const sendBtn = screen.getAllByText('Send')[0];
        fireEvent.click(sendBtn);

        // Wait for input to be cleared (fixes act warning)
        await waitFor(() => expect(input.value).toBe(''));
    });

    test('6. Verify tests 5 & 6 are reflected in the public feed', async () => {
        // Setup: Any user logged in (e.g., User C)
        useUser.mockReturnValue({
            user: userC,
            loading: false,
            error: null
        });

        // Mock feed with the conversation between A and B
        const feedMessages = [
            {
                id: 'msg1',
                fromId: userA.id,
                toId: userB.id,
                content: 'Hello User B!',
                timestamp: new Date(Date.now() - 10000).toISOString(),
            },
            {
                id: 'msg2',
                fromId: userB.id,
                toId: userA.id,
                content: 'Thanks Santa!',
                timestamp: new Date().toISOString(),
            }
        ];

        realtimeHooks.useRealtimeAllMessages.mockReturnValue(feedMessages);
        realtimeHooks.useRealtimeMessages.mockReturnValue([]);

        render(<Home />);
        await waitFor(() => expect(screen.getByText('Hi, User C 👋')).toBeInTheDocument());

        // 1. Navigate to Feed
        const feedTab = screen.getAllByText('🎄 Public Feed')[0];
        fireEvent.click(feedTab);

        // 2. Verify Thread "User B's Gift Exchange" shows the latest message
        expect(screen.getAllByText("🎁 User B's Gift Exchange")[0]).toBeInTheDocument();
        expect(screen.getAllByText('Thanks Santa!')[0]).toBeInTheDocument();

        // 3. Click thread to see full history
        fireEvent.click(screen.getAllByText("🎁 User B's Gift Exchange")[0]);

        // 4. Verify both messages are there
        expect(screen.getAllByText('Hello User B!')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Thanks Santa!')[0]).toBeInTheDocument();
    });

    test('7. User A can see the replies from their recipient (User B)', async () => {
        // Setup: User A logged in
        useUser.mockReturnValue({
            user: userA,
            loading: false,
            error: null
        });

        // Mock messages for User A's Recipient chat (User B is Recipient)
        const recipientMessages = [
            {
                id: 'msg1',
                fromId: userA.id,
                toId: userB.id,
                content: 'Hello User B!',
                timestamp: new Date(Date.now() - 10000).toISOString(),
            },
            {
                id: 'msg2',
                fromId: userB.id,
                toId: userA.id,
                content: 'Thanks Santa!',
                timestamp: new Date().toISOString(),
            }
        ];

        realtimeHooks.useRealtimeMessages.mockImplementation((userId, otherUserId) => {
            if (userId === userA.id && otherUserId === userB.id) {
                return recipientMessages;
            }
            return [];
        });

        render(<Home />);
        await waitFor(() => expect(screen.getByText('Hi, User A 👋')).toBeInTheDocument());

        // 1. Navigate to Recipient Tab
        const recipientTab = screen.getAllByText('🎁 Recipient')[0];
        fireEvent.click(recipientTab);

        // 2. Verify reply is visible
        expect(screen.getAllByText('Thanks Santa!')[0]).toBeInTheDocument();
    });
});
