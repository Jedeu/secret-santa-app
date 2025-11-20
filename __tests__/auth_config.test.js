import { authOptions } from '@/auth.config';
import * as firestore from '@/lib/firestore';

// Mock dependencies
jest.mock('@/lib/firestore');
jest.mock('next-auth/providers/google', () => jest.fn());
jest.mock('next-auth/providers/credentials', () => jest.fn());

describe('Auth Configuration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('signIn callback claims placeholder account', async () => {
        const { signIn } = authOptions.callbacks;

        const mockUser = {
            email: 'natalie@example.com',
            name: 'Natalie',
            image: 'http://image.com/natalie'
        };
        const mockAccount = { providerAccountId: '123' };

        // 1. getUserByEmail returns null (no account with this email yet)
        firestore.getUserByEmail.mockResolvedValue(null);

        // 2. getUsersByName returns a placeholder user (no email)
        const mockPlaceholder = {
            id: 'placeholder-id',
            name: 'Natalie',
            email: null,
            recipientId: null,
            gifterId: 'jed-id'
        };
        firestore.getUsersByName.mockResolvedValue(mockPlaceholder);

        // 3. updateUser should be called
        firestore.updateUser.mockResolvedValue();

        await signIn({ user: mockUser, account: mockAccount });

        expect(firestore.getUserByEmail).toHaveBeenCalledWith('natalie@example.com');
        expect(firestore.getUsersByName).toHaveBeenCalledWith('Natalie');
        expect(firestore.updateUser).toHaveBeenCalledWith('placeholder-id', expect.objectContaining({
            email: 'natalie@example.com',
            oauthId: '123',
            image: 'http://image.com/natalie'
        }));
        expect(firestore.createUser).not.toHaveBeenCalled();
    });

    test('signIn callback creates new user if no placeholder', async () => {
        const { signIn } = authOptions.callbacks;

        const mockUser = {
            email: 'new@example.com',
            name: 'New User',
        };
        const mockAccount = { providerAccountId: '456' };

        firestore.getUserByEmail.mockResolvedValue(null);
        firestore.getUsersByName.mockResolvedValue(null); // No placeholder
        firestore.createUser.mockResolvedValue();

        await signIn({ user: mockUser, account: mockAccount });

        expect(firestore.createUser).toHaveBeenCalled();
        expect(firestore.updateUser).not.toHaveBeenCalled();
    });
});
