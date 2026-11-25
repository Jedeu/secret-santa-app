'use client';

/**
 * TabButton - Individual tab button with optional unread badge
 */
function TabButton({ active, onClick, children, unreadCount, badgeLabel }) {
    return (
        <button
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            style={{
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '3px solid var(--tab-active-fg)' : '3px solid transparent',
                color: active ? 'var(--tab-active-fg)' : 'var(--text-muted)',
                fontSize: '14px',
                fontWeight: active ? '600' : '400',
                padding: '12px 4px 10px',
                flex: '1 0 auto',
                minWidth: 0,
                justifyContent: 'center',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                transition: 'color 0.15s ease, border-color 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '-1px'
            }}
        >
            {children}
            {unreadCount > 0 && (
                <span
                    data-testid="unread-badge"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-label={`${badgeLabel}: ${unreadCount} unread messages`}
                    style={{
                        background: 'var(--badge-bg)',
                        color: 'var(--badge-fg)',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        minWidth: '18px',
                        textAlign: 'center'
                    }}
                >
                    {unreadCount}
                </span>
            )}
        </button>
    );
}

/**
 * TabNavigation - Tab bar for switching between Recipient, Santa, Public Feed and Archives
 *
 * @param {Object} props
 * @param {'recipient'|'santa'|'feed'|'archive'} props.activeTab - Currently active tab
 * @param {Function} props.onTabChange - Called with tab ID when tab is clicked
 * @param {Object} props.unreadCounts - Object with recipient and santa unread counts
 * @param {number} props.unreadCounts.recipient - Unread count for recipient tab
 * @param {number} props.unreadCounts.santa - Unread count for santa tab
 * @param {boolean} [props.showArchive] - Show the "📚 Archives" tab
 */
export default function TabNavigation({ activeTab, onTabChange, unreadCounts, showArchive = false, recipientLabel = null }) {
    return (
        <div className="tab-nav" style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            padding: '0 8px',
            gap: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            whiteSpace: 'nowrap'
        }}>
            <TabButton
                active={activeTab === 'recipient'}
                onClick={() => onTabChange('recipient')}
                unreadCount={unreadCounts?.recipient || 0}
                badgeLabel="Recipient"
            >
                {recipientLabel ? (
                    // The tab shows the recipient's name; its accessible name still says Recipient.
                    <><span className="sr-only">Recipient: </span>{'\ud83c\udf81 ' + recipientLabel}</>
                ) : '\ud83c\udf81 Recipient'}
            </TabButton>
            <TabButton
                active={activeTab === 'santa'}
                onClick={() => onTabChange('santa')}
                unreadCount={unreadCounts?.santa || 0}
                badgeLabel="Santa"
            >
                {'\ud83c\udf85 Santa'}
            </TabButton>
            <TabButton
                active={activeTab === 'feed'}
                onClick={() => onTabChange('feed')}
            >
                {'\ud83c\udf84 Public Feed'}
            </TabButton>
            {showArchive && (
                <TabButton
                    active={activeTab === 'archive'}
                    onClick={() => onTabChange('archive')}
                >
                    {'\ud83d\udcda Archives'}
                </TabButton>
            )}
        </div>
    );
}

// Export TabButton for use in tests if needed
export { TabButton };
