'use client';
import { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Chat from '@/components/Chat';
import PublicFeed from '@/components/PublicFeed';

// Simple development mode bypass for testing without OAuth
const BYPASS_AUTH = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true';

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
    const [loading, setLoading] = useState(false);
    const [needsRecipient, setNeedsRecipient] = useState(false);
    const [unreadCounts, setUnreadCounts] = useState({ recipient: 0, santa: 0 });
    const [activeTab, setActiveTab] = useState('recipient'); // 'recipient', 'santa', 'feed'

    // DEV MODE: Simple name-based auth state
    const [devUser, setDevUser] = useState(null);
    const [devNameInput, setDevNameInput] = useState('');

    // Use either OAuth session or dev mode user
    const currentUser = BYPASS_AUTH ? devUser : session?.user;
    const isLoading = BYPASS_AUTH ? false : status === 'loading';

    // DEV MODE: Load user from localStorage
    useEffect(() => {
        if (BYPASS_AUTH) {
            const saved = localStorage.getItem('dev_user');
            if (saved) {
                setDevUser(JSON.parse(saved));
            }
        }
    }, []);

    // Fetch all users when authenticated
    useEffect(() => {
        if (currentUser) {
            fetch('/api/auth')
                .then(res => res.json())
                .then(data => {
                    if (!data.error) {
                        setAllUsers(data);
                    }
                })
                .catch(err => console.error('Failed to fetch users:', err));
        }
    }, [currentUser]);

    // Fetch unread counts
    useEffect(() => {
        if (currentUser && currentUser.recipientId) {
            const fetchUnread = () => {
                const url = BYPASS_AUTH
                    ? `/api/unread?userId=${currentUser.id}`
                    : '/api/unread';

                fetch(url)
                    .then(res => res.json())
                    .then(data => {
                        if (!data.error) {
                            setUnreadCounts(data);
                        }
                    })
                    .catch(err => console.error('Failed to fetch unread:', err));
            };
            fetchUnread();
            const interval = setInterval(fetchUnread, 3000); // Poll every 3s
            return () => clearInterval(interval);
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

    // DEV MODE: Simple login handler
    const handleDevLogin = async (e) => {
        e.preventDefault();
        if (!devNameInput) return;
        setLoading(true);

        try {
            const res = await fetch('/api/dev-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: devNameInput, recipientName: recipientInput })
            });
            const data = await res.json();
            setDevUser(data);
            localStorage.setItem('dev_user', JSON.stringify(data));
        } catch (err) {
            alert('Failed to login');
        } finally {
            setLoading(false);
        }
    };

    const handleSetRecipient = async (e) => {
        e.preventDefault();
        if (!recipientInput) return;
        setLoading(true);

        try {
            const endpoint = BYPASS_AUTH ? '/api/dev-auth' : '/api/auth';
            const body = BYPASS_AUTH
                ? { action: 'setRecipient', userId: devUser.id, recipientName: recipientInput }
                : { action: 'setRecipient', recipientName: recipientInput };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                const data = await res.json();
                if (BYPASS_AUTH) {
                    setDevUser(data.user || data);
                    localStorage.setItem('dev_user', JSON.stringify(data.user || data));
                }
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

    const handleLogout = () => {
        if (BYPASS_AUTH) {
            setDevUser(null);
            localStorage.removeItem('dev_user');
            setDevNameInput('');
            setRecipientInput('');
        } else {
            signOut();
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
                    {BYPASS_AUTH && (
                        <div style={{
                            background: '#fff3cd',
                            border: '1px solid #ffc107',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            marginBottom: '16px',
                            fontSize: '13px',
                            color: '#856404'
                        }}>
                            ⚠️ <strong>Dev Mode:</strong> OAuth bypassed for testing
                        </div>
                    )}
                    <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                        {BYPASS_AUTH
                            ? 'Enter your name to test the app.'
                            : 'Sign in with Google to join the Secret Santa exchange.'
                        }
                    </p>

                    {BYPASS_AUTH ? (
                        <form onSubmit={handleDevLogin}>
                            <input
                                className="input"
                                placeholder="Your Name"
                                value={devNameInput}
                                onChange={e => setDevNameInput(e.target.value)}
                                list="users-list"
                                required
                            />
                            <input
                                className="input"
                                placeholder="Who are you buying for? (optional)"
                                value={recipientInput}
                                onChange={e => setRecipientInput(e.target.value)}
                                list="users-list"
                            />
                            <datalist id="users-list">
                                {allUsers.map(u => <option key={u.id} value={u.name} />)}
                            </datalist>
                            <button className="btn" disabled={loading}>
                                {loading ? 'Loading...' : 'Enter'}
                            </button>
                        </form>
                    ) : (
                        <button
                            className="btn"
                            onClick={() => signIn('google')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px'
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
                        <input
                            className="input"
                            placeholder="Recipient Name"
                            value={recipientInput}
                            onChange={e => setRecipientInput(e.target.value)}
                            list="users-list"
                            required
                        />
                        <datalist id="users-list">
                            {allUsers.map(u => <option key={u.id} value={u.name} />)}
                        </datalist>
                        <button className="btn" disabled={loading}>
                            {loading ? 'Setting...' : 'Continue'}
                        </button>
                    </form>
                    <button
                        onClick={handleLogout}
                        style={{
                            color: 'var(--text-muted)',
                            fontSize: '14px',
                            marginTop: '10px'
                        }}
                    >
                        {BYPASS_AUTH ? 'Logout' : 'Sign out'}
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
                <button onClick={handleLogout} style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                    {BYPASS_AUTH ? 'Logout' : 'Sign out'}
                </button>
            </div>

            {!currentUser.recipientId && (
                <div className="card" style={{ textAlign: 'center' }}>
                    <p style={{ marginBottom: '10px' }}>Waiting for assignments...</p>
                    <button className="btn" onClick={handleAssign} style={{ background: 'var(--surface-highlight)' }}>
                        Start Exchange (Admin)
                    </button>
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
