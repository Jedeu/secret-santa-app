'use client';
import { useState, useEffect } from 'react';
import { useRealtimeAllMessages } from '@/hooks/useRealtimeMessages';

export default function PublicFeed() {
    // Use real-time message subscription instead of polling
    const messages = useRealtimeAllMessages();
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
    messages.forEach(msg => {
        // We need to identify the "Recipient" user ID in this pair.
        // Based on our API logic:
        // If isSantaMsg=true, from=Santa, to=Recipient. RecipientID is toId.
        // If isSantaMsg=false, from=Recipient, to=Santa. RecipientID is fromId.

        // However, the public API masks IDs for the Santa side?
        // Let's check the API response structure from previous steps.
        // The API returns the original msg object + fromName/toName masked.
        // It does NOT mask the IDs in the object itself, only the names are computed for display?
        // Wait, looking at route.js:
        // return { ...msg, fromName: ..., toName: ... }
        // It returns the full message object.
        // So we have fromId and toId.

        // We need to know which ID belongs to the "Recipient" role in this specific exchange.
        // But we don't have the user database here to know who is whose recipient.
        // We only have the message.
        // Fortunately, the API adds `isSantaMsg`.
        // If isSantaMsg === true: from=Santa, to=Recipient. Key = msg.toId.
        // If isSantaMsg === false: from=Recipient, to=Santa. Key = msg.fromId.

        let threadId;
        let threadName;

        if (msg.isSantaMsg) {
            threadId = msg.toId;
            threadName = `Santa ➔ ${msg.toName}`;
        } else {
            threadId = msg.fromId;
            threadName = `${msg.fromName} ➔ Santa`;
        }

        // Actually, we want a stable name for the thread, like "Exchange: Bob".
        // If isSantaMsg=true, toName is Bob.
        // If isSantaMsg=false, fromName is Bob.
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
        <div className="card">
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

            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {threads[selectedThread]?.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(msg => (
                            <div key={msg.id} style={{
                                padding: '8px 12px',
                                background: 'var(--surface-highlight)',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}>
                                <div style={{ marginBottom: '4px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                                    {msg.fromName} ➔ {msg.toName}
                                </div>
                                <div>{msg.content}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
