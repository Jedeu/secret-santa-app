'use client';
import Chat from '@/components/Chat';
import PublicFeed from '@/components/PublicFeed';
import ArchiveViewer from '@/components/ArchiveViewer';

/**
 * ChatTabs - Renders the appropriate chat view based on active tab
 *
 * Each Chat is keyed by its tab and conversation, so drafts and per-chat state never
 * follow a tab switch or an assignment change. PublicFeed is keyed by user id. The
 * Archives tab renders the read-only ArchiveViewer for closed years.
 *
 * @param {Object} props
 * @param {'recipient'|'santa'|'feed'|'archive'} props.activeTab - Currently active tab
 * @param {Object} props.currentUser - Current authenticated user
 * @param {string|null} props.authUid - Firebase Auth uid that owns queued messages
 * @param {Object[]} props.allUsers - All users in the system
 * @param {Object[]} props.allMessages - All messages (for public feed)
 * @param {Object[]} props.recipientMessages - Messages for recipient conversation
 * @param {Object[]} props.santaMessages - Messages for santa conversation
 * @param {Object[]} props.allReactions - Reactions for all messages
 * @param {Object} props.unreadCounts - Unread counts for each tab
 * @param {number} props.unreadCounts.recipient - Unread count for recipient tab
 * @param {number} props.unreadCounts.santa - Unread count for santa tab
 * @param {string} props.recipientConversationId - Conversation ID for recipient chat
 * @param {string} props.santaConversationId - Conversation ID for santa chat
 * @param {number[]} [props.archiveYears] - Closed years, newest first
 * @param {number[]} [props.closedYears] - Closed years (lifecycle order)
 */
export default function ChatTabs({
    activeTab,
    currentUser,
    authUid = null,
    allUsers,
    allMessages,
    allReactions,
    recipientMessages,
    santaMessages,
    unreadCounts,
    recipientConversationId,
    santaConversationId,
    archiveYears = [],
    closedYears = []
}) {
    if (activeTab === 'archive') {
        return (
            <ArchiveViewer
                key="archive"
                authUid={authUid}
                years={archiveYears}
                initialYear={archiveYears[0]}
                closedYears={closedYears}
            />
        );
    }

    // Get recipient user info
    const recipientUser = allUsers.find(u => u.id === currentUser?.recipientId);

    if (activeTab === 'recipient') {
        return (
            <Chat
                key={'recipient:' + recipientConversationId}
                currentUser={currentUser}
                authUid={authUid}
                otherUser={{
                    id: currentUser?.recipientId,
                    name: recipientUser?.name || 'Recipient'
                }}
                messages={recipientMessages}
                isSantaChat={false}
                unreadCount={unreadCounts?.recipient || 0}
                conversationId={recipientConversationId}
                allReactions={allReactions}
            />
        );
    }

    if (activeTab === 'santa') {
        return (
            <Chat
                key={'santa:' + santaConversationId}
                currentUser={currentUser}
                authUid={authUid}
                otherUser={{
                    id: currentUser?.gifterId,
                    name: 'Santa'
                }}
                messages={santaMessages}
                isSantaChat={true}
                unreadCount={unreadCounts?.santa || 0}
                conversationId={santaConversationId}
                allReactions={allReactions}
            />
        );
    }

    if (activeTab === 'feed') {
        return (
            <PublicFeed
                key={currentUser?.id}
                messages={allMessages}
                allReactions={allReactions}
                allUsers={allUsers}
                userId={currentUser?.id}
            />
        );
    }

    return null;
}
