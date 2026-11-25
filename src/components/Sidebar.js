'use client';

/**
 * SidebarItem - Individual navigation item with optional unread badge
 */
function SidebarItem({ active, onClick, children, unreadCount, icon, badgeLabel }) {
    return (
        <button
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 24px',
                background: active ? 'var(--surface-highlight)' : 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: active ? 'var(--tab-active-fg)' : 'var(--foreground)',
                fontSize: '14px',
                fontWeight: active ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                textAlign: 'left'
            }}
        >
            <span style={{ fontSize: '18px' }}>{icon}</span>
            <span style={{ flex: 1 }}>{children}</span>
            {unreadCount > 0 && (
                <span
                    data-testid="sidebar-unread-badge"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-label={`${badgeLabel || children}: ${unreadCount} unread messages`}
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
 * Sidebar - Desktop navigation: the one-line user bar (`header`) above the chat list.
 * @param {Object} props
 * @param {string} props.activeTab - 'recipient', 'santa', 'feed' or 'archive'
 * @param {Function} props.onTabChange - (tabId) => void
 * @param {Object} props.unreadCounts - { recipient: number, santa: number }
 * @param {React.ReactNode} [props.header] - The user bar (menu with push, sound, sign out; admin control)
 * @param {string|null} [props.recipientLabel] - The recipient's name for the Recipient item
 * @param {boolean} [props.showArchive] - Show the "📚 Archives" item
 */
export default function Sidebar({
    activeTab,
    onTabChange,
    unreadCounts,
    header = null,
    recipientLabel = null,
    showArchive = false
}) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: 'var(--surface)',
            padding: '20px 0 0 0',
            position: 'relative'
        }}>
            {header && <div style={{ padding: '0 16px 0 24px', marginBottom: '12px' }}>{header}</div>}

            {/* Navigation Items */}
            <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <SidebarItem
                    active={activeTab === 'recipient'}
                    onClick={() => onTabChange('recipient')}
                    unreadCount={unreadCounts?.recipient || 0}
                    icon="🎁"
                    badgeLabel="Recipient"
                >
                    {recipientLabel ? (
                        // Shows the recipient's name; the accessible name still says Recipient.
                        <><span className="sr-only">Recipient: </span>{recipientLabel}</>
                    ) : 'Recipient'}
                </SidebarItem>
                <SidebarItem
                    active={activeTab === 'santa'}
                    onClick={() => onTabChange('santa')}
                    unreadCount={unreadCounts?.santa || 0}
                    icon="🎅"
                >
                    Santa
                </SidebarItem>
                <SidebarItem
                    active={activeTab === 'feed'}
                    onClick={() => onTabChange('feed')}
                    icon="🎄"
                >
                    Public Feed
                </SidebarItem>
                {showArchive && (
                    <SidebarItem
                        active={activeTab === 'archive'}
                        onClick={() => onTabChange('archive')}
                        icon="📚"
                    >
                        Archives
                    </SidebarItem>
                )}
            </nav>
        </div>
    );
}
