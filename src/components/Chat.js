'use client';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dynamic from 'next/dynamic';
import { useRealtimeMessages, updateLastReadTimestamp } from '@/hooks/useRealtimeMessages';
import { firestore } from '@/lib/firebase-client';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

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

export default function Chat({ currentUser, otherUser, isSantaChat, unreadCount, messages }) {
    // Use messages passed from parent instead of fetching internally
    // const messages = useRealtimeMessages(currentUser.id, otherUser.id);
    const [newMessage, setNewMessage] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const emojiPickerRef = useRef(null);

    // Mark messages as read when component mounts or messages change
    useEffect(() => {
        updateLastReadTimestamp(currentUser.id, otherUser.id);
    }, [currentUser.id, otherUser.id]);

    const scrollToBottom = (behavior = 'smooth') => {
        bottomRef.current?.scrollIntoView({ behavior });
    };

    const checkIfRead = () => {
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 20;
            if (isAtBottom) {
                // Debounce: only update if > 2 seconds since last update
                const now = Date.now();
                if (now - lastReadRef.current > 2000) {
                    updateLastReadTimestamp(currentUser.id, otherUser.id);
                    lastReadRef.current = now;
                }
            }
        }
    };

    useEffect(() => {
        // Check if content fits in viewport (no scroll needed) -> Mark as read
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            if (chatContainer.scrollHeight <= chatContainer.clientHeight) {
                // Debounce: only update if > 2 seconds since last update
                const now = Date.now();
                if (now - lastReadRef.current > 2000) {
                    updateLastReadTimestamp(currentUser.id, otherUser.id);
                    lastReadRef.current = now;
                }
            }
        }
    }, [messages, currentUser.id, otherUser.id]);

    useEffect(() => {
        // Auto-scroll logic for *my* messages
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            const lastMessage = messages[messages.length - 1];
            const isMyMessage = lastMessage?.fromId === currentUser.id;

            if (isMyMessage) {
                // Use 'auto' for instant scroll if it's my message to avoid lag perception
                scrollToBottom('auto');
            }
        }
    }, [messages, currentUser.id]);

    const handleScroll = (e) => {
        checkIfRead();
    };

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        try {
            // Write directly to Firestore for instant updates
            const messageData = {
                id: uuidv4(),
                fromId: currentUser.id,
                toId: otherUser.id,
                content: newMessage.trim(),
                timestamp: new Date().toISOString() // Use ISO string for consistency
            };

            await addDoc(collection(firestore, 'messages'), messageData);
            setNewMessage('');
            // Force scroll to bottom immediately after sending
            scrollToBottom('auto');
        } catch (error) {
            console.error('Error sending message:', error);
            alert('Failed to send message. Please try again.');
        }
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
        <div className="card" style={{
            flex: 1,
            minHeight: 0, // Crucial for flex scrolling
            display: 'flex',
            flexDirection: 'column',
            marginBottom: 0, // Remove margin in full-height mode
            overflow: 'hidden' // Ensure content doesn't spill out
        }}>
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

            <div
                style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}
                onScroll={handleScroll}
            >
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
                                maxWidth: '75%'
                            }}>
                                {!isMe && (
                                    <span style={{
                                        fontSize: '11px',
                                        color: 'var(--text-muted)',
                                        marginBottom: '2px',
                                        marginLeft: '4px',
                                        fontWeight: '500'
                                    }}>
                                        {isSantaChat ? (msg.fromId === currentUser.id ? 'You' : 'Santa 🎅') : (msg.fromId === currentUser.id ? 'You' : otherUser.name)}
                                    </span>
                                )}
                                <div style={{
                                    background: isMe ? 'var(--primary)' : 'var(--surface-highlight)',
                                    color: isMe ? 'white' : 'var(--foreground)',
                                    padding: '8px 12px',
                                    borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                                    fontSize: '14px',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
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
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                    marginTop: '2px',
                                    paddingRight: isMe ? '4px' : 0,
                                    paddingLeft: isMe ? 0 : '4px',
                                    opacity: 0.8
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
