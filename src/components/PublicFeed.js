'use client';
import { useState, useEffect } from 'react';

export default function PublicFeed({ messages = [], allUsers = [] }) {
    const [selectedThread, setSelectedThread] = useState(null); // null = list view, string = recipientId
    const [lastViewed, setLastViewed] = useState({}); // Track when each thread was last viewed

    useEffect(() => {
        // Load last viewed times from localStorage
        const saved = localStorage.getItem('publicFeedLastViewed');
        if (saved) {
            setLastViewed(JSON.parse(saved));
        }
    }, []);

    // Group messages by the "Recipient" of the Secret Santa pair.
    // In every pair, there is one Santa and one Recipient.
    // The Recipient is the public identity that defines the thread (e.g. "Santa for Bob").
    const threads = {};
    messages.forEach(rawMsg => {
        // Resolve users to determine direction and names
        const fromUser = allUsers.find(u => u.id === rawMsg.fromId);
        const toUser = allUsers.find(u => u.id === rawMsg.toId);

        let isSantaMsg = rawMsg.isSantaMsg;

        // If isSantaMsg is undefined, derive it from user relationships
        if (isSantaMsg === undefined) {
            if (fromUser && fromUser.recipientId === rawMsg.toId) {
                isSantaMsg = true; // Santa -> Recipient
            } else if (toUser && toUser.gifterId === rawMsg.fromId) {
                isSantaMsg = true; // Santa -> Recipient (checked via recipient)
            } else {
                isSantaMsg = false; // Recipient -> Santa
            }
        }

        let fromName = rawMsg.fromName;
        let toName = rawMsg.toName;

        if (!fromName) {
            fromName = isSantaMsg ? 'Secret Santa' : (fromUser?.name || 'Unknown');
        }
        if (!toName) {
            toName = isSantaMsg ? (toUser?.name || 'Unknown') : 'Secret Santa';
        }

        const msg = {
            ...rawMsg,
            isSantaMsg,
            fromName,
            toName
        };

        let threadId;
        // We group by the Recipient's ID to keep the conversation together
        if (msg.isSantaMsg) {
            threadId = msg.toId;
        } else {
            threadId = msg.fromId;
        }

        // Stable name for the thread
        const recipientName = msg.isSantaMsg ? msg.toName : msg.fromName;
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
        localStorage.setItem('publicFeedLastViewed', JSON.stringify(newLastViewed));
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
                                <div style={{ flex: 1 }}>
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
                                const isSanta = msg.isSantaMsg;

                                if (lastGroup && lastGroup.isSanta === isSanta) {
                                    lastGroup.messages.push(msg);
                                } else {
                                    groups.push({
                                        id: msg.id, // Use first message id as group key
                                        isSanta,
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
