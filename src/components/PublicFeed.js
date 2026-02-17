'use client';
import { useState, useEffect } from 'react';
import { updateLastReadTimestamp, getCachedTimestamp, getLastReadTimestamp } from '@/lib/lastReadClient';

function parseConversationId(conversationId) {
    if (!conversationId || typeof conversationId !== 'string') return null;
    const parts = conversationId.split('_recipient_');
    if (parts.length !== 2 || !parts[0].startsWith('santa_')) return null;

    return {
        santaId: parts[0].replace('santa_', ''),
        recipientId: parts[1],
    };
}

function getConversationId(santaId, recipientId) {
    if (!santaId || !recipientId) return null;
    return `santa_${santaId}_recipient_${recipientId}`;
}

function resolveLegacyRole(message, fromUser, toUser) {
    if (typeof message.isSantaMsg === 'boolean') {
        return { isSantaMsg: message.isSantaMsg, isAmbiguous: false };
    }

    const fromIsSantaToTo = fromUser?.recipientId === message.toId;
    const toIsSantaToFrom = toUser?.recipientId === message.fromId;

    if (fromIsSantaToTo && !toIsSantaToFrom) {
        return { isSantaMsg: true, isAmbiguous: false };
    }
    if (!fromIsSantaToTo && toIsSantaToFrom) {
        return { isSantaMsg: false, isAmbiguous: false };
    }

    // Legacy rows in mutual cycles are directionally ambiguous.
    // Keep sender identity visible instead of forcing a Santa label.
    return { isSantaMsg: false, isAmbiguous: true };
}

function resolveLegacyConversation(message, role) {
    if (!message?.fromId || !message?.toId) {
        return {
            conversationId: `legacy_${message?.id || Date.now()}`,
            recipientId: message?.toId || null,
            santaId: message?.fromId || null,
        };
    }

    if (!role.isAmbiguous) {
        const santaId = role.isSantaMsg ? message.fromId : message.toId;
        const recipientId = role.isSantaMsg ? message.toId : message.fromId;
        return {
            conversationId: getConversationId(santaId, recipientId),
            recipientId,
            santaId,
        };
    }

    const [santaId, recipientId] = [message.fromId, message.toId].sort();
    return {
        conversationId: getConversationId(santaId, recipientId),
        recipientId,
        santaId,
    };
}

export default function PublicFeed({ messages = [], allUsers = [], userId }) {
    const [selectedThread, setSelectedThread] = useState(null); // null = list view, string = recipientId
    const [lastViewed, setLastViewed] = useState(() => {
        // Lazy initialization: Load from localStorage for backwards compatibility
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('publicFeedLastViewed');
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch {
                    return {};
                }
            }
        }
        return {};
    });
    const usersById = new Map(allUsers.map(user => [user.id, user]));

    // Group messages by conversationId to ensure threads are consolidated correctly.
    const threads = {};
    messages.forEach(rawMsg => {
        // Resolve users to determine direction and names
        const fromUser = usersById.get(rawMsg.fromId);
        const toUser = usersById.get(rawMsg.toId);

        const parsedConversation = parseConversationId(rawMsg.conversationId);
        const legacyRole = parsedConversation ? null : resolveLegacyRole(rawMsg, fromUser, toUser);
        const legacyConversation = parsedConversation ? null : resolveLegacyConversation(rawMsg, legacyRole);

        const isSantaMsg = parsedConversation
            ? rawMsg.fromId === parsedConversation.santaId
            : legacyRole.isSantaMsg;
        const isAmbiguousLegacy = !parsedConversation && legacyRole.isAmbiguous;

        let fromName = rawMsg.fromName;
        let toName = rawMsg.toName;

        if (!fromName) {
            fromName = (isSantaMsg && !isAmbiguousLegacy)
                ? 'Secret Santa'
                : (fromUser?.name || 'Unknown');
        }
        if (!toName) {
            toName = (isSantaMsg && !isAmbiguousLegacy)
                ? (toUser?.name || 'Unknown')
                : ((isAmbiguousLegacy ? toUser?.name : 'Secret Santa') || 'Unknown');
        }

        const msg = {
            ...rawMsg,
            isSantaMsg,
            fromName,
            toName
        };

        let threadId;
        let recipientName;

        if (parsedConversation) {
            threadId = msg.conversationId;
            recipientName = usersById.get(parsedConversation.recipientId)?.name || 'Unknown';
        } else {
            threadId = legacyConversation.conversationId;
            recipientName = usersById.get(legacyConversation.recipientId)?.name || 'Unknown';
        }

        const stableThreadName = `🎁 ${recipientName}'s Gift Exchange`;

        if (!threads[threadId]) {
            threads[threadId] = {
                id: threadId,
                name: stableThreadName,
                messages: [],
                lastMessage: msg
            };
        }
        threads[threadId].messages.push(msg);
        // Update lastMessage if this message is newer
        if (new Date(msg.timestamp) > new Date(threads[threadId].lastMessage.timestamp)) {
            threads[threadId].lastMessage = msg;
        }
    });

    const threadList = Object.values(threads).sort((a, b) =>
        new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp)
    );
    const threadIdsKey = threadList.map(thread => thread.id).join('|');

    // Hydrate lastViewed from Firestore-backed lastRead documents on first load.
    useEffect(() => {
        const threadIds = threadIdsKey ? threadIdsKey.split('|') : [];
        if (!userId || threadIds.length === 0) return;

        let cancelled = false;

        const hydrateLastViewed = async () => {
            const remoteLastViewed = {};

            await Promise.all(threadIds.map(async (threadId) => {
                const publicFeedConversationId = `publicFeed_${threadId}`;

                let timestamp = getCachedTimestamp(userId, publicFeedConversationId);
                if (timestamp === undefined) {
                    timestamp = await getLastReadTimestamp(userId, publicFeedConversationId);
                }

                if (timestamp) {
                    remoteLastViewed[threadId] = timestamp;
                }
            }));

            if (cancelled || Object.keys(remoteLastViewed).length === 0) {
                return;
            }

            setLastViewed(prev => {
                let changed = false;
                const merged = { ...prev };

                Object.entries(remoteLastViewed).forEach(([threadId, remoteTimestamp]) => {
                    const localTimestamp = merged[threadId];
                    if (!localTimestamp || new Date(remoteTimestamp) > new Date(localTimestamp)) {
                        merged[threadId] = remoteTimestamp;
                        changed = true;
                    }
                });

                if (changed && typeof window !== 'undefined') {
                    localStorage.setItem('publicFeedLastViewed', JSON.stringify(merged));
                }

                return changed ? merged : prev;
            });
        };

        hydrateLastViewed();

        return () => {
            cancelled = true;
        };
    }, [userId, threadIdsKey]);

    // Calculate unread count for each thread
    threadList.forEach(thread => {
        const lastViewedTime = lastViewed[thread.id] || new Date(0).toISOString();
        thread.unreadCount = thread.messages.filter(
            msg => msg.timestamp > lastViewedTime
        ).length;
    });

    // Handle viewing a thread - mark as read
    const handleThreadClick = (threadId) => {
        const now = new Date().toISOString();
        const newLastViewed = { ...lastViewed, [threadId]: now };
        setLastViewed(newLastViewed);

        // Update localStorage for backwards compatibility
        localStorage.setItem('publicFeedLastViewed', JSON.stringify(newLastViewed));

        // Write to Firestore (debounced) if user is authenticated
        if (userId) {
            updateLastReadTimestamp(userId, `publicFeed_${threadId}`);
        }

        setSelectedThread(threadId);
    };

    return (
        <div className="card" style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            marginBottom: 0,
            overflow: 'hidden'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                {selectedThread && (
                    <button
                        onClick={() => setSelectedThread(null)}
                        className="btn"
                        style={{ width: 'auto', padding: '5px 10px', marginRight: '10px', fontSize: '12px' }}
                    >
                        ← Back
                    </button>
                )}
                <h3 className="subtitle" style={{ margin: 0 }}>
                    {selectedThread ? threads[selectedThread]?.name : 'Public Feed 🎄'}
                </h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {!selectedThread ? (
                    // Thread List
                    threadList.length === 0 ? (
                        <p className="text-muted">No active conversations yet...</p>
                    ) : (
                        threadList.map(thread => (
                            <div
                                key={thread.id}
                                onClick={() => handleThreadClick(thread.id)}
                                style={{
                                    padding: '12px',
                                    borderBottom: '1px solid var(--border)',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-highlight)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{thread.name}</div>
                                    <div className="text-muted" style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {thread.lastMessage.content}
                                    </div>
                                </div>
                                {thread.unreadCount > 0 && (
                                    <span style={{
                                        background: 'var(--primary)',
                                        color: 'white',
                                        fontSize: '11px',
                                        fontWeight: 'bold',
                                        padding: '4px 8px',
                                        borderRadius: '12px',
                                        minWidth: '24px',
                                        textAlign: 'center',
                                        marginLeft: '12px'
                                    }}>
                                        {thread.unreadCount}
                                    </span>
                                )}
                            </div>
                        ))
                    )
                ) : (
                    // Message View
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px' }}>
                        {(() => {
                            const sortedMessages = threads[selectedThread]?.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) || [];
                            const groups = [];

                            sortedMessages.forEach(msg => {
                                const lastGroup = groups[groups.length - 1];
                                const isSanta = msg.isSantaMsg === true;
                                const senderKey = isSanta ? 'santa' : `user_${msg.fromId || msg.fromName || 'unknown'}`;

                                if (lastGroup && lastGroup.senderKey === senderKey) {
                                    lastGroup.messages.push(msg);
                                } else {
                                    groups.push({
                                        id: msg.id, // Use first message id as group key
                                        isSanta,
                                        senderKey,
                                        fromName: msg.fromName,
                                        messages: [msg]
                                    });
                                }
                            });

                            return groups.map(group => (
                                <div key={group.id} style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: group.isSanta ? 'flex-end' : 'flex-start',
                                    width: '100%'
                                }}>
                                    <div style={{
                                        marginBottom: '4px',
                                        fontSize: '11px',
                                        fontWeight: '600',
                                        color: 'var(--text-muted)',
                                        padding: '0 4px'
                                    }}>
                                        {group.isSanta ? '🎅 Santa' : group.fromName}
                                    </div>

                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '2px',
                                        maxWidth: '85%',
                                        alignItems: group.isSanta ? 'flex-end' : 'flex-start'
                                    }}>
                                        {group.messages.map((msg, idx) => (
                                            <div key={msg.id} style={{
                                                padding: '8px 12px',
                                                background: 'var(--surface-highlight)',
                                                color: 'var(--foreground)',
                                                borderRadius: '4px',
                                                fontSize: '14px',
                                                borderLeft: !group.isSanta ? '3px solid var(--accent)' : 'none',
                                                borderRight: group.isSanta ? '3px solid var(--primary)' : 'none',
                                                marginBottom: '2px',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                            }}>
                                                {msg.content}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}
