import { authOptions } from '@/auth.config';
import * as firestore from '@/lib/firestore';

// Mock dependencies
jest.mock('@/lib/firestore');
jest.mock('next-auth/providers/google', () => jest.fn());
jest.mock('next-auth/providers/credentials', () => jest.fn());

describe('Auth Configuration - Pre-created Participants', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        // Restore original console.error
        console.error.mockRestore();
    });

    test('signIn callback updates existing participant with OAuth data', async () => {
        const { signIn } = authOptions.callbacks;

        const mockUser = {
            email: 'jed.piezas@gmail.com',
            name: 'Jed Piezas',
            image: 'http://image.com/jed'
        };
        const mockAccount = { providerAccountId: 'oauth123' };

        // Mock existing participant (pre-created, no OAuth data yet)
        const mockExistingUser = {
            id: 'jed-id',
            name: 'Jed',
            email: 'jed.piezas@gmail.com',
            oauthId: null,
            image: null,
            recipientId: null,
            gifterId: null
        };
        firestore.getUserByEmail.mockResolvedValue(mockExistingUser);
        firestore.updateUser.mockResolvedValue();

        const result = await signIn({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);
        expect(firestore.getUserByEmail).toHaveBeenCalledWith('jed.piezas@gmail.com');
        expect(firestore.updateUser).toHaveBeenCalledWith('jed-id', {
            oauthId: 'oauth123',
            image: 'http://image.com/jed',
            name: 'Jed Piezas'
        });
    });

    test('signIn callback rejects user not in participants list', async () => {
        const { signIn } = authOptions.callbacks;

        const mockUser = {
            email: 'unauthorized@example.com',
            name: 'Unauthorized User'
        };
        const mockAccount = { providerAccountId: '456' };

        // User not in participants list
        firestore.getUserByEmail.mockResolvedValue(null);

        const result = await signIn({ user: mockUser, account: mockAccount });

        expect(result).toBe(false);
        expect(firestore.updateUser).not.toHaveBeenCalled();
    });

    test('signIn callback does not update if OAuth data already set', async () => {
        const { signIn } = authOptions.callbacks;

        const mockUser = {
            email: 'jed.piezas@gmail.com',
            name: 'Jed Piezas',
            image: 'http://image.com/jed'
        };
        const mockAccount = { providerAccountId: 'oauth123' };

        // User already has OAuth data
        const mockExistingUser = {
            id: 'jed-id',
            oauthId: 'oauth123', // Already set
            image: 'http://image.com/jed'
        };
        firestore.getUserByEmail.mockResolvedValue(mockExistingUser);

        const result = await signIn({ user: mockUser, account: mockAccount });

        expect(result).toBe(true);
        expect(firestore.updateUser).not.toHaveBeenCalled(); // No update needed
    });

    test('signIn callback handles errors gracefully', async () => {
        const { signIn } = authOptions.callbacks;

        const mockUser = {
            email: 'jed.piezas@gmail.com',
            name: 'Jed'
        };
        const mockAccount = { providerAccountId: '123' };

        firestore.getUserByEmail.mockRejectedValue(new Error('Database error'));

        const result = await signIn({ user: mockUser, account: mockAccount });

        expect(result).toBe(false);
        // Ensure console.error was called
        expect(console.error).toHaveBeenCalled();
    });
});
