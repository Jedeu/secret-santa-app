'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '@/lib/firebase-client';
import { useUser } from '@/hooks/useUser';
import { useAdminReset } from '@/hooks/useAdminReset';
import { signOutCurrentUser } from '@/lib/sign-out';
import {
    useRealtimeUnreadCounts,
    useRealtimeAllMessages,
    useRealtimeAllMessagesLoading,
    useRealtimeAllReactions
} from '@/hooks/useRealtimeMessages';
import { getConversationId, filterMessages, buildViewerAssignmentMap } from '@/lib/message-utils';
import { getParticipantNames } from '@/lib/participants';

// Component imports
import AuthGuard from '@/components/AuthGuard';
import RecipientSelector from '@/components/RecipientSelector';
import AdminPanel from '@/components/AdminPanel';
import TabNavigation from '@/components/TabNavigation';
import ChatTabs from '@/components/ChatTabs';
import Sidebar from '@/components/Sidebar';
import PushNotificationsControl from '@/components/PushNotificationsControl';
import PushNotificationsRuntime from '@/components/PushNotificationsRuntime';
import MessageOutboxRuntime from '@/components/MessageOutboxRuntime';
import NotificationSoundRuntime from '@/components/NotificationSoundRuntime';

function handleSignOut() {
    signOutCurrentUser().catch((error) => {
        console.error('Sign out error:', error);
    });
}

export default function Home() {
    // Authentication state
    const {
        user: currentUser,
        authUid,
        authEmail,
        loading: isLoading,
        error: authError,
        notice,
        refreshUser
    } = useUser();
    const handleAdminReset = useAdminReset({ onComplete: refreshUser });

    // UI state
    const [allUsers, setAllUsers] = useState([]);
    const [availableRecipients, setAvailableRecipients] = useState([]);
    const [activeTab, setActiveTab] = useState('recipient');
    const [soundEnabled, setSoundEnabled] = useState(() => {
        if (typeof window === 'undefined') {
            return true;
        }

        return window.localStorage.getItem('soundEnabled') !== 'false';
    });

    // Real-time message data
    const allMessages = useRealtimeAllMessages(!!currentUser);
    const allMessagesLoading = useRealtimeAllMessagesLoading();
    const allReactions = useRealtimeAllReactions();
    const unreadData = useRealtimeUnreadCounts(
        currentUser?.id,
        currentUser?.recipientId,
        currentUser?.gifterId
    );
    const unreadCounts = {
        recipient: unreadData.recipientUnread || 0,
        santa: unreadData.santaUnread || 0
    };

    // The viewer's own assignments decide which conversation a legacy row belongs to.
    const viewerId = currentUser?.id ?? null;
    const viewerRecipientId = currentUser?.recipientId ?? null;
    const viewerGifterId = currentUser?.gifterId ?? null;
    const viewerAssignments = useMemo(
        () => buildViewerAssignmentMap({ id: viewerId, recipientId: viewerRecipientId, gifterId: viewerGifterId }),
        [viewerId, viewerRecipientId, viewerGifterId]
    );

    // Helper to filter messages for specific conversation
    // IMPORTANT: Memoized with useCallback to ensure useMemo dependencies are correct
    const getConversationMessages = useCallback((userId, otherId, conversationId) => {
        return filterMessages(allMessages, userId, otherId, conversationId, viewerAssignments);
    }, [allMessages, viewerAssignments]);

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

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem('soundEnabled', soundEnabled ? 'true' : 'false');
    }, [soundEnabled]);

    return (
        <AuthGuard
            isLoading={isLoading}
            currentUser={currentUser}
            authError={authError}
            notice={notice}
            authEmail={authEmail}
            onRetry={refreshUser}
        >
            <PushNotificationsRuntime currentUser={currentUser} authUid={authUid} />
            <MessageOutboxRuntime currentUser={currentUser} authUid={authUid} />
            <NotificationSoundRuntime
                soundEnabled={soundEnabled}
                currentUserId={currentUser?.id}
                allMessages={allMessages}
                allMessagesLoading={allMessagesLoading}
            />
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
                            pushControl={<PushNotificationsControl compact authUid={authUid} />}
                            onSignOut={handleSignOut}
                            onReset={handleAdminReset}
                        />
                    </div>

                    {/* Main Content Area */}
                    <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                        {/* Mobile Header */}
                        <div className="mobile-only mobile-header">
                            <h1 className="title" data-testid="user-greeting" style={{ margin: 0, fontSize: '20px' }}>{'Hi, ' + currentUser?.name + ' 👋'}</h1>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <button
                                    type="button"
                                    onClick={() => setSoundEnabled(prev => !prev)}
                                    aria-label={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
                                    title={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
                                    style={{
                                        background: 'transparent',
                                        border: '1px solid var(--border)',
                                        color: 'var(--foreground)',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        width: '32px',
                                        height: '32px',
                                        lineHeight: 1,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '16px'
                                    }}
                                >
                                    {soundEnabled ? '🔊' : '🔇'}
                                </button>
                                <PushNotificationsControl compact authUid={authUid} />
                                <AdminPanel userEmail={currentUser?.email} onResetComplete={refreshUser} />
                                <button
                                    onClick={handleSignOut}
                                    style={{ color: 'var(--text-muted)', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    Sign out
                                </button>
                            </div>
                        </div>

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
                            authUid={authUid}
                            allUsers={allUsers}
                            allMessages={allMessages}
                            allReactions={allReactions}
                            recipientMessages={recipientMessages}
                            santaMessages={santaMessages}
                            unreadCounts={unreadCounts}
                            recipientConversationId={recipientConversationId}
                            santaConversationId={santaConversationId}
                        />
                    </div>
                </main>
            )}
        </AuthGuard>
    );
}
