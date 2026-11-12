'use client';
import { isAdmin } from '@/lib/config';
import { getNextRosterYear, getRosterNames } from '@/lib/participants';
import { useAdminYearActions } from '@/hooks/useAdminYearActions';

/**
 * AdminPanel - Compact admin season control.
 *
 * Active year -> "Close {year}". Closed year -> "Start {next}" when a roster for a later
 * year is configured, otherwise a muted "No next-year roster". Start draws every
 * participant's recipient on the server; years started before the automatic draw keep
 * self-selection (RecipientSelector).
 *
 * @param {Object} props
 * @param {string} props.userEmail - Current user's email
 * @param {{ year: number, state: 'active'|'closed' }|null} props.season - Published season
 * @param {Function} [props.onComplete] - Called after a successful Close or Start
 */
export default function AdminPanel({ userEmail, season, onComplete }) {
    const { closeYear, startYear, busy } = useAdminYearActions({ onComplete });

    // Only render for an admin with a published season
    if (!isAdmin(userEmail) || !season) {
        return null;
    }

    const year = season.year;

    if (season.state === 'active') {
        return (
            <button
                type="button"
                onClick={() => closeYear(year)}
                disabled={busy}
                style={buttonStyle(busy)}
                title={`Close the ${year} exchange (read-only)`}
            >
                {`Close ${year}`}
            </button>
        );
    }

    const next = getNextRosterYear(year);
    if (next === null) {
        return (
            <span className="text-muted" style={{ fontSize: '12px' }}>
                No next-year roster
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={() => startYear(year, next, getRosterNames(next))}
            disabled={busy}
            style={buttonStyle(busy)}
            title={`Start the ${next} exchange`}
        >
            {`Start ${next}`}
        </button>
    );
}

function buttonStyle(busy) {
    return {
        background: 'var(--primary)',
        color: 'white',
        fontSize: '12px',
        padding: '6px 12px',
        border: 'none',
        borderRadius: '4px',
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
        fontWeight: '500'
    };
}
