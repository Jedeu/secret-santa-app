'use client';
import { isAdmin } from '@/lib/config';
import { useAdminReset } from '@/hooks/useAdminReset';

/**
 * AdminPanel - Compact admin Reset button (mobile header and reset-in-progress screen).
 *
 * Pair assignment is user self-selection (RecipientSelector); there is no admin shuffle.
 *
 * @param {Object} props
 * @param {string} props.userEmail - Current user's email
 * @param {Function} [props.onResetComplete] - Called after successful reset
 */
export default function AdminPanel({ userEmail, onResetComplete }) {
    const handleReset = useAdminReset({ onComplete: onResetComplete });

    // Only render if user is admin
    if (!isAdmin(userEmail)) {
        return null;
    }

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
