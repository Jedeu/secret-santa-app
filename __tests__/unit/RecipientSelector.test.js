/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RecipientSelector from '@/components/RecipientSelector';

const mockGetDocs = jest.fn();
const mockRunTransaction = jest.fn();
const mockDoc = jest.fn();

jest.mock('@/lib/firebase-client', () => ({
    firestore: {},
    clientAuth: {}
}));

jest.mock('firebase/auth', () => ({
    signOut: jest.fn()
}));

jest.mock('firebase/firestore', () => ({
    collection: jest.fn(() => ({ _type: 'collection' })),
    query: jest.fn(() => ({ _type: 'query' })),
    where: jest.fn(() => ({ _type: 'where' })),
    limit: jest.fn(() => ({ _type: 'limit' })),
    getDocs: (...args) => mockGetDocs(...args),
    doc: (...args) => mockDoc(...args),
    runTransaction: (...args) => mockRunTransaction(...args)
}));

describe('RecipientSelector transactional claim', () => {
    const currentUser = {
        id: 'user-1',
        name: 'Jed',
        email: 'jed.piezas@gmail.com'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        global.alert = jest.fn();
        global.confirm = jest.fn(() => true);

        mockDoc.mockImplementation((firestore, collectionName, id) => ({
            id,
            path: `${collectionName}/${id}`
        }));
    });

    it('uses a transaction to atomically set recipient and gifter', async () => {
        const recipientRef = { id: 'user-2', path: 'users/user-2' };
        mockGetDocs.mockResolvedValue({
            empty: false,
            docs: [
                {
                    ref: recipientRef,
                    id: 'user-2',
                    data: () => ({ id: 'user-2', gifterId: null })
                }
            ]
        });

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
                onComplete={onComplete}
            />
        );

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });

    it('shows recipient-taken message when transaction detects claim conflict', async () => {
        const recipientRef = { id: 'user-2', path: 'users/user-2' };
        mockGetDocs.mockResolvedValue({
            empty: false,
            docs: [
                {
                    ref: recipientRef,
                    id: 'user-2',
                    data: () => ({ id: 'user-2', gifterId: null })
                }
            ]
        });

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
            />
        );

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Louis' } });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => {
            expect(global.alert).toHaveBeenCalledWith('This recipient has already been selected by someone else.');
        });
    });
});
