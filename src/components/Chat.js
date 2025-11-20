'use client';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dynamic from 'next/dynamic';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';

// Dynamically import emoji picker to avoid SSR issues
const EmojiPicker = dynamic(
    () => import('emoji-picker-react'),
    { ssr: false }
);

// Format timestamp as relative time
function formatRelativeTime(timestamp) {
    const now = new Date();
    const messageTime = new Date(timestamp);
    const diffMs = now - messageTime;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;

    // For older messages, show the date
    const options = { month: 'short', day: 'numeric' };
    if (messageTime.getFullYear() !== now.getFullYear()) {
        options.year = 'numeric';
    }
    return messageTime.toLocaleDateString('en-US', options);
}

export default function Chat({ currentUser, otherUser, isSantaChat, unreadCount }) {
    // Use real-time message subscription instead of polling
    const messages = useRealtimeMessages(currentUser.id, otherUser.id);
    const [newMessage, setNewMessage] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const emojiPickerRef = useRef(null);

    // Mark messages as read when component mounts or messages change
    const markAsRead = async () => {
        await fetch('/api/unread', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                otherUserId: otherUser.id,
                userId: currentUser.id  // For dev mode
            })
        });
    };

    useEffect(() => {
        markAsRead(); // Mark as read when opening chat
    }, [currentUser.id, otherUser.id]);

    useEffect(() => {
        // Only auto-scroll if we're already near the bottom (within 100px)
        // This prevents annoying scroll jumps when user is reading old messages
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
            if (isNearBottom) {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [messages.length]); // Only trigger when message count changes

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromId: currentUser.id,
                toId: otherUser.id,
                content: newMessage
            })
        });

        setNewMessage('');
        // No need to manually fetch - real-time listener will update automatically
    };

    // Handle emoji selection
    const onEmojiClick = (emojiObject) => {
        const emoji = emojiObject.emoji;
        const input = inputRef.current;
        if (input) {
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const newText = newMessage.substring(0, start) + emoji + newMessage.substring(end);
            setNewMessage(newText);

            // Set cursor position after emoji
            setTimeout(() => {
                input.selectionStart = input.selectionEnd = start + emoji.length;
                input.focus();
            }, 0);
        } else {
            setNewMessage(newMessage + emoji);
        }
        setShowEmojiPicker(false);
    };

    // Close emoji picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
                setShowEmojiPicker(false);
            }
        };

        if (showEmojiPicker) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showEmojiPicker]);

    return (
        <div className="card" style={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
            <h3 className="subtitle" style={{
                borderBottom: '1px solid var(--border)',
                paddingBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}>
                {isSantaChat ? 'Chat with your Santa 🎅' : `Chat with ${otherUser.name} 🎁`}
                {unreadCount > 0 && (
                    <span style={{
                        background: 'var(--primary)',
                        color: 'white',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        minWidth: '20px',
                        textAlign: 'center'
                    }}>
                        {unreadCount}
                    </span>
                )}
            </h3>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
                {messages.map(msg => {
                    const isMe = msg.fromId === currentUser.id;
                    return (
                        <div key={msg.id} style={{
                            display: 'flex',
                            justifyContent: isMe ? 'flex-end' : 'flex-start',
                            marginBottom: '12px'
                        }}>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: isMe ? 'flex-end' : 'flex-start',
                                maxWidth: '70%'
                            }}>
                                <div style={{
                                    background: isMe ? 'var(--primary)' : 'var(--surface-highlight)',
                                    color: isMe ? 'white' : 'var(--foreground)',
                                    padding: '8px 12px',
                                    borderRadius: '12px',
                                    fontSize: '14px'
                                }}>
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            // Customize link styling
                                            a: ({ node, ...props }) => (
                                                <a {...props} style={{
                                                    color: isMe ? 'white' : 'var(--primary)',
                                                    textDecoration: 'underline'
                                                }} target="_blank" rel="noopener noreferrer" />
                                            ),
                                            // Prevent large headings in messages
                                            h1: ({ node, ...props }) => <strong {...props} />,
                                            h2: ({ node, ...props }) => <strong {...props} />,
                                            h3: ({ node, ...props }) => <strong {...props} />,
                                            // Break long words
                                            p: ({ node, ...props }) => <p {...props} style={{ margin: 0, wordBreak: 'break-word' }} />
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                </div>
                                <span style={{
                                    fontSize: '11px',
                                    color: 'var(--text-muted)',
                                    marginTop: '4px',
                                    paddingLeft: '4px',
                                    paddingRight: '4px'
                                }}>
                                    {formatRelativeTime(msg.timestamp)}
                                </span>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            <form onSubmit={sendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <input
                            ref={inputRef}
                            type="text"
                            className="input"
                            style={{ marginBottom: 0, paddingRight: '45px' }}
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..."
                        />
                        <button
                            type="button"
                            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                            style={{
                                position: 'absolute',
                                right: '8px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'transparent',
                                border: 'none',
                                fontSize: '20px',
                                cursor: 'pointer',
                                padding: '4px',
                                lineHeight: 1
                            }}
                            title="Add emoji"
                        >
                            😊
                        </button>
                    </div>
                    <button type="submit" className="btn" style={{ width: 'auto' }}>Send</button>
                </div>

                {showEmojiPicker && (
                    <div ref={emojiPickerRef} style={{ position: 'absolute', bottom: '60px', right: '0', zIndex: 1000 }}>
                        <EmojiPicker
                            onEmojiClick={onEmojiClick}
                            theme="dark"
                            width={300}
                            height={400}
                        />
                    </div>
                )}

                <div style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    paddingLeft: '4px'
                }}>
                    Tip: **bold** *italic* [link](url)
                </div>
            </form>
        </div>
    );
}
