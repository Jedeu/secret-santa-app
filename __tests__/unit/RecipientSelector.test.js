/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecipientSelector from '@/components/RecipientSelector';

const mockGetDocs = jest.fn();
const mockRunTransaction = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@/lib/firebase-client', () => ({
    firestore: {},
    clientAuth: {}
}));

jest.mock('firebase/auth', () => ({
    signOut: jest.fn()
}));

jest.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    query: jest.fn(() => ({ _type: 'query' })),
    where: jest.fn(() => ({ _type: 'where' })),
    limit: jest.fn(() => ({ _type: 'limit' })),
    getDocs: (...args) => mockGetDocs(...args),
    doc: (...args) => mockDoc(...args),
    runTransaction: (...args) => mockRunTransaction(...args)
}));

// Synthetic rosters (no real participant data).
jest.mock('@/lib/participants', () => {
    const rosters = {
        2025: [
            { name: 'Ann', email: 'ann@example.test' },
            { name: 'Louis', email: 'louis@example.test' },
        ],
        2026: [
            { name: 'Ann', email: 'ann@example.test' },
            { name: 'Louis', email: 'louis-2026@example.test' },
        ],
    };
    return {
        getRosterNames: (year) => (rosters[year] || []).map((p) => p.name),
        getRosterEmail: (year, name) => {
            const found = (rosters[year] || []).find((p) => p.name.toLowerCase() === String(name).toLowerCase());
            return found ? found.email : null;
        },
    };
});

jest.mock('@/components/ClientProviders', () => ({
    useToast: () => ({ showToast: mockShowToast })
}));

jest.mock('@/lib/sign-out', () => ({
    signOutCurrentUser: jest.fn(() => Promise.resolve())
}));

import { where } from 'firebase/firestore';

describe('RecipientSelector transactional claim', () => {
    const currentUser = {
        id: 'user-1',
        name: 'Ann',
        email: 'ann@example.test'
    };

    function recipientSnapshot(path = 'users/user-2') {
        const recipientRef = { id: 'user-2', path };
        return {
            recipientRef,
            snapshot: {
                empty: false,
                docs: [
                    {
                        ref: recipientRef,
                        id: 'user-2',
                        data: () => ({ id: 'user-2', gifterId: null })
                    }
                ]
            }
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        global.confirm = jest.fn(() => true);

        mockDoc.mockImplementation((firestore, ...segments) => ({
            id: segments[segments.length - 1],
            path: segments.join('/')
        }));
        mockCollection.mockImplementation((firestore, ...segments) => ({ path: segments.join('/') }));
    });

    it('uses a transaction to atomically set recipient and gifter', async () => {
        const { recipientRef, snapshot } = recipientSnapshot();
        mockGetDocs.mockResolvedValue(snapshot);

        mockRunTransaction.mockImplementation(async (_db, transactionFn) => {
            const tx = {
                get: jest.fn(async (ref) => {
                    if (ref.id === 'user-1') {
                        return { exists: () => true, data: () => ({ id: 'user-1', recipientId: null }) };
                    }
                    if (ref.id === 'user-2') {
                        return { exists: () => true, data: () => ({ id: 'user-2', gifterId: null }) };
                    }
                    return { exists: () => false, data: () => ({}) };
                }),
                update: jest.fn()
            };

            await transactionFn(tx);

            expect(tx.update).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'user-1' }),
                { recipientId: 'user-2' }
            );
            expect(tx.update).toHaveBeenCalledWith(recipientRef, { gifterId: 'user-1' });
        });

        const onComplete = jest.fn();
        render(
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={['Louis']}
                year={2025}
                onComplete={onComplete}
            />
        );

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });

    it('shows recipient-taken message when transaction detects claim conflict', async () => {
        const { snapshot } = recipientSnapshot();
        mockGetDocs.mockResolvedValue(snapshot);

        mockRunTransaction.mockImplementation(async (_db, transactionFn) => {
            const tx = {
                get: jest.fn(async (ref) => {
                    if (ref.id === 'user-1') {
                        return { exists: () => true, data: () => ({ id: 'user-1', recipientId: null }) };
                    }
                    if (ref.id === 'user-2') {
                        return { exists: () => true, data: () => ({ id: 'user-2', gifterId: 'already-set' }) };
                    }
                    return { exists: () => false, data: () => ({}) };
                }),
                update: jest.fn()
            };

            await transactionFn(tx);
        });

        render(
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={['Louis']}
                year={2025}
            />
        );

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('This recipient has already been selected by someone else.');
        });
    });

    it('guards against fast double-submit before loading state propagates', async () => {
        const { snapshot } = recipientSnapshot();
        mockGetDocs.mockResolvedValue(snapshot);

        let resolveTransaction;
        mockRunTransaction.mockImplementation(() => new Promise((resolve) => {
            resolveTransaction = resolve;
        }));

        render(
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={['Louis']}
                year={2025}
            />
        );

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        const continueButton = screen.getByRole('button', { name: 'Continue' });

        fireEvent.click(continueButton);
        fireEvent.click(continueButton);

        await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));

        resolveTransaction();
        await waitFor(() => expect(continueButton).not.toBeDisabled());
    });

    it('2025 uses the root users collection', async () => {
        const { snapshot } = recipientSnapshot();
        mockGetDocs.mockResolvedValue(snapshot);
        mockRunTransaction.mockResolvedValue(undefined);

        render(<RecipientSelector currentUser={currentUser} availableRecipients={['Louis']} year={2025} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));
        expect(mockCollection).toHaveBeenCalledWith({}, 'users');
        expect(mockDoc).toHaveBeenCalledWith({}, 'users', 'user-1');
        expect(where).toHaveBeenCalledWith('email', '==', 'louis@example.test');
        expect(screen.getByText('2025 exchange')).toBeInTheDocument();
    });

    it('2026 uses the years/2026 users collection and the 2026 roster', async () => {
        const { snapshot } = recipientSnapshot('years/2026/users/user-2');
        mockGetDocs.mockResolvedValue(snapshot);
        mockRunTransaction.mockResolvedValue(undefined);

        render(<RecipientSelector currentUser={currentUser} availableRecipients={['Louis']} year={2026} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));
        expect(mockCollection).toHaveBeenCalledWith({}, 'years', '2026', 'users');
        expect(mockCollection).not.toHaveBeenCalledWith({}, 'users');
        expect(mockDoc).toHaveBeenCalledWith({}, 'years', '2026', 'users', 'user-1');
        expect(where).toHaveBeenCalledWith('email', '==', 'louis-2026@example.test');
        expect(screen.getByText('2026 exchange')).toBeInTheDocument();
    });

    it('renders a supplied adminControl and no reset button', () => {
        render(
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={[]}
                year={2025}
                adminControl={<button type="button">Close 2025</button>}
            />
        );

        expect(screen.getByRole('button', { name: 'Close 2025' })).toBeInTheDocument();
        expect(screen.queryByText(/Reset/)).not.toBeInTheDocument();
    });

    it('"Browse past years" appears only with onBrowseArchive and calls it', () => {
        const { rerender } = render(
            <RecipientSelector currentUser={currentUser} availableRecipients={[]} year={2026} />
        );
        expect(screen.queryByRole('button', { name: 'Browse past years' })).not.toBeInTheDocument();

        const onBrowseArchive = jest.fn();
        rerender(
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={[]}
                year={2026}
                onBrowseArchive={onBrowseArchive}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Browse past years' }));

        expect(onBrowseArchive).toHaveBeenCalledTimes(1);
    });
});
