'use client';
import { clientAuth } from '@/lib/firebase-client';
import { isAdmin } from '@/lib/config';

/**
 * AdminPanel - Admin control buttons for assign and reset
 *
 * @param {Object} props
 * @param {string} props.userEmail - Current user's email
 * @param {'full'|'compact'} props.variant - 'full' for main page, 'compact' for header
 * @param {Function} [props.onAssignComplete] - Called after successful assignment
 * @param {Function} [props.onResetComplete] - Called after successful reset
 */
export default function AdminPanel({ userEmail, variant = 'full', onAssignComplete, onResetComplete }) {
    // Only render if user is admin
    if (!isAdmin(userEmail)) {
        return null;
    }

    const handleAssign = async () => {
        if (!confirm('Are you sure? This will shuffle everyone!')) return;

        try {
            const token = await clientAuth.currentUser.getIdToken();

            const res = await fetch('/api/admin/assign', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (res.ok) {
                if (onAssignComplete) {
                    onAssignComplete();
                }
            } else {
                const error = await res.json();
                alert(`Failed to assign users: ${error.error}`);
            }
        } catch (err) {
            console.error('Assign error:', err);
            alert('Failed to assign users');
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
                if (onResetComplete) {
                    onResetComplete();
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

    // Compact variant - just the reset button in header
    if (variant === 'compact') {
        return (
            <button
                onClick={handleReset}
                style={{
                    background: '#dc3545',
                    color: 'white',
                    fontSize: '12px',
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '500'
                }}
                title="Reset all data and assignments"
            >
                Reset
            </button>
        );
    }

    // Full variant - both assign and reset buttons
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
            <button
                className="btn"
                onClick={handleAssign}
                style={{ background: 'var(--surface-highlight)' }}
            >
                Start Exchange (Admin)
            </button>
            <button
                className="btn"
                onClick={handleReset}
                style={{ background: '#dc3545', color: 'white' }}
            >
                Reset App (Admin)
            </button>
        </div>
    );
}
