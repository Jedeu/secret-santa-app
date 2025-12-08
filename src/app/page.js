'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { clientAuth, firestore } from '@/lib/firebase-client';
import { useUser } from '@/hooks/useUser';
import { useRealtimeUnreadCounts, useRealtimeAllMessages } from '@/hooks/useRealtimeMessages';
import { getConversationId, filterMessages } from '@/lib/message-utils';
import { getParticipantNames } from '@/lib/participants';

// Component imports
import AuthGuard from '@/components/AuthGuard';
import RecipientSelector from '@/components/RecipientSelector';
import AdminPanel from '@/components/AdminPanel';
import TabNavigation from '@/components/TabNavigation';
import ChatTabs from '@/components/ChatTabs';
import Sidebar from '@/components/Sidebar';

export default function Home() {
    // Authentication state
    const { user: currentUser, loading: isLoading, error: authError, refreshUser } = useUser();

    // UI state
    const [allUsers, setAllUsers] = useState([]);
    const [availableRecipients, setAvailableRecipients] = useState([]);
    const [activeTab, setActiveTab] = useState('recipient');

    // Real-time message data
    const allMessages = useRealtimeAllMessages(!!currentUser);
    const unreadData = useRealtimeUnreadCounts(
        currentUser?.id,
        currentUser?.recipientId,
        currentUser?.gifterId
    );
    const unreadCounts = {
        recipient: unreadData.recipientUnread || 0,
        santa: unreadData.santaUnread || 0
    };

    // Helper to filter messages for specific conversation
    // IMPORTANT: Memoized with useCallback to ensure useMemo dependencies are correct
    const getConversationMessages = useCallback((userId, otherId, conversationId) => {
        return filterMessages(allMessages, userId, otherId, conversationId);
    }, [allMessages]);

    // Memoize conversation IDs
    const recipientConversationId = useMemo(() =>
        getConversationId(currentUser?.id, currentUser?.recipientId),
        [currentUser?.id, currentUser?.recipientId]
    );

    const santaConversationId = useMemo(() =>
        getConversationId(currentUser?.gifterId, currentUser?.id),
        [currentUser?.gifterId, currentUser?.id]
    );

    // Memoize messages
    const recipientMessages = useMemo(() =>
        getConversationMessages(currentUser?.id, currentUser?.recipientId, recipientConversationId),
        [getConversationMessages, currentUser?.id, currentUser?.recipientId, recipientConversationId]
    );

    const santaMessages = useMemo(() =>
        getConversationMessages(currentUser?.id, currentUser?.gifterId, santaConversationId),
        [getConversationMessages, currentUser?.id, currentUser?.gifterId, santaConversationId]
    );

    // Fetch all users when authenticated
    useEffect(() => {
        if (currentUser) {
            const fetchUsers = async () => {
                try {
                    const usersCollection = collection(firestore, 'users');
                    const snapshot = await getDocs(usersCollection);
                    const users = snapshot.docs.map(doc => doc.data());

                    setAllUsers(users);

                    // Filter available recipients from hardcoded list
                    const ALLOWED_RECIPIENTS = getParticipantNames();
                    const available = ALLOWED_RECIPIENTS.filter(name => {
                        if (name.toLowerCase() === currentUser.name?.toLowerCase()) return false;
                        const userObj = users.find(u => u.name.toLowerCase() === name.toLowerCase());
                        if (userObj && userObj.gifterId) return false;
                        return true;
                    });
                    setAvailableRecipients(available);
                } catch (error) {
                    console.error('Failed to fetch users:', error);
                }
            };

            fetchUsers();
        }
    }, [currentUser]);

    // Check if user needs to set recipient
    const needsRecipient = currentUser && !currentUser.recipientId;

    return (
        <AuthGuard isLoading={isLoading} currentUser={currentUser} authError={authError}>
            {needsRecipient ? (
                <RecipientSelector
                    currentUser={currentUser}
                    availableRecipients={availableRecipients}
                    onComplete={refreshUser}
                    onReset={refreshUser}
                />
            ) : (
                <main className="container">
                    {/* Desktop Sidebar */}
                    <div className="desktop-only" style={{ width: '280px', flexShrink: 0 }}>
                        <Sidebar
                            currentUser={currentUser}
                            activeTab={activeTab}
                            onTabChange={setActiveTab}
                            unreadCounts={unreadCounts}
                            onSignOut={() => firebaseSignOut(clientAuth)}
                            onReset={refreshUser}
                        />
                    </div>

                    {/* Main Content Area */}
                    <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                        {/* Mobile Header */}
                        <div className="mobile-only mobile-header">
                            <h1 className="title" data-testid="user-greeting" style={{ margin: 0, fontSize: '20px' }}>{'Hi, ' + currentUser?.name + ' 👋'}</h1>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <AdminPanel userEmail={currentUser?.email} variant="compact" onResetComplete={refreshUser} />
                                <button
                                    onClick={() => firebaseSignOut(clientAuth)}
                                    style={{ color: 'var(--text-muted)', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    Sign out
                                </button>
                            </div>
                        </div>

                        {!currentUser?.recipientId ? (
                            <div className="card" style={{ textAlign: 'center' }}>
                                <p style={{ marginBottom: '10px' }}>Waiting for assignments...</p>
                                <AdminPanel userEmail={currentUser?.email} variant="full" onAssignComplete={refreshUser} onResetComplete={refreshUser} />
                            </div>
                        ) : (
                            <>
                                {/* Mobile Tabs */}
                                <div className="mobile-only">
                                    <TabNavigation
                                        activeTab={activeTab}
                                        onTabChange={setActiveTab}
                                        unreadCounts={unreadCounts}
                                    />
                                </div>
                                <ChatTabs
                                    activeTab={activeTab}
                                    currentUser={currentUser}
                                    allUsers={allUsers}
                                    allMessages={allMessages}
                                    recipientMessages={recipientMessages}
                                    santaMessages={santaMessages}
                                    unreadCounts={unreadCounts}
                                    recipientConversationId={recipientConversationId}
                                    santaConversationId={santaConversationId}
                                />
                            </>
                        )}
                    </div>
                </main>
            )}
        </AuthGuard>
    );
}
