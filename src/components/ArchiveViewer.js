'use client';
import { useMemo, useState } from 'react';
import { useYearArchive } from '@/hooks/useYearArchive';
import { buildArchiveView } from '@/lib/archive-threads';
import ReactionChips from '@/components/ReactionChips';

/**
 * ArchiveViewer - Read-only view of a past (closed) year: pairings and conversations.
 *
 * Reads each year once from the server (useYearArchive); no listeners, no writers, no
 * composer, no outbox or typing. Pairings are shown because the exchange is over.
 *
 * @param {Object} props
 * @param {string|null} props.authUid - Firebase Auth uid (archive cache key)
 * @param {number[]} props.years - Selectable years, newest first
 * @param {number} props.initialYear - Year shown first
 * @param {number[]} props.closedYears - Closed years (their results are cached)
 * @param {Function|null} [props.onBack] - Shows "← Back to current year" when provided
 * @param {React.ReactNode} [props.banner] - Optional banner above the read-only note
 */
export default function ArchiveViewer({ authUid, years, initialYear, closedYears, onBack = null, banner = null }) {
    const [year, setYear] = useState(initialYear);
    const [threadId, setThreadId] = useState(null);

    const yearList = Array.isArray(years) ? years : [];
    const closed = Array.isArray(closedYears) ? closedYears : [];
    const { status, data, reload } = useYearArchive({ authUid, year, immutable: closed.includes(year) });

    const view = useMemo(
        () => (data ? buildArchiveView({ users: data.users, messages: data.messages }) : null),
        [data]
    );

    const selectedThread = view && threadId !== null
        ? view.threads.find((thread) => thread.id === threadId) || null
        : null;

    const handleYearChange = (event) => {
        setYear(Number(event.target.value));
        setThreadId(null);
    };

    return (
        <section
            data-testid="archive-viewer"
            className="card"
            style={{ width: '100%', maxWidth: '760px', margin: '0 auto', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {onBack && (
                    <button
                        type="button"
                        aria-label="Back to current year"
                        onClick={() => onBack()}
                        style={linkButtonStyle}
                    >
                        ← Back to current year
                    </button>
                )}
                <h2 style={{ margin: 0, fontSize: '20px', flex: 1 }}>{`📚 ${year} Archive`}</h2>
                {yearList.length > 1 && (
                    <select
                        aria-label="Archive year"
                        className="input"
                        value={year}
                        onChange={handleYearChange}
                        style={{ width: 'auto', padding: '6px 10px', margin: 0 }}
                    >
                        {yearList.map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                )}
            </div>

            {banner && (
                <p role="status" style={{ margin: '0 0 8px 0', fontWeight: 600 }}>{banner}</p>
            )}
            <p className="text-muted" style={{ margin: '0 0 16px 0', fontSize: '13px' }}>
                Read-only. Pairings are shown because this exchange is over.
            </p>

            {status === 'loading' && (
                <p className="text-muted">{`Loading ${year}…`}</p>
            )}

            {status === 'error' && (
                <div>
                    <p className="text-muted">{`Could not load ${year}. Check your connection and try again.`}</p>
                    <button type="button" className="btn" onClick={() => reload()}>
                        Try again
                    </button>
                </div>
            )}

            {status === 'ready' && view && !selectedThread && (
                <>
                    <h3 style={sectionHeadingStyle}>Pairings</h3>
                    {view.pairings.length === 0 ? (
                        <p className="text-muted">No pairings were recorded.</p>
                    ) : (
                        <ul style={listStyle}>
                            {view.pairings.map((pairing) => (
                                <li key={`${pairing.santaId}:${pairing.recipientId}`} data-testid="archive-pairing" style={rowStyle}>
                                    {`🎅 ${pairing.santaName} → 🎁 ${pairing.recipientName}`}
                                </li>
                            ))}
                        </ul>
                    )}

                    <h3 style={sectionHeadingStyle}>Conversations</h3>
                    {view.threads.length === 0 ? (
                        <p className="text-muted">No messages</p>
                    ) : (
                        <ul style={listStyle}>
                            {view.threads.map((thread) => (
                                <li key={thread.id} style={{ listStyle: 'none' }}>
                                    <button
                                        type="button"
                                        data-testid="archive-thread"
                                        onClick={() => setThreadId(thread.id)}
                                        style={threadButtonStyle}
                                    >
                                        <span style={{ display: 'block', fontWeight: 600 }}>{thread.title}</span>
                                        <span className="text-muted" style={{ display: 'block', fontSize: '13px' }}>
                                            {previewOf(thread)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            {status === 'ready' && view && selectedThread && (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                        <button
                            type="button"
                            aria-label="Back to conversations"
                            onClick={() => setThreadId(null)}
                            style={linkButtonStyle}
                        >
                            ← Back
                        </button>
                        <h3 style={{ margin: 0, fontSize: '16px' }}>{selectedThread.title}</h3>
                    </div>
                    {selectedThread.messages.length === 0 ? (
                        <p className="text-muted">No messages</p>
                    ) : (
                        <ul style={listStyle}>
                            {selectedThread.messages.map((message, index) => (
                                <li key={message.id ?? `message-${index}`} data-testid="archive-message" style={rowStyle}>
                                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{message.label}</div>
                                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {typeof message.content === 'string' ? message.content : ''}
                                    </div>
                                    <div className="text-muted" style={{ fontSize: '12px' }}>{formatDate(message.timestamp)}</div>
                                    <ReactionChips
                                        messageId={message.id}
                                        allReactions={data.reactions}
                                        currentUserId={null}
                                        onToggle={null}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

function formatDate(value) {
    if (typeof value !== 'string') return 'Unknown date';
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) return 'Unknown date';
    return new Date(ms).toLocaleString();
}

function previewOf(thread) {
    if (!thread.messages.length) return 'No messages';
    const latest = thread.messages.find((message) => message.timestamp === thread.latestTimestamp)
        || thread.messages[thread.messages.length - 1];
    const content = typeof latest?.content === 'string' ? latest.content : '';
    return content.length > 80 ? `${content.slice(0, 80)}…` : content;
}

const sectionHeadingStyle = { fontSize: '16px', margin: '16px 0 8px 0' };

const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' };

const rowStyle = {
    listStyle: 'none',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--surface)',
};

const threadButtonStyle = {
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--surface)',
    color: 'var(--foreground)',
    cursor: 'pointer',
};

const linkButtonStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--primary)',
    cursor: 'pointer',
    padding: '4px 0',
    fontSize: '14px',
};
