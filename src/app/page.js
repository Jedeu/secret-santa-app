'use client';
import { useState, useEffect } from 'react';
import { useSession, signIn, signOut, getProviders } from 'next-auth/react';
import Chat from '@/components/Chat';
import PublicFeed from '@/components/PublicFeed';
import { useRealtimeUnreadCounts } from '@/hooks/useRealtimeMessages';
import { getParticipantNames } from '@/lib/participants';

// Tab button component
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
                <span style={{
                    background: 'var(--primary)',
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    minWidth: '18px',
                    textAlign: 'center'
                }}>
                    {unreadCount}
                </span>
            )}
        </button>
    );
}

export default function Home() {
    const { data: session, status } = useSession();
    const [recipientInput, setRecipientInput] = useState('');
    const [allUsers, setAllUsers] = useState([]);
    const [availableRecipients, setAvailableRecipients] = useState([]);
    const [loading, setLoading] = useState(false);
    const [needsRecipient, setNeedsRecipient] = useState(false);
    const [activeTab, setActiveTab] = useState('recipient'); // 'recipient', 'santa', 'feed'
    const [providers, setProviders] = useState(null);

    // Dev login state
    const [devName, setDevName] = useState('');
    const [devEmail, setDevEmail] = useState('');

    const currentUser = session?.user;
    const isLoading = status === 'loading';

    // Use real-time unread counts instead of polling
    const unreadData = useRealtimeUnreadCounts(currentUser?.id);
    const unreadCounts = {
        recipient: unreadData.recipientUnread || 0,
        santa: unreadData.santaUnread || 0
    };

    // Fetch providers
    useEffect(() => {
        getProviders().then(setProviders);
    }, []);

    // Fetch all users when authenticated
    useEffect(() => {
        if (currentUser) {
            fetch('/api/auth')
                .then(res => res.json())
                .then(data => {
                    if (!data.error) {
                        setAllUsers(data);

                        // Filter available recipients from hardcoded list
                        const ALLOWED_RECIPIENTS = getParticipantNames();

                        const available = ALLOWED_RECIPIENTS.filter(name => {
                            // Exclude self
                            if (name.toLowerCase() === currentUser.name?.toLowerCase()) return false;

                            // Exclude if already taken (has gifterId)
                            const userObj = data.find(u => u.name.toLowerCase() === name.toLowerCase());
                            if (userObj && userObj.gifterId) return false;

                            return true;
                        });
                        setAvailableRecipients(available);
                    }
                })
                .catch(err => console.error('Failed to fetch users:', err));
        }
    }, [currentUser]);

    // Check if user needs to set recipient
    useEffect(() => {
        if (currentUser && !currentUser.recipientId) {
            setNeedsRecipient(true);
        } else {
            setNeedsRecipient(false);
        }
    }, [currentUser]);

    const handleDevLogin = async (e) => {
        e.preventDefault();
        if (!devName || !devEmail) return;
        setLoading(true);

        try {
            await signIn('credentials', {
                name: devName,
                email: devEmail,
                callbackUrl: '/'
            });
        } catch (err) {
            alert('Failed to login');
            setLoading(false);
        }
    };

    const handleSetRecipient = async (e) => {
        e.preventDefault();
        if (!recipientInput) return;
        setLoading(true);

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'setRecipient', recipientName: recipientInput })
            });

            if (res.ok) {
                window.location.reload();
            } else {
                const error = await res.json();
                alert(error.error || 'Failed to set recipient');
            }
        } catch (err) {
            alert('Failed to set recipient');
        } finally {
            setLoading(false);
        }
    };

    const handleAssign = async () => {
        if (!confirm('Are you sure? This will shuffle everyone!')) return;

        try {
            await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'assign' })
            });
            window.location.reload();
        } catch (err) {
            alert('Failed to assign users');
        }
    };

    const handleReset = async () => {
        if (!confirm('WARNING: This will delete ALL data (users, messages, assignments). This cannot be undone. Are you sure?')) return;

        try {
            const res = await fetch('/api/admin/reset', {
                method: 'POST'
            });

            if (res.ok) {
                alert('System reset successfully.');
                window.location.reload();
            } else {
                alert('Failed to reset system.');
            }
        } catch (err) {
            alert('Failed to reset system.');
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <main className="container" style={{ justifyContent: 'center' }}>
                <div className="card">
                    <p style={{ textAlign: 'center' }}>Loading...</p>
                </div>
            </main>
        );
    }

    // Not authenticated - show sign in
    if (!currentUser) {
        return (
            <main className="container" style={{ justifyContent: 'center' }}>
                <div className="card">
                    <h1 className="title">Secret Santa 🎅</h1>

                    {providers?.credentials && (
                        <div style={{
                            background: '#fff3cd',
                            border: '1px solid #ffc107',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            marginBottom: '16px',
                            fontSize: '13px',
                            color: '#856404'
                        }}>
                            ⚠️ <strong>Dev Mode:</strong> OAuth bypass enabled
                        </div>
                    )}

                    <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                        Sign in to join the Secret Santa exchange.
                    </p>

                    {providers?.google && (
                        <button
                            className="btn"
                            onClick={() => signIn('google')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                marginBottom: '16px'
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.208 1.126-.842 2.08-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
                                <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853" />
                                <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
                                <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335" />
                            </svg>
                            Sign in with Google
                        </button>
                    )}

                    {providers?.credentials && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '16px' }}>
                            <p style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--text-muted)' }}>Dev Login</p>
                            <form onSubmit={handleDevLogin} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <input
                                    className="input"
                                    placeholder="Name"
                                    value={devName}
                                    onChange={e => setDevName(e.target.value)}
                                    required
                                />
                                <input
                                    className="input"
                                    type="email"
                                    placeholder="Email"
                                    value={devEmail}
                                    onChange={e => setDevEmail(e.target.value)}
                                    required
                                />
                                <button className="btn" disabled={loading} style={{ background: 'var(--surface-highlight)', color: 'var(--text)' }}>
                                    {loading ? 'Loading...' : 'Dev Login'}
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </main>
        );
    }

    // First-time user - needs to set recipient
    if (needsRecipient) {
        return (
            <main className="container" style={{ justifyContent: 'center' }}>
                <div className="card">
                    <h1 className="title">Welcome, {currentUser.name}! 👋</h1>
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
                    {currentUser.email === 'jed.piezas@gmail.com' && (
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
                        onClick={() => signOut()}
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

    // Authenticated user with recipient assigned
    return (
        <main className="container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h1 className="title" style={{ margin: 0, fontSize: '20px' }}>Hi, {currentUser.name} 👋</h1>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    {/* Admin Reset Button - Always visible for admin */}
                    {currentUser.email === 'jed.piezas@gmail.com' && (
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
                            🔄 Reset
                        </button>
                    )}
                    <button onClick={() => signOut()} style={{ color: 'var(--text-muted)', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Sign out
                    </button>
                </div>
            </div>

            {!currentUser.recipientId && (
                <div className="card" style={{ textAlign: 'center' }}>
                    <p style={{ marginBottom: '10px' }}>Waiting for assignments...</p>

                    {/* Admin Controls */}
                    {currentUser.email === 'jed.piezas@gmail.com' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                            <button className="btn" onClick={handleAssign} style={{ background: 'var(--surface-highlight)' }}>
                                Start Exchange (Admin)
                            </button>
                            <button className="btn" onClick={handleReset} style={{ background: '#dc3545', color: 'white' }}>
                                Reset App (Admin)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {currentUser.recipientId && (
                <>
                    {/* Desktop: Tabbed interface */}
                    <div className="desktop-only">
                        <div style={{
                            display: 'flex',
                            borderBottom: '2px solid var(--border)',
                            marginBottom: '20px',
                            gap: '8px'
                        }}>
                            <TabButton
                                active={activeTab === 'recipient'}
                                onClick={() => setActiveTab('recipient')}
                                unreadCount={unreadCounts.recipient}
                            >
                                🎁 Recipient
                            </TabButton>
                            <TabButton
                                active={activeTab === 'santa'}
                                onClick={() => setActiveTab('santa')}
                                unreadCount={unreadCounts.santa}
                            >
                                🎅 Santa
                            </TabButton>
                            <TabButton
                                active={activeTab === 'feed'}
                                onClick={() => setActiveTab('feed')}
                            >
                                🎄 Public Feed
                            </TabButton>
                        </div>

                        {activeTab === 'recipient' && (
                            <Chat
                                currentUser={currentUser}
                                otherUser={{
                                    id: currentUser.recipientId,
                                    name: allUsers.find(u => u.id === currentUser.recipientId)?.name || 'Recipient'
                                }}
                                isSantaChat={false}
                                unreadCount={unreadCounts.recipient || 0}
                            />
                        )}

                        {activeTab === 'santa' && (
                            <Chat
                                currentUser={currentUser}
                                otherUser={{ id: currentUser.gifterId, name: 'Santa' }}
                                isSantaChat={true}
                                unreadCount={unreadCounts.santa || 0}
                            />
                        )}

                        {activeTab === 'feed' && <PublicFeed />}
                    </div>

                    {/* Mobile: Stacked layout */}
                    <div className="mobile-only">
                        <Chat
                            currentUser={currentUser}
                            otherUser={{
                                id: currentUser.recipientId,
                                name: allUsers.find(u => u.id === currentUser.recipientId)?.name || 'Recipient'
                            }}
                            isSantaChat={false}
                            unreadCount={unreadCounts.recipient || 0}
                        />
                        <div style={{ height: '20px' }} />
                        <Chat
                            currentUser={currentUser}
                            otherUser={{ id: currentUser.gifterId, name: 'Santa' }}
                            isSantaChat={true}
                            unreadCount={unreadCounts.santa || 0}
                        />
                        <div style={{ height: '20px' }} />
                        <PublicFeed />
                    </div>
                </>
            )}

            <style jsx>{`
                .desktop-only {
                    display: block;
                }
                .mobile-only {
                    display: none;
                }
                
                @media (max-width: 767px) {
                    .desktop-only {
                        display: none;
                    }
                    .mobile-only {
                        display: block;
                    }
                }
            `}</style>
        </main>
    );
}
