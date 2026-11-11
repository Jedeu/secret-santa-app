'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getDocs } from 'firebase/firestore';
import { useUser } from '@/hooks/useUser';
import { signOutCurrentUser } from '@/lib/sign-out';
import {
    useRealtimeUnreadCounts,
    useRealtimeAllMessages,
    useRealtimeAllMessagesLoading,
    useRealtimeAllReactions
} from '@/hooks/useRealtimeMessages';
import { getConversationId, filterMessages, buildViewerAssignmentMap } from '@/lib/message-utils';
import { getRosterNames } from '@/lib/participants';
import { yearCollectionRef } from '@/lib/year-client';

// Component imports
import AuthGuard from '@/components/AuthGuard';
import RecipientSelector from '@/components/RecipientSelector';
import AdminPanel from '@/components/AdminPanel';
import TabNavigation from '@/components/TabNavigation';
import ChatTabs from '@/components/ChatTabs';
import Sidebar from '@/components/Sidebar';
import ArchiveViewer from '@/components/ArchiveViewer';
import PushNotificationsControl from '@/components/PushNotificationsControl';
import PushNotificationsRuntime from '@/components/PushNotificationsRuntime';
import MessageOutboxRuntime from '@/components/MessageOutboxRuntime';
import NotificationSoundRuntime from '@/components/NotificationSoundRuntime';

const EMPTY_USERS = [];

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
        season,
        loading: isLoading,
        error: authError,
        refreshUser
    } = useUser();

    // Season (year) state
    const yearOpen = season?.state === 'active';
    const seasonYear = season?.year ?? null;
    const closedYears = season?.closedYears ?? [];
    const archiveYears = [...closedYears].sort((a, b) => b - a);

    // UI state
    const [showArchive, setShowArchive] = useState(false);
    const [activeTab, setActiveTab] = useState('recipient');
    const [soundEnabled, setSoundEnabled] = useState(() => {
        if (typeof window === 'undefined') {
            return true;
        }

        return window.localStorage.getItem('soundEnabled') !== 'false';
    });

    const adminControl = <AdminPanel userEmail={currentUser?.email} season={season} onComplete={refreshUser} />;

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

    // Users fetch: scoped to (account, profile, year, epoch), guarded per effect run, and
    // stored tagged with its scope key. Only a result for the current key is ever used.
    const usersScopeKey = currentUser && yearOpen
        ? `${authUid}|${currentUser.id}|${seasonYear}|${season.epoch}`
        : null;
    const [usersResult, setUsersResult] = useState({ key: null, users: EMPTY_USERS });

    useEffect(() => {
        if (!usersScopeKey) return undefined;
        let active = true;
        getDocs(yearCollectionRef(seasonYear, 'users'))
            .then((snapshot) => {
                if (!active) return;
                setUsersResult({ key: usersScopeKey, users: snapshot.docs.map((d) => d.data()) });
            })
            .catch((error) => {
                if (active) console.error('Failed to fetch users:', error);
            });
        return () => { active = false; };
    }, [currentUser, usersScopeKey, seasonYear]);

    const usersLoaded = usersScopeKey !== null && usersResult.key === usersScopeKey;
    const allUsers = usersLoaded ? usersResult.users : EMPTY_USERS;
    const currentUserName = currentUser?.name ?? '';
    const availableRecipients = useMemo(() => {
        if (!usersLoaded) return [];
        const mine = currentUserName.toLowerCase();
        return getRosterNames(seasonYear).filter((name) => {
            if (name.toLowerCase() === mine) return false;
            const row = allUsers.find((u) => u?.name?.toLowerCase() === name.toLowerCase());
            return !(row && row.gifterId);
        });
    }, [usersLoaded, allUsers, currentUserName, seasonYear]);

    // Check if user needs to set recipient
    const needsRecipient = currentUser && !currentUser.recipientId;

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem('soundEnabled', soundEnabled ? 'true' : 'false');
    }, [soundEnabled]);

    const standaloneHeader = (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <h1 className="title" data-testid="user-greeting" style={{ margin: 0, fontSize: '20px' }}>{'Hi, ' + currentUser?.name + ' 👋'}</h1>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {adminControl}
                <button
                    onClick={handleSignOut}
                    style={{ color: 'var(--text-muted)', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                    Sign out
                </button>
            </div>
        </div>
    );

    let body;
    if (!yearOpen) {
        // 1. The year is closed: read-only archive, no chat.
        body = (
            <main className="container" style={{ flexDirection: 'column' }}>
                {standaloneHeader}
                <ArchiveViewer
                    authUid={authUid}
                    years={archiveYears}
                    initialYear={seasonYear}
                    closedYears={closedYears}
                    banner={`The ${seasonYear} exchange is closed. You can browse it below; chats reopen when the next year starts.`}
                />
            </main>
        );
    } else if (needsRecipient && showArchive && archiveYears.length > 0) {
        // 2. Browsing past years before choosing a recipient.
        body = (
            <main className="container" style={{ flexDirection: 'column' }}>
                {standaloneHeader}
                <ArchiveViewer
                    authUid={authUid}
                    years={archiveYears}
                    initialYear={archiveYears[0]}
                    closedYears={closedYears}
                    onBack={() => setShowArchive(false)}
                />
            </main>
        );
    } else if (needsRecipient) {
        // 3. Choose a recipient in the open year.
        body = (
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={availableRecipients}
                year={seasonYear}
                onComplete={refreshUser}
                adminControl={adminControl}
                onBrowseArchive={archiveYears.length > 0 ? () => setShowArchive(true) : null}
            />
        );
    } else {
        // 4. Chats in the open year.
        body = (
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
                        adminControl={adminControl}
                        showArchive={archiveYears.length > 0}
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
                            {adminControl}
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
                            showArchive={archiveYears.length > 0}
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
                        archiveYears={archiveYears}
                        closedYears={closedYears}
                    />
                </div>
            </main>
        );
    }

    return (
        <AuthGuard
            isLoading={isLoading}
            currentUser={currentUser}
            authError={authError}
            authEmail={authEmail}
            onRetry={refreshUser}
        >
            <PushNotificationsRuntime currentUser={currentUser} authUid={authUid} />
            {yearOpen && <MessageOutboxRuntime currentUser={currentUser} authUid={authUid} />}
            <NotificationSoundRuntime
                soundEnabled={soundEnabled}
                currentUserId={currentUser?.id}
                allMessages={allMessages}
                allMessagesLoading={allMessagesLoading}
            />
            {body}
        </AuthGuard>
    );
}
