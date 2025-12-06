'use client';
import { useState } from 'react';
import { collection, query, where, getDocs, limit, writeBatch } from 'firebase/firestore';
import { firestore } from '@/lib/firebase-client';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase-client';
import { getParticipantNames, getParticipantEmail } from '@/lib/participants';
import { isAdmin } from '@/lib/config';

/**
 * RecipientSelector - First-time user recipient selection flow
 *
 * @param {Object} props
 * @param {Object} props.currentUser - Current authenticated user
 * @param {string[]} props.availableRecipients - List of available recipient names
 * @param {Function} props.onComplete - Called after successful selection
 * @param {Function} [props.onReset] - Called after successful reset (optional)
 */
export default function RecipientSelector({ currentUser, availableRecipients, onComplete, onReset }) {
    const [recipientInput, setRecipientInput] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSetRecipient = async (e) => {
        e.preventDefault();
        if (!recipientInput) return;
        setLoading(true);

        try {
            // Validate recipient is in the allowed list
            const ALLOWED_RECIPIENTS = getParticipantNames();
            const normalizedRecipientName = ALLOWED_RECIPIENTS.find(
                name => name.toLowerCase() === recipientInput.toLowerCase()
            );

            if (!normalizedRecipientName) {
                alert('Invalid recipient. Please select from the list.');
                setLoading(false);
                return;
            }

            // Get the email for this recipient from the hardcoded list
            const recipientEmail = getParticipantEmail(normalizedRecipientName);
            if (!recipientEmail) {
                alert('Could not find email for this recipient.');
                setLoading(false);
                return;
            }

            // Find the recipient in Firestore by email
            const usersCollection = collection(firestore, 'users');
            const recipientQuery = query(usersCollection, where('email', '==', recipientEmail), limit(1));
            const recipientSnapshot = await getDocs(recipientQuery);

            if (recipientSnapshot.empty) {
                alert('Recipient not found in database.');
                setLoading(false);
                return;
            }

            const recipientDoc = recipientSnapshot.docs[0];
            const recipient = recipientDoc.data();

            // Check if recipient is already taken
            if (recipient.gifterId) {
                alert('This recipient has already been selected by someone else.');
                setLoading(false);
                return;
            }

            // Update both users - find current user's document
            const currentUserQuery = query(usersCollection, where('id', '==', currentUser.id), limit(1));
            const currentUserSnapshot = await getDocs(currentUserQuery);

            if (currentUserSnapshot.empty) {
                alert('Current user not found in database.');
                setLoading(false);
                return;
            }

            const currentUserDoc = currentUserSnapshot.docs[0];

            // Perform batch update
            const batch = writeBatch(firestore);
            batch.update(currentUserDoc.ref, { recipientId: recipient.id });
            batch.update(recipientDoc.ref, { gifterId: currentUser.id });
            await batch.commit();

            // Notify parent that selection is complete
            if (onComplete) {
                onComplete();
            }
        } catch (err) {
            console.error('Failed to set recipient:', err);
            alert('Failed to set recipient: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async () => {
        if (!confirm('WARNING: This will delete ALL data (users, messages, assignments). This cannot be undone. Are you sure?')) return;

        try {
            const token = await clientAuth.currentUser.getIdToken();
            const res = await fetch('/api/admin/reset', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                alert('System reset successfully.');
                if (onReset) {
                    onReset();
                }
            } else {
                const error = await res.json();
                alert(`Failed to reset system: ${error.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Reset error:', err);
            alert('Failed to reset system.');
        }
    };

    return (
        <main className="container" style={{ justifyContent: 'center' }}>
            <div className="card">
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

                {/* Admin Reset on Welcome Screen */}
                {isAdmin(currentUser.email) && (
                    <button
                        onClick={handleReset}
                        style={{
                            marginTop: '20px',
                            background: '#dc3545',
                            color: 'white',
                            width: '100%',
                            padding: '10px',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Reset App (Admin)
                    </button>
                )}

                <button
                    onClick={() => firebaseSignOut(clientAuth)}
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
