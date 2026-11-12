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
import { getRevealState } from '@/lib/recipient-reveal';

// Component imports
import AuthGuard from '@/components/AuthGuard';
import RecipientSelector from '@/components/RecipientSelector';
import RecipientReveal from '@/components/RecipientReveal';
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
const USERS_FETCH_TIMEOUT_MS = 10000;

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
        refreshUser,
        acknowledgeReveal
    } = useUser();

    // Season (year) state
    const yearOpen = season?.state === 'active';
    const seasonYear = season?.year ?? null;
    const closedYears = season?.closedYears ?? [];
    const archiveYears = [...closedYears].sort((a, b) => b - a);

    // UI state
    // "Browse past years" before choosing or confirming a recipient applies only to the
    // users scope (account, profile, year, epoch) in which it was pressed.
    const [archiveScopeKey, setArchiveScopeKey] = useState(null);
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
    // A rejection or a 10 s timeout marks the scope failed, but never discards a list that
    // already loaded for this scope; a later success still replaces a failed result.
    const usersScopeKey = currentUser && yearOpen
        ? `${authUid}|${currentUser.id}|${seasonYear}|${season.epoch}`
        : null;
    const [usersResult, setUsersResult] = useState({ key: null, users: EMPTY_USERS, failed: false });
    const [usersReload, setUsersReload] = useState(0);
    const showArchive = usersScopeKey !== null && archiveScopeKey === usersScopeKey;

    useEffect(() => {
        if (!usersScopeKey) return undefined;
        let active = true;
        const markFailed = () => {
            setUsersResult((prev) => (prev.key === usersScopeKey && !prev.failed
                ? prev
                : { key: usersScopeKey, users: EMPTY_USERS, failed: true }));
        };
        let timer = setTimeout(() => {
            timer = null;
            if (active) markFailed();
        }, USERS_FETCH_TIMEOUT_MS);
        const clearTimer = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };
        getDocs(yearCollectionRef(seasonYear, 'users'))
            .then((snapshot) => {
                clearTimer();
                if (!active) return;
                setUsersResult({ key: usersScopeKey, users: snapshot.docs.map((d) => d.data()), failed: false });
            })
            .catch((error) => {
                clearTimer();
                if (!active) return;
                console.error('Failed to fetch users:', error);
                markFailed();
            });
        return () => {
            active = false;
            clearTimer();
        };
    }, [currentUser, usersScopeKey, seasonYear, usersReload]);

    const usersSettled = usersScopeKey !== null && usersResult.key === usersScopeKey;
    const usersLoaded = usersSettled && !usersResult.failed;
    const usersFailed = usersSettled && usersResult.failed;
    const allUsers = usersLoaded ? usersResult.users : EMPTY_USERS;

    const retryUsers = useCallback(() => {
        setUsersResult((prev) => (prev.failed ? { key: null, users: EMPTY_USERS, failed: false } : prev));
        setUsersReload((n) => n + 1);
    }, []);
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

    // Automatic draw: a pending or unusable automatic profile is gated by the reveal.
    // Manual profiles (no drawMode) choose a recipient as before.
    const revealState = getRevealState(currentUser);
    const revealGate = !!currentUser && (revealState === 'pending' || revealState === 'invalid');
    const needsRecipient = currentUser && revealState === 'manual' && !currentUser.recipientId;

    // The recipient's name comes only from the row whose id is the caller's recipientId in
    // the users result for the current scope.
    const revealRow = revealState === 'pending' && usersLoaded
        ? allUsers.find((u) => u?.id === currentUser.recipientId)
        : null;
    const revealRecipientName = typeof revealRow?.name === 'string' && revealRow.name.trim() ? revealRow.name : null;
    const revealStatus = revealState === 'invalid' ? 'invalid'
        : usersFailed ? 'error'
        : !usersLoaded ? 'loading'
        : revealRecipientName ? 'ready' : 'error';

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
    } else if ((needsRecipient || revealGate) && showArchive && archiveYears.length > 0) {
        // 2. Browsing past years before choosing or confirming a recipient.
        body = (
            <main className="container" style={{ flexDirection: 'column' }}>
                {standaloneHeader}
                <ArchiveViewer
                    authUid={authUid}
                    years={archiveYears}
                    initialYear={archiveYears[0]}
                    closedYears={closedYears}
                    onBack={() => setArchiveScopeKey(null)}
                />
            </main>
        );
    } else if (revealGate) {
        // 3. One-time reveal of the recipient drawn at Start (or the unavailable card).
        body = (
            <RecipientReveal
                key={`${usersScopeKey}|${currentUser.recipientId ?? ''}`}
                currentUser={currentUser}
                year={seasonYear}
                status={revealStatus}
                recipientName={revealRecipientName}
                onAcknowledge={acknowledgeReveal}
                onRetry={revealState === 'invalid' ? refreshUser : retryUsers}
                adminControl={adminControl}
                onBrowseArchive={archiveYears.length > 0 ? () => setArchiveScopeKey(usersScopeKey) : null}
            />
        );
    } else if (needsRecipient) {
        // 4. Choose a recipient in the open year (manual years).
        body = (
            <RecipientSelector
                currentUser={currentUser}
                availableRecipients={availableRecipients}
                year={seasonYear}
                onComplete={refreshUser}
                adminControl={adminControl}
                onBrowseArchive={archiveYears.length > 0 ? () => setArchiveScopeKey(usersScopeKey) : null}
            />
        );
    } else {
        // 5. Chats in the open year.
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
