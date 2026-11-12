'use client';
import { useEffect, useRef, useState } from 'react';
import { signOutCurrentUser } from '@/lib/sign-out';

// Copy (rendered through JS expressions).
const readyLine = (year) => `Your ${year} Secret Santa recipient is`;
const READY_NOTE = "Tap Continue when you're ready — this screen won't be shown again. Your recipient is always in the 🎁 Recipient tab.";
const LOADING_TEXT = "Finding out who you're buying a gift for…";
const ERROR_TEXT = "We couldn't load your recipient's name. Check your connection and try again.";
const invalidText = (year) => `Your ${year} recipient isn't available. Ask the admin for help.`;
const SAVE_FAILED_TEXT = "That didn't save. Check your connection and try again.";
const CONTINUE_LABEL = 'Continue';
const SAVING_LABEL = 'Saving…';
const TRY_AGAIN_LABEL = 'Try again';

function hasName(name) {
    return typeof name === 'string' && name.trim().length > 0;
}

/**
 * RecipientReveal - One-time reveal of the recipient drawn at Start new year.
 *
 * Continue is offered only while the recipient's name is displayed. Nothing is dismissed
 * locally: the page re-renders from the context state once the acknowledgment is
 * published (by the acknowledge route's response or by the profile listener).
 *
 * @param {Object} props
 * @param {{ id: string, name: string }} props.currentUser
 * @param {number} props.year
 * @param {'loading'|'ready'|'error'|'invalid'} props.status
 * @param {string|null} props.recipientName        non-empty when status is 'ready'
 * @param {() => Promise<{ status: 'acknowledged'|'stale'|'failed' }>} props.onAcknowledge
 * @param {() => void} props.onRetry
 * @param {React.ReactNode} [props.adminControl]
 * @param {Function|null} [props.onBrowseArchive]
 */
export default function RecipientReveal({
    currentUser,
    year,
    status,
    recipientName,
    onAcknowledge,
    onRetry,
    adminControl = null,
    onBrowseArchive = null
}) {
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const lockRef = useRef(false);
    const mountedRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const showName = status === 'ready' && hasName(recipientName);
    const view = status === 'invalid' ? 'invalid'
        : showName ? 'ready'
        : status === 'loading' ? 'loading'
        : 'error';

    const handleContinue = async () => {
        if (status !== 'ready' || !hasName(recipientName) || lockRef.current) return;

        lockRef.current = true;
        setSaving(true);
        setFailed(false);

        let result;
        try {
            result = await onAcknowledge();
        } catch {
            result = { status: 'failed' };
        }

        lockRef.current = false;
        if (mountedRef.current) {
            setSaving(false);
            setFailed(result?.status === 'failed');
        }
        // 'acknowledged' and 'stale' change nothing locally.
    };

    let content;
    if (view === 'ready') {
        content = (
            <>
                <p className="text-muted" style={{ textAlign: 'center', marginBottom: '8px' }}>
                    {readyLine(year)}
                </p>
                <p
                    data-testid="recipient-reveal-name"
                    style={{ textAlign: 'center', fontSize: '28px', fontWeight: 700, margin: '8px 0 16px' }}
                >
                    {recipientName}
                </p>
                <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px', fontSize: '14px' }}>
                    {READY_NOTE}
                </p>
                <button
                    type="button"
                    className="btn"
                    onClick={handleContinue}
                    disabled={saving}
                    style={{ width: '100%' }}
                >
                    {saving ? SAVING_LABEL : CONTINUE_LABEL}
                </button>
                {failed && (
                    <p role="alert" style={{ textAlign: 'center', marginTop: '12px', color: 'var(--primary)', fontSize: '14px' }}>
                        {SAVE_FAILED_TEXT}
                    </p>
                )}
            </>
        );
    } else if (view === 'loading') {
        content = (
            <p role="status" className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                {LOADING_TEXT}
            </p>
        );
    } else {
        content = (
            <>
                <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                    {view === 'invalid' ? invalidText(year) : ERROR_TEXT}
                </p>
                <button
                    type="button"
                    className="btn"
                    onClick={() => onRetry?.()}
                    style={{ width: '100%' }}
                >
                    {TRY_AGAIN_LABEL}
                </button>
            </>
        );
    }

    return (
        <main className="container" style={{ justifyContent: 'center', alignItems: 'center' }}>
            <div className="card login-card" data-testid="recipient-reveal">
                <h1 className="title">Welcome, {currentUser.name}!</h1>

                {content}

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
