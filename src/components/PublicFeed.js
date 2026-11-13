'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { updateLastReadTimestamp, getCachedTimestamp, getLastReadTimestamp } from '@/lib/lastReadClient';
import { buildAssignmentMap, resolveMessageConversation } from '@/lib/message-utils';
import ReactionChips from '@/components/ReactionChips';
import MessageAttachment from '@/components/MessageAttachment';
import { getMessagePreviewText } from '@/lib/message-media';

// Legacy per-browser key; no longer read (it was shared across accounts).
const LEGACY_LAST_VIEWED_KEY = 'publicFeedLastViewed';

function isDocumentVisible() {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function laterIso(a, b) {
    if (!a) return b;
    if (!b) return a;
    return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

export default function PublicFeed({ messages = [], allReactions = [], allUsers = [], userId }) {
    const [selectedThread, setSelectedThread] = useState(null); // null = list view, string = threadId
    // Hydrated read markers only: { [threadId]: ISO timestamp of the latest observed message }.
    // Threads without a hydrated marker show no unread badge.
    const [markers, setMarkers] = useState({});
    const markedRef = useRef({});

    // Discard the legacy shared key without reading it.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.removeItem(LEGACY_LAST_VIEWED_KEY);
        } catch {
            // ignore storage errors
        }
    }, []);

    // Group messages by resolved conversation to ensure threads are consolidated correctly.
    const { threadsById, threadList } = useMemo(() => {
        const usersById = new Map(allUsers.map(user => [user.id, user]));
        const assignments = buildAssignmentMap(allUsers);
        const threadsById = {};
        messages.forEach(rawMsg => {
            // Resolve users to determine direction and names
            const fromUser = usersById.get(rawMsg.fromId);
            const toUser = usersById.get(rawMsg.toId);

            const resolved = resolveMessageConversation(rawMsg, assignments);
            const isSantaMsg = resolved.isSantaMsg;
            const isAmbiguousLegacy = resolved.isAmbiguous;

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

            const threadId = resolved.conversationId;
            const recipientName = usersById.get(resolved.recipientId)?.name || 'Unknown';

            const stableThreadName = `🎁 ${recipientName}'s Gift Exchange`;

            if (!threadsById[threadId]) {
                threadsById[threadId] = {
                    id: threadId,
                    name: stableThreadName,
                    messages: [],
                    lastMessage: msg
                };
            }
            threadsById[threadId].messages.push(msg);
            // Update lastMessage if this message is newer
            if (new Date(msg.timestamp) > new Date(threadsById[threadId].lastMessage.timestamp)) {
                threadsById[threadId].lastMessage = msg;
            }
        });

        Object.values(threadsById).forEach(thread => {
            thread.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        });

        const threadList = Object.values(threadsById).sort((a, b) =>
            new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp)
        );

        return { threadsById, threadList };
    }, [messages, allUsers]);

    const threadIdsKey = threadList.map(thread => thread.id).join('|');

    // Hydrate markers from Firestore-backed lastRead documents.
    useEffect(() => {
        const threadIds = threadIdsKey ? threadIdsKey.split('|') : [];
        if (!userId || threadIds.length === 0) return;

        let cancelled = false;

        const hydrateMarkers = async () => {
            const remoteMarkers = {};

            await Promise.all(threadIds.map(async (threadId) => {
                const publicFeedConversationId = `publicFeed_${threadId}`;

                let timestamp = getCachedTimestamp(userId, publicFeedConversationId);
                if (timestamp === undefined) {
                    timestamp = await getLastReadTimestamp(userId, publicFeedConversationId);
                }

                if (timestamp) {
                    remoteMarkers[threadId] = timestamp;
                }
            }));

            if (cancelled || Object.keys(remoteMarkers).length === 0) {
                return;
            }

            setMarkers(prev => {
                let changed = false;
                const merged = { ...prev };

                Object.entries(remoteMarkers).forEach(([threadId, remoteTimestamp]) => {
                    const next = laterIso(merged[threadId], remoteTimestamp);
                    if (next !== merged[threadId]) {
                        merged[threadId] = next;
                        changed = true;
                    }
                });

                return changed ? merged : prev;
            });
        };

        hydrateMarkers();

        return () => {
            cancelled = true;
        };
    }, [userId, threadIdsKey]);

    // Calculate unread count for each hydrated thread without mutating the memoized objects
    const threadListWithUnread = useMemo(() => threadList.map(thread => {
        const marker = markers[thread.id];
        if (!marker) {
            return { ...thread, unreadCount: 0 };
        }
        const markerMs = new Date(marker).getTime();
        const unreadCount = thread.messages.filter(
            msg => new Date(msg.timestamp).getTime() > markerMs
        ).length;
        return { ...thread, unreadCount };
    }), [threadList, markers]);

    // Mark a thread read up to its latest message timestamp (the observed boundary).
    const markThreadRead = useCallback((threadId) => {
        const boundary = threadsById[threadId]?.lastMessage?.timestamp;
        if (!threadId || !boundary) return;
        if (markedRef.current[threadId] === boundary) return;
        markedRef.current[threadId] = boundary;

        setMarkers(prev => {
            const next = laterIso(prev[threadId], boundary);
            return next === prev[threadId] ? prev : { ...prev, [threadId]: next };
        });

        // Write to Firestore (debounced) if user is authenticated
        if (userId) {
            updateLastReadTimestamp(userId, `publicFeed_${threadId}`, boundary);
        }
    }, [threadsById, userId]);

    // Handle viewing a thread - mark as read
    const handleThreadClick = (threadId) => {
        markThreadRead(threadId);
        setSelectedThread(threadId);
    };

    // While a thread is open: mark new messages read as they arrive (only while visible),
    // and catch up when the tab becomes visible again.
    const selectedLatestTimestamp = selectedThread
        ? threadsById[selectedThread]?.lastMessage?.timestamp || null
        : null;

    useEffect(() => {
        if (!selectedThread || !selectedLatestTimestamp) return undefined;

        if (isDocumentVisible()) {
            markThreadRead(selectedThread);
        }

        const onVisibility = () => {
            if (isDocumentVisible()) {
                markThreadRead(selectedThread);
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [selectedThread, selectedLatestTimestamp, markThreadRead]);

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
                    {selectedThread ? threadsById[selectedThread]?.name : 'Public Feed 🎄'}
                </h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {!selectedThread ? (
                    // Thread List
                    threadListWithUnread.length === 0 ? (
                        <p className="text-muted">No active conversations yet...</p>
                    ) : (
                        threadListWithUnread.map(thread => (
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
                                        {getMessagePreviewText(thread.lastMessage)}
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
                            const sortedMessages = threadsById[selectedThread]?.messages || [];
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
                                        {group.messages.map((msg) => (
                                            <div key={msg.id} style={{ width: '100%' }}>
                                                <div style={{
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
                                                    {msg.attachment && typeof msg.attachment === 'object' && (
                                                        <MessageAttachment attachment={msg.attachment} />
                                                    )}
                                                    {msg.content ? msg.content : null}
                                                </div>
                                                <ReactionChips
                                                    messageId={msg.id}
                                                    allReactions={allReactions}
                                                    currentUserId={userId}
                                                    onToggle={null}
                                                />
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
