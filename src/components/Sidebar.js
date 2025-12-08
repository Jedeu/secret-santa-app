'use client';
import { isAdmin } from '@/lib/config';

/**
 * SidebarItem - Individual navigation item with optional unread badge
 */
function SidebarItem({ active, onClick, children, unreadCount, icon }) {
    return (
        <button
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 24px',
                background: active ? 'var(--surface-highlight)' : 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: active ? 'var(--primary)' : 'var(--foreground)',
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
 * Sidebar - Desktop navigation component
 * @param {Object} props
 * @param {Object} props.currentUser - The logged-in user object
 * @param {string} props.activeTab - 'recipient', 'santa', or 'feed'
 * @param {Function} props.onTabChange - (tabId) => void
 * @param {Object} props.unreadCounts - { recipient: number, santa: number }
 * @param {Function} props.onSignOut - () => void
 * @param {Function} props.onReset - () => void
 */
export default function Sidebar({
    currentUser,
    activeTab,
    onTabChange,
    unreadCounts,
    onSignOut,
    onReset
}) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: 'var(--surface)',
            padding: '20px 0 0 0', // Top padding to align with Chat header
            position: 'relative'
        }}>
            {/* Header with Reset Button */}
            < div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 24px',
                marginBottom: '12px'
            }}>
                <h1 style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    color: 'var(--foreground)',
                    margin: 0
                }}>
                    {'Hi, ' + (currentUser?.name || 'User') + ' 👋'}
                </h1>

                {
                    isAdmin(currentUser?.email) && (
                        <button
                            onClick={onReset}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px',
                                borderRadius: '4px',
                                transition: 'color 0.2s'
                            }}
                            title="Reset App Data"
                        >
                            🔧 <span style={{ fontSize: '10px' }}>Reset</span>
                        </button>
                    )
                }
            </div >

            {/* Navigation Items */}
            < nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <SidebarItem
                    active={activeTab === 'recipient'}
                    onClick={() => onTabChange('recipient')}
                    unreadCount={unreadCounts?.recipient || 0}
                    icon="🎁"
                >
                    Recipient
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
            </nav >

            {/* Footer - pushed to bottom with marginTop:auto */}
            < div style={{
                marginTop: 'auto',
                borderTop: '1px solid var(--border)',
                padding: '8px 24px 40px', // Bottom padding matches chat card padding + Tip text height
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 'bold'
                    }}>
                        {currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {currentUser?.name}
                    </span>
                </div>
                <button
                    onClick={onSignOut}
                    style={{
                        color: 'var(--text-muted)',
                        fontSize: '13px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.target.style.background = 'none'}
                >
                    Sign out
                </button>
            </div >
        </div >
    );
}
