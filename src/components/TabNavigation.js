'use client';

/**
 * TabButton - Individual tab button with optional unread badge
 */
function TabButton({ active, onClick, children, unreadCount }) {
    return (
        <button
            onClick={onClick}
            style={{
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                color: active ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: '14px',
                fontWeight: active ? '600' : '400',
                padding: '12px 20px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '-2px'
            }}
        >
            {children}
            {unreadCount > 0 && (
                <span
                    data-testid="unread-badge"
                    style={{
                        background: 'var(--primary)',
                        color: 'white',
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
 * TabNavigation - Tab bar for switching between Recipient, Santa, and Public Feed
 *
 * @param {Object} props
 * @param {'recipient'|'santa'|'feed'} props.activeTab - Currently active tab
 * @param {Function} props.onTabChange - Called with tab ID when tab is clicked
 * @param {Object} props.unreadCounts - Object with recipient and santa unread counts
 * @param {number} props.unreadCounts.recipient - Unread count for recipient tab
 * @param {number} props.unreadCounts.santa - Unread count for santa tab
 */
export default function TabNavigation({ activeTab, onTabChange, unreadCounts }) {
    return (
        <div style={{
            display: 'flex',
            borderBottom: '2px solid var(--border)',
            marginBottom: '20px',
            gap: '8px',
            overflowX: 'auto',
            whiteSpace: 'nowrap'
        }}>
            <TabButton
                active={activeTab === 'recipient'}
                onClick={() => onTabChange('recipient')}
                unreadCount={unreadCounts?.recipient || 0}
            >
                {'\ud83c\udf81 Recipient'}
            </TabButton>
            <TabButton
                active={activeTab === 'santa'}
                onClick={() => onTabChange('santa')}
                unreadCount={unreadCounts?.santa || 0}
            >
                {'\ud83c\udf85 Santa'}
            </TabButton>
            <TabButton
                active={activeTab === 'feed'}
                onClick={() => onTabChange('feed')}
            >
                {'\ud83c\udf84 Public Feed'}
            </TabButton>
        </div>
    );
}

// Export TabButton for use in tests if needed
export { TabButton };
