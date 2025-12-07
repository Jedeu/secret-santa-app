'use client';
import Chat from '@/components/Chat';
import PublicFeed from '@/components/PublicFeed';

/**
 * ChatTabs - Renders the appropriate chat view based on active tab
 *
 * @param {Object} props
 * @param {'recipient'|'santa'|'feed'} props.activeTab - Currently active tab
 * @param {Object} props.currentUser - Current authenticated user
 * @param {Object[]} props.allUsers - All users in the system
 * @param {Object[]} props.allMessages - All messages (for public feed)
 * @param {Object[]} props.recipientMessages - Messages for recipient conversation
 * @param {Object[]} props.santaMessages - Messages for santa conversation
 * @param {Object} props.unreadCounts - Unread counts for each tab
 * @param {number} props.unreadCounts.recipient - Unread count for recipient tab
 * @param {number} props.unreadCounts.santa - Unread count for santa tab
 * @param {string} props.recipientConversationId - Conversation ID for recipient chat
 * @param {string} props.santaConversationId - Conversation ID for santa chat
 */
export default function ChatTabs({
    activeTab,
    currentUser,
    allUsers,
    allMessages,
    recipientMessages,
    santaMessages,
    unreadCounts,
    recipientConversationId,
    santaConversationId
}) {
    // Get recipient user info
    const recipientUser = allUsers.find(u => u.id === currentUser?.recipientId);

    if (activeTab === 'recipient') {
        return (
            <Chat
                currentUser={currentUser}
                otherUser={{
                    id: currentUser?.recipientId,
                    name: recipientUser?.name || 'Recipient'
                }}
                messages={recipientMessages}
                isSantaChat={false}
                unreadCount={unreadCounts?.recipient || 0}
                conversationId={recipientConversationId}
            />
        );
    }

    if (activeTab === 'santa') {
        return (
            <Chat
                currentUser={currentUser}
                otherUser={{
                    id: currentUser?.gifterId,
                    name: 'Santa'
                }}
                messages={santaMessages}
                isSantaChat={true}
                unreadCount={unreadCounts?.santa || 0}
                conversationId={santaConversationId}
            />
        );
    }

    if (activeTab === 'feed') {
        return (
            <PublicFeed
                messages={allMessages}
                allUsers={allUsers}
                userId={currentUser?.id}
            />
        );
    }

    return null;
}
