'use client';
import { useRef, useState } from 'react';
import { query, where, getDocs, limit, runTransaction } from 'firebase/firestore';
import { firestore } from '@/lib/firebase-client';
import { signOutCurrentUser } from '@/lib/sign-out';
import { getRosterNames, getRosterEmail } from '@/lib/participants';
import { yearCollectionRef, yearDocRef } from '@/lib/year-client';
import { useToast } from '@/components/ClientProviders';

/**
 * RecipientSelector - First-time user recipient selection flow for the open year
 *
 * @param {Object} props
 * @param {Object} props.currentUser - Current authenticated user
 * @param {string[]} props.availableRecipients - List of available recipient names
 * @param {number} props.year - The open year (selection happens in that year's users)
 * @param {Function} props.onComplete - Called after successful selection
 * @param {React.ReactNode} [props.adminControl] - Admin season control (Close/Start), if any
 * @param {Function|null} [props.onBrowseArchive] - Shows "Browse past years" when provided
 */
export default function RecipientSelector({
    currentUser,
    availableRecipients,
    year,
    onComplete,
    adminControl = null,
    onBrowseArchive = null
}) {
    const [recipientInput, setRecipientInput] = useState('');
    const [loading, setLoading] = useState(false);
    const submitLockRef = useRef(false);
    const { showToast } = useToast();

    const handleSetRecipient = async (e) => {
        e.preventDefault();
        if (!recipientInput || submitLockRef.current) return;

        submitLockRef.current = true;
        setLoading(true);

        try {
            // Validate recipient is on this year's roster
            const ALLOWED_RECIPIENTS = getRosterNames(year);
            const normalizedRecipientName = ALLOWED_RECIPIENTS.find(
                name => name.toLowerCase() === recipientInput.toLowerCase()
            );

            if (!normalizedRecipientName) {
                showToast('Invalid recipient. Please select from the list.');
                setLoading(false);
                return;
            }

            // Get the email for this recipient from this year's roster
            const recipientEmail = getRosterEmail(year, normalizedRecipientName);
            if (!recipientEmail) {
                showToast('Could not find email for this recipient.');
                setLoading(false);
                return;
            }

            // Find the recipient in this year's users by email
            const usersCollection = yearCollectionRef(year, 'users');
            const recipientQuery = query(usersCollection, where('email', '==', recipientEmail), limit(1));
            const recipientSnapshot = await getDocs(recipientQuery);

            if (recipientSnapshot.empty) {
                showToast('Recipient not found in database.');
                setLoading(false);
                return;
            }

            const recipientDoc = recipientSnapshot.docs[0];
            const recipient = recipientDoc.data();
            const recipientId = recipient.id || recipientDoc.id;
            const currentUserRef = yearDocRef(year, 'users', currentUser.id);
            const recipientRef = recipientDoc.ref;

            // Atomic recipient claim: prevents check-then-act race condition.
            await runTransaction(firestore, async (transaction) => {
                const currentUserSnapshot = await transaction.get(currentUserRef);
                if (!currentUserSnapshot.exists()) {
                    throw new Error('CURRENT_USER_NOT_FOUND');
                }

                const recipientSnapshot = await transaction.get(recipientRef);
                if (!recipientSnapshot.exists()) {
                    throw new Error('RECIPIENT_NOT_FOUND');
                }

                const currentUserData = currentUserSnapshot.data();
                const recipientData = recipientSnapshot.data();

                if (currentUserData.recipientId) {
                    throw new Error('RECIPIENT_ALREADY_SELECTED');
                }

                if (recipientData.gifterId) {
                    throw new Error('RECIPIENT_TAKEN');
                }

                transaction.update(currentUserRef, { recipientId });
                transaction.update(recipientRef, { gifterId: currentUser.id });
            });

            // Notify parent that selection is complete
            if (onComplete) {
                onComplete();
            }
        } catch (err) {
            console.error('Failed to set recipient:', err);
            if (err?.message === 'RECIPIENT_TAKEN') {
                showToast('This recipient has already been selected by someone else.');
            } else if (err?.message === 'RECIPIENT_ALREADY_SELECTED') {
                showToast('You already selected a recipient.');
            } else {
                showToast('Failed to set recipient: ' + err.message);
            }
        } finally {
            setLoading(false);
            submitLockRef.current = false;
        }
    };

    return (
        <main className="container" style={{ justifyContent: 'center', alignItems: 'center' }}>
            <div className="card login-card">
                <h1 className="title">Welcome, {currentUser.name}!</h1>
                <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                    Who are you buying a gift for?
                </p>
                <form onSubmit={handleSetRecipient}>
                    <select
                        className="input"
                        value={recipientInput}
                        onChange={e => setRecipientInput(e.target.value)}
                        required
                        style={{ width: '100%', padding: '10px' }}
                    >
                        <option value="">Select a recipient...</option>
                        {availableRecipients.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                    <button className="btn" disabled={loading}>
                        {loading ? 'Setting...' : 'Continue'}
                    </button>
                </form>

                {adminControl && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
                        {adminControl}
                    </div>
                )}

                {onBrowseArchive && (
                    <button
                        type="button"
                        onClick={() => onBrowseArchive()}
                        style={{
                            color: 'var(--primary)',
                            fontSize: '14px',
                            marginTop: '16px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            width: '100%'
                        }}
                    >
                        Browse past years
                    </button>
                )}

                <p className="text-muted" style={{ textAlign: 'center', marginTop: '12px', fontSize: '13px' }}>
                    {`${year} exchange`}
                </p>

                <button
                    onClick={() => {
                        signOutCurrentUser().catch((error) => console.error('Sign out error:', error));
                    }}
                    style={{
                        color: 'var(--text-muted)',
                        fontSize: '14px',
                        marginTop: '10px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        width: '100%'
                    }}
                >
                    Sign out
                </button>
            </div>
        </main>
    );
}
