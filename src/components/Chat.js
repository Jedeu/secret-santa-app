'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dynamic from 'next/dynamic';
import { updateLastReadTimestamp, useOtherUserLastRead } from '@/hooks/useRealtimeMessages';
import { useTypingIndicator } from '@/hooks/useTypingIndicator';
import { useToast } from '@/components/ClientProviders';
import ReactionPicker from '@/components/ReactionPicker';
import ReactionChips from '@/components/ReactionChips';
import ReactionEmojiSheet from '@/components/ReactionEmojiSheet';
import MessageAttachment, { mediaBubbleWidth } from '@/components/MessageAttachment';
import GifPicker from '@/components/GifPicker';
import MessageGif from '@/components/MessageGif';
import MessageQuote from '@/components/MessageQuote';
import SwipeToReply from '@/components/SwipeToReply';
import { useMessageJump } from '@/hooks/useMessageJump';
import { getMessagePreviewText } from '@/lib/message-media';
import {
    enqueueMessage,
    getConversationOutboxMessages,
    subscribeOutbox,
    drainOutboxForUser,
    retryOutboxMessage,
    createClientMessageId
} from '@/lib/message-outbox';
import { setTyping, clearTyping } from '@/lib/typing-client';
import { toggleReaction } from '@/lib/reactions-client';
import { getLatestMessageTimestamp } from '@/lib/message-utils';
import { pickSantaTypingLine } from '@/lib/easter-eggs';
import {
    getMediaStatus,
    captureMediaSession,
    isMediaSessionCurrent,
    prepareImageForUpload,
    uploadMessageMedia,
    describeMediaError
} from '@/lib/media-client';
import { isGiphyConfigured } from '@/lib/giphy-client';
import {
    GIF_MESSAGE_MAX_LENGTH,
    buildGifMessageContent,
    getMessageGif,
    isGiphyId
} from '@/lib/giphy-reference';

const MEDIA_QUEUE_FAILURE_TEXT = "Couldn't queue the message on this device. Press Send to try again.";
const MEDIA_UPLOAD_FAILURE_TEXT = 'Upload failed. Press Send to try again.';
const GIF_UNAVAILABLE_TEXT = 'GIFs are unavailable right now.';
const GIF_CAPTION_TOO_LONG_TEXT = 'That caption is too long to send with a GIF. Shorten it and try again.';
const GIF_PREVIEW_FAILED_TEXT = 'Preview unavailable. You can still send this GIF.';

function hasAttachmentObject(message) {
    return !!message?.attachment && typeof message.attachment === 'object';
}

// GIF picker and draft state, bound to one composer identity. Each holder carries the
// media session captured when the picker opened, so any session change makes it stale.
function emptyGifState(identity) {
    return { identity, picker: null, draft: null };
}

function isGifHolderStale(holder) {
    return !!holder && !isMediaSessionCurrent(holder.session);
}

function revokePreviewUrl(draft) {
    if (draft?.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(draft.previewUrl);
    }
}

// Dynamically import emoji picker to avoid SSR issues
const EmojiPicker = dynamic(
    () => import('emoji-picker-react'),
    { ssr: false }
);

// Whether the tab is currently foregrounded. Background tabs must not mark
// messages as read (mirrors the gate in NotificationSoundRuntime.js).
function isDocumentVisible() {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
}

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

export default function Chat({
    currentUser,
    authUid = null,
    otherUser,
    isSantaChat,
    unreadCount,
    messages,
    conversationId,
    allReactions = [],
}) {
    // Use messages passed from parent instead of fetching internally
    // const messages = useRealtimeMessages(currentUser.id, otherUser.id);
    const [newMessage, setNewMessage] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    // The "+" drawer (Attach, Emoji, GIF). Its options stay mounted and are hidden with CSS.
    const [showAddMenu, setShowAddMenu] = useState(false);
    const addMenuRef = useRef(null);
    const addButtonRef = useRef(null);
    const [reactionPickerState, setReactionPickerState] = useState({
        conversationId,
        messageId: null,
    });
    const [outboxMessages, setOutboxMessages] = useState([]);
    // Image attachments. A capability result applies only to the uid it was fetched for.
    const [mediaStatus, setMediaStatus] = useState({ uid: null, enabled: false });
    const mediaEnabled = !!authUid && mediaStatus.uid === authUid && mediaStatus.enabled;
    // null | { phase: 'preparing', clientMessageId }
    //      | { phase: 'ready'|'uploading'|'error', clientMessageId, blob, mimeType, previewUrl, uploaded, errorText }
    const [draftMedia, setDraftMedia] = useState(null);
    const isMediaUploading = draftMedia?.phase === 'uploading';
    const isMediaPreparing = draftMedia?.phase === 'preparing';
    // GIFs: picker null | { session }; draft null | { session, id, title, urls, urlIndex, previewFailed }.
    const gifEnabled = isGiphyConfigured();
    const gifIdentity = `${authUid || ''}|${currentUser.id}|${otherUser.id}|${conversationId}`;
    const [gifState, setGifState] = useState(() => emptyGifState(gifIdentity));
    if (gifState.identity !== gifIdentity || isGifHolderStale(gifState.picker) || isGifHolderStale(gifState.draft)) {
        // Conditional reset during render: clears, does not hide.
        setGifState(emptyGifState(gifIdentity));
    }
    const gifPicker = gifEnabled ? gifState.picker : null;
    const draftGif = gifState.draft;
    // Reply draft, bound to the same composer identity: switching chats drops it.
    const [replyState, setReplyState] = useState({ identity: gifIdentity, messageId: null });
    // Quotes resolve only within this conversation's messages.
    const messagesById = useMemo(() => new Map(messages.map((msg) => [msg.id, msg])), [messages]);
    const replyTarget = replyState.identity === gifIdentity && replyState.messageId
        ? messagesById.get(replyState.messageId) || null
        : null;
    const { containerRef: messageListRef, highlightedId, jumpTo } = useMessageJump();
    const draftMediaRef = useRef(null);
    const uploadTokenRef = useRef(0);
    const uploadAbortRef = useRef(null);
    const sendingMediaRef = useRef(false);
    const mountedRef = useRef(false);
    const fileInputRef = useRef(null);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    const emojiPickerRef = useRef(null);
    const lastReadRef = useRef(0);
    const wasNearBottomRef = useRef(true);
    const otherLastReadAt = useOtherUserLastRead(otherUser.id, conversationId);
    const isOtherTyping = useTypingIndicator(conversationId, otherUser.id);
    // One line per typing session: the Santa chat now and then shows a playful one.
    const [santaTyping, setSantaTyping] = useState({ active: false, line: '' });
    if (isSantaChat && santaTyping.active !== isOtherTyping) {
        // Conditional update during render, as for gifState above.
        setSantaTyping({ active: isOtherTyping, line: isOtherTyping ? pickSantaTypingLine() : '' });
    }
    const { showToast } = useToast();
    // The label this chat already shows for a message's sender; quotes reuse it.
    const senderLabel = (msg) => {
        if (msg.fromId === currentUser.id) return 'You';
        return isSantaChat ? 'Santa 🎅' : otherUser.name;
    };
    // Read markers record the latest message the user has actually observed,
    // never "now" (a message stamped later than the marker stays unread).
    const latestObservedAt = getLatestMessageTimestamp(messages);

    useEffect(() => {
        const syncOutbox = () => {
            setOutboxMessages(getConversationOutboxMessages({
                fromUserId: currentUser.id,
                conversationId
            }));
        };

        syncOutbox();
        const unsubscribe = subscribeOutbox(syncOutbox);

        return unsubscribe;
    }, [currentUser.id, conversationId]);

    // Re-render once a minute so relative timestamps ("Just now", "5m ago")
    // don't go stale between message-driven renders. Skips ticks while the
    // tab is backgrounded; the next foreground tick catches labels up.
    const [, setTimestampTick] = useState(0);
    useEffect(() => {
        const intervalId = setInterval(() => {
            if (isDocumentVisible()) {
                setTimestampTick(tick => tick + 1);
            }
        }, 60_000);

        return () => clearInterval(intervalId);
    }, []);

    // Mark messages as read when component mounts, user changes, OR new messages arrive
    // This ensures badge clears even when new messages arrive while viewing the tab.
    // Gate on visibility: a background tab must not clear the badge (see visibilitychange
    // effect below, which flushes the read marker once the tab is foregrounded again).
    useEffect(() => {
        if (!isDocumentVisible() || !latestObservedAt) return;
        // IMPORTANT: Use the conversationId passed from parent (new format)
        // NOT getLegacyConversationId which would cause format mismatch
        updateLastReadTimestamp(currentUser.id, otherUser.id, conversationId, latestObservedAt);
        lastReadRef.current = Date.now();
    }, [currentUser.id, otherUser.id, messages, conversationId, latestObservedAt]);

    const scrollToBottom = (behavior = 'smooth') => {
        bottomRef.current?.scrollIntoView({ behavior });
    };

    const isNearBottom = (chatContainer) => {
        if (!chatContainer) return true;
        const thresholdPx = 40;
        return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < thresholdPx;
    };

    const checkIfRead = () => {
        // Scroll events also fire from the programmatic auto-scroll effect below,
        // which runs in hidden tabs too — so this path needs the visibility gate.
        if (!isDocumentVisible()) return;
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            const isAtBottom = isNearBottom(chatContainer);
            wasNearBottomRef.current = isAtBottom;
            if (isAtBottom && latestObservedAt) {
                // Debounce: only update if > 2 seconds since last update
                const now = Date.now();
                if (now - lastReadRef.current > 2000) {
                    updateLastReadTimestamp(currentUser.id, otherUser.id, conversationId, latestObservedAt);
                    lastReadRef.current = now;
                }
            }
        }
    };

    useEffect(() => {
        // Check if content fits in viewport (no scroll needed) -> Mark as read.
        // Skip in a background tab so a hidden chat never clears its own badge.
        if (!isDocumentVisible() || !latestObservedAt) return;
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            if (chatContainer.scrollHeight <= chatContainer.clientHeight) {
                // Debounce: only update if > 2 seconds since last update
                const now = Date.now();
                if (now - lastReadRef.current > 2000) {
                    updateLastReadTimestamp(currentUser.id, otherUser.id, conversationId, latestObservedAt);
                    lastReadRef.current = now;
                }
            }
        }
    }, [messages, currentUser.id, otherUser.id, conversationId, latestObservedAt]);

    useEffect(() => {
        // Auto-scroll if I sent the latest message OR if user was already near bottom.
        const chatContainer = bottomRef.current?.parentElement;
        if (chatContainer) {
            const lastMessage = messages[messages.length - 1];
            const isMyMessage = lastMessage?.fromId === currentUser.id;
            const shouldStickToBottom = isMyMessage || wasNearBottomRef.current || outboxMessages.length > 0;

            if (shouldStickToBottom) {
                scrollToBottom(isMyMessage ? 'auto' : 'smooth');
                wasNearBottomRef.current = true;
            }
        }
    }, [messages, currentUser.id, outboxMessages.length]);

    const handleScroll = (e) => {
        checkIfRead();
    };

    // Mounted flag for late async results. Unmount revokes the preview URL; it neither
    // aborts an in-flight upload nor changes the upload token.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            revokePreviewUrl(draftMediaRef.current);
        };
    }, []);

    // Capability probe for this account; a result for another uid is never applied.
    useEffect(() => {
        if (!authUid) return undefined;
        let active = true;
        Promise.resolve(getMediaStatus({ ownerUid: authUid }))
            .then((enabled) => {
                if (active && enabled === true) {
                    setMediaStatus({ uid: authUid, enabled: true });
                }
            })
            .catch(() => { });
        return () => {
            active = false;
        };
    }, [authUid]);

    // Every draft change goes through here; state is set only while mounted.
    const setDraft = (next) => {
        draftMediaRef.current = next;
        if (mountedRef.current) {
            setDraftMedia(next);
        }
    };

    const attachFile = async (file) => {
        if (!file) return;
        const current = draftMediaRef.current;
        if (current?.phase === 'uploading') {
            showToast('An image is uploading. Remove it before attaching another.');
            return;
        }
        setGifState((prev) => (prev.picker || prev.draft ? { ...prev, picker: null, draft: null } : prev));

        revokePreviewUrl(current);
        const clientMessageId = createClientMessageId();
        setDraft({ phase: 'preparing', clientMessageId });

        let prepared = null;
        let failure = null;
        try {
            prepared = await prepareImageForUpload(file);
        } catch (error) {
            failure = error;
        }

        // Apply only to this same draft, still preparing, in a mounted composer.
        const latest = draftMediaRef.current;
        if (!mountedRef.current || latest?.phase !== 'preparing' || latest.clientMessageId !== clientMessageId) {
            return;
        }
        if (failure || !prepared?.blob) {
            setDraft(null);
            showToast(describeMediaError(failure));
            return;
        }
        setDraft({
            phase: 'ready',
            clientMessageId,
            blob: prepared.blob,
            mimeType: prepared.mimeType,
            previewUrl: URL.createObjectURL(prepared.blob),
            uploaded: null,
            errorText: null,
        });
    };

    const handlePaste = (event) => {
        if (!mediaEnabled) return;
        const files = event.clipboardData?.files;
        if (!files || !files.length) return;
        let image = null;
        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            if (file && typeof file.type === 'string' && file.type.startsWith('image/')) {
                image = file;
                break;
            }
        }
        if (!image) return;
        event.preventDefault();
        attachFile(image);
    };

    const handleFileChange = (event) => {
        const input = event.target;
        const file = input?.files?.[0] || null;
        if (input) {
            input.value = '';
        }
        if (file) {
            attachFile(file);
        }
    };

    const removeDraftMedia = () => {
        // Invalidate first, then abort: a late result or error is ignored by the token.
        uploadTokenRef.current += 1;
        const controller = uploadAbortRef.current;
        uploadAbortRef.current = null;
        if (controller) {
            controller.abort();
        }
        sendingMediaRef.current = false;
        revokePreviewUrl(draftMediaRef.current);
        setDraft(null);
    };

    const sendDraftMedia = async (draft) => {
        if (sendingMediaRef.current || draft.phase === 'preparing') return;

        const session = captureMediaSession({ ownerUid: authUid, fromUserId: currentUser.id });
        if (!session || !otherUser?.id || !conversationId) {
            showToast('Failed to queue message. Please try again.');
            return;
        }

        if (!draft.uploaded && typeof navigator !== 'undefined' && navigator.onLine === false) {
            showToast(describeMediaError({ code: 'OFFLINE' }));
            return;
        }

        const captured = {
            ownerUid: authUid,
            fromUserId: currentUser.id,
            toId: otherUser.id,
            conversationId,
            content: newMessage.trim(),
            clientMessageId: draft.clientMessageId,
            ...(replyTarget ? { replyToId: replyTarget.id } : {}),
        };
        uploadTokenRef.current += 1;
        const token = uploadTokenRef.current;
        const isTokenCurrent = () => uploadTokenRef.current === token;
        sendingMediaRef.current = true;
        clearTyping(captured.fromUserId, captured.conversationId);

        // Own-draft rule: after a stale-session result, clear only this composer's draft,
        // only while mounted and only while this send is still the current one.
        const clearOwnDraft = () => {
            if (!mountedRef.current || !isTokenCurrent()) return;
            revokePreviewUrl(draftMediaRef.current);
            setDraft(null);
        };

        try {
            let attachment = draft.uploaded;
            if (!attachment) {
                const controller = new AbortController();
                uploadAbortRef.current = controller;
                setDraft({ ...draft, phase: 'uploading', uploaded: null, errorText: null });
                setShowEmojiPicker(false);
                try {
                    attachment = await uploadMessageMedia({
                        session,
                        fromUserId: captured.fromUserId,
                        toId: captured.toId,
                        conversationId: captured.conversationId,
                        clientMessageId: captured.clientMessageId,
                        blob: draft.blob,
                        mimeType: draft.mimeType,
                        signal: controller.signal,
                    });
                } catch (error) {
                    if (!isTokenCurrent()) return;
                    if (error?.code === 'SESSION_CHANGED' || !isMediaSessionCurrent(session)) {
                        clearOwnDraft();
                        return;
                    }
                    if (error?.code === 'MESSAGE_ALREADY_SENT') {
                        if (mountedRef.current) {
                            revokePreviewUrl(draftMediaRef.current);
                            setDraft(null);
                        }
                        return;
                    }
                    if (mountedRef.current) {
                        setDraft({ ...draft, phase: 'error', uploaded: null, errorText: MEDIA_UPLOAD_FAILURE_TEXT });
                    }
                    showToast(describeMediaError(error));
                    return;
                } finally {
                    if (uploadAbortRef.current === controller) {
                        uploadAbortRef.current = null;
                    }
                }
            }

            // Stale checks before any effect.
            if (!isTokenCurrent()) return;
            if (!isMediaSessionCurrent(session)) {
                clearOwnDraft();
                return;
            }

            try {
                enqueueMessage({ ...captured, attachment });
            } catch (error) {
                console.error('Error enqueuing image message:', error);
                if (mountedRef.current) {
                    setDraft({ ...draft, phase: 'error', uploaded: attachment, errorText: MEDIA_QUEUE_FAILURE_TEXT });
                }
                showToast(MEDIA_QUEUE_FAILURE_TEXT);
                return;
            }

            drainOutboxForUser({ ownerUid: captured.ownerUid, fromUserId: captured.fromUserId }).catch((error) => {
                console.error('Outbox drain failed after enqueue:', error);
            });
            if (mountedRef.current) {
                revokePreviewUrl(draftMediaRef.current);
                setDraft(null);
                setNewMessage('');
                clearReply(captured.replyToId);
                scrollToBottom('auto');
            }
        } finally {
            if (isTokenCurrent()) {
                sendingMediaRef.current = false;
            }
        }
    };

    // --- GIFs: every write is fenced by holder identity inside a functional updater ---

    const closeGifPicker = (holder) => {
        setGifState((prev) => (prev.picker === holder ? { ...prev, picker: null } : prev));
    };

    const toggleGifPicker = () => {
        if (isMediaUploading || sendingMediaRef.current || draftMediaRef.current) return;
        setShowEmojiPicker(false);
        if (gifPicker) {
            closeGifPicker(gifPicker);
            return;
        }
        const session = captureMediaSession({ ownerUid: authUid, fromUserId: currentUser.id });
        if (!session || !otherUser?.id || !conversationId) {
            showToast(GIF_UNAVAILABLE_TEXT);
            return;
        }
        setGifState((prev) => (prev.identity === gifIdentity && !prev.picker ? { ...prev, picker: { session } } : prev));
    };

    const handleGifSelect = (holder, gif) => {
        if (sendingMediaRef.current || draftMediaRef.current) {
            closeGifPicker(holder);
            return;
        }
        if (!isMediaSessionCurrent(holder.session)) {
            setGifState((prev) => (prev.picker === holder ? emptyGifState(prev.identity) : prev));
            return;
        }
        if (!isGiphyId(gif?.id)) return;
        const urls = Array.isArray(gif.previewUrls) ? gif.previewUrls.filter((url) => typeof url === 'string') : [];
        const draft = {
            session: holder.session,
            id: gif.id,
            title: typeof gif.title === 'string' ? gif.title : '',
            urls,
            urlIndex: 0,
            previewFailed: urls.length === 0,
        };
        setGifState((prev) => (prev.picker === holder ? { ...prev, picker: null, draft } : prev));
    };

    const removeDraftGif = (draft) => {
        setGifState((prev) => (prev.draft === draft ? { ...prev, draft: null } : prev));
    };

    const handleGifPreviewError = (draft, failedUrl) => {
        setGifState((prev) => {
            if (prev.draft !== draft || draft.urls[draft.urlIndex] !== failedUrl) return prev;
            const nextIndex = draft.urlIndex + 1;
            if (nextIndex < draft.urls.length) {
                return { ...prev, draft: { ...draft, urlIndex: nextIndex } };
            }
            return { ...prev, draft: { ...draft, previewFailed: true } };
        });
    };

    const sendMessage = async (e) => {
        e.preventDefault();
        const draft = draftMediaRef.current;
        if (draft) {
            await sendDraftMedia(draft);
            return;
        }
        const caption = newMessage.trim();
        const gif = gifState.draft;
        if (gif && !isMediaSessionCurrent(gif.session)) {
            setGifState((prev) => emptyGifState(prev.identity));
            showToast('Failed to queue message. Please try again.');
            return;
        }
        let content = caption;
        if (gif) {
            const built = buildGifMessageContent(gif.id, caption);
            if (built === null) {
                removeDraftGif(gif);
                return;
            }
            if (built.length > GIF_MESSAGE_MAX_LENGTH) {
                showToast(GIF_CAPTION_TOO_LONG_TEXT);
                return;
            }
            content = built;
        }
        if (!content) {
            clearTyping(currentUser.id, conversationId);
            return;
        }
        clearTyping(currentUser.id, conversationId);

        try {
            enqueueMessage({
                ownerUid: authUid,
                fromUserId: currentUser.id,
                toId: otherUser.id,
                conversationId,
                content,
                ...(replyTarget ? { replyToId: replyTarget.id } : {})
            });
            setNewMessage('');
            clearReply(replyTarget?.id);
            if (gif) {
                removeDraftGif(gif);
            }
            scrollToBottom('auto');
            drainOutboxForUser({ ownerUid: authUid, fromUserId: currentUser.id }).catch((error) => {
                console.error('Outbox drain failed after enqueue:', error);
            });
        } catch (error) {
            console.error('Error enqueuing message:', error);
            showToast('Failed to queue message. Please try again.');
        }
    };

    const startReply = (msg) => {
        setReplyState({ identity: gifIdentity, messageId: msg.id });
        inputRef.current?.focus();
    };

    // Clears the reply draft only while it still quotes this message.
    const clearReply = (messageId) => {
        if (!messageId) return;
        setReplyState((prev) => (prev.messageId === messageId ? { ...prev, messageId: null } : prev));
    };

    const retryFailedMessage = (clientMessageId) => {
        const didSchedule = retryOutboxMessage({
            fromUserId: currentUser.id,
            clientMessageId,
        });

        if (!didSchedule) {
            showToast('Message is no longer available to retry.');
            return;
        }

        drainOutboxForUser({ ownerUid: authUid, fromUserId: currentUser.id }).catch((error) => {
            console.error('Outbox drain failed after manual retry:', error);
        });
    };

    const handleToggleReaction = async (messageId, emoji) => {
        try {
            await toggleReaction(messageId, currentUser.id, emoji);
        } catch (error) {
            console.error('Failed to toggle reaction:', error);
            showToast('Unable to update reaction. Please try again.');
        }
    };

    const handleInputChange = (e) => {
        const value = e.target.value;
        setNewMessage(value);

        if (!value.trim()) {
            clearTyping(currentUser.id, conversationId);
            return;
        }

        setTyping(currentUser.id, conversationId);
    };

    // Handle emoji selection
    const onEmojiClick = (emojiObject) => {
        // The caption is captured when an image send starts; a queued or still-open
        // picker must not change it while that send is in flight.
        if (sendingMediaRef.current) {
            setShowEmojiPicker(false);
            return;
        }
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

    // Close the "+" drawer on an outside tap, and move focus into it when it opens.
    useEffect(() => {
        if (!showAddMenu) return undefined;
        addMenuRef.current?.querySelector('button:not([disabled])')?.focus();
        const onPointer = (event) => {
            if (addMenuRef.current?.contains(event.target) || addButtonRef.current?.contains(event.target)) return;
            setShowAddMenu(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('touchstart', onPointer);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('touchstart', onPointer);
        };
    }, [showAddMenu]);

    const toggleEmojiPicker = () => {
        if (gifPicker) {
            closeGifPicker(gifPicker);
        }
        setShowEmojiPicker(!showEmojiPicker);
    };


    const hasSomethingToSend = !!newMessage.trim() || !!draftMedia || !!draftGif;

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

    // The quick row and the full picker (`full`) never show together.
    const reactionTargetId =
        reactionPickerState.conversationId === conversationId
            ? reactionPickerState.messageId
            : null;
    const reactionPickerMessageId = reactionPickerState.full ? null : reactionTargetId;
    const reactionSheetMessageId = reactionPickerState.full ? reactionTargetId : null;
    const closeReactionPicker = () => setReactionPickerState({ conversationId, messageId: null });

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                clearTyping(currentUser.id, conversationId);
                return;
            }
            // Tab was foregrounded: flush the read marker for messages that arrived
            // while hidden. The messages effect is visibility-gated and won't fire on
            // its own until the next messages change, so do it here.
            if (!latestObservedAt) return;
            updateLastReadTimestamp(currentUser.id, otherUser.id, conversationId, latestObservedAt);
            lastReadRef.current = Date.now();
        };

        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [currentUser.id, otherUser.id, conversationId, latestObservedAt]);

    useEffect(() => {
        return () => {
            clearTyping(currentUser.id, conversationId);
        };
    }, [currentUser.id, conversationId]);

    return (
        <div className="card" style={{
            flex: 1,
            minHeight: 0, // Crucial for flex scrolling
            display: 'flex',
            flexDirection: 'column',
            marginBottom: 0, // Remove margin in full-height mode
            overflow: 'hidden' // Ensure content doesn't spill out
        }}>
            {/* The selected tab names the chat on screen; this heading (and its live unread
                count) stays for screen readers. */}
            <h3 className="sr-only">
                {isSantaChat ? 'Chat with your Santa 🎅' : `Chat with ${otherUser.name} 🎁`}
                {unreadCount > 0 && (
                    <span style={{
                        background: 'var(--badge-bg)',
                        color: 'var(--badge-fg)',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        minWidth: '20px',
                        textAlign: 'center'
                    }}
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        aria-label={`${unreadCount} unread messages`}
                    >
                        {unreadCount}
                    </span>
                )}
            </h3>
            {isOtherTyping && (
                <div className="chat-typing" style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    padding: '4px 0'
                }}>
                    {isSantaChat ? santaTyping.line : `${otherUser.name} is typing...`}
                </div>
            )}

            <div
                ref={messageListRef}
                style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 0' }}
                onScroll={handleScroll}
            >
                {messages.map(msg => {
                    const isMe = msg.fromId === currentUser.id;
                    const isReadReceipt = Boolean(isMe && otherLastReadAt && msg.timestamp && otherLastReadAt >= msg.timestamp);
                    const gif = getMessageGif(msg);
                    const text = gif ? gif.caption : msg.content;
                    const quoted = msg.replyToId ? messagesById.get(msg.replyToId) || null : null;
                    return (
                        <SwipeToReply key={msg.id} onReply={() => startReply(msg)}>
                        <div style={{
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
                                        {senderLabel(msg)}
                                    </span>
                                )}
                                <div
                                    data-message-id={msg.id}
                                    onClick={() => {
                                        setReactionPickerState((prev) => {
                                            if (
                                                prev.conversationId === conversationId &&
                                                prev.messageId === msg.id
                                            ) {
                                                return { conversationId, messageId: null };
                                            }
                                            return { conversationId, messageId: msg.id };
                                        });
                                    }}
                                    style={{
                                        background: isMe ? 'var(--bubble-own-bg)' : 'var(--bubble-other-bg)',
                                        color: isMe ? 'var(--bubble-own-fg)' : 'var(--bubble-other-fg)',
                                        padding: '8px 12px',
                                        borderRadius: isMe
                                            ? 'var(--bubble-radius) var(--bubble-radius) var(--bubble-tail) var(--bubble-radius)'
                                            : 'var(--bubble-radius) var(--bubble-radius) var(--bubble-radius) var(--bubble-tail)',
                                        fontSize: '14px',
                                        boxShadow: isMe ? 'var(--bubble-own-shadow)' : 'var(--bubble-shadow)',
                                        // An image or GIF sets the width; its caption wraps under it.
                                        width: mediaBubbleWidth(msg, gif) ?? undefined,
                                        maxWidth: '100%',
                                        position: 'relative',
                                        cursor: 'pointer',
                                        outline: highlightedId === msg.id ? '2px solid var(--accent)' : '2px solid transparent',
                                        // Inset: the list clips horizontal overflow, and own bubbles sit at its edge.
                                        outlineOffset: '-2px',
                                        transition: 'outline-color 300ms ease'
                                    }}
                                >
                                    {msg.replyToId && (
                                        <MessageQuote
                                            target={quoted}
                                            label={quoted ? senderLabel(quoted) : ''}
                                            onJump={jumpTo}
                                            tone={isMe ? 'own' : 'other'}
                                        />
                                    )}
                                    {hasAttachmentObject(msg) && (
                                        <MessageAttachment attachment={msg.attachment} />
                                    )}
                                    {gif && <MessageGif id={gif.id} />}
                                    {text ? (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                // Customize link styling
                                                a: ({ node, ...props }) => (
                                                    <a {...props} style={{
                                                        color: isMe ? 'var(--bubble-own-link)' : 'var(--link)',
                                                        textDecoration: 'underline'
                                                    }} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} />
                                                ),
                                                // Prevent large headings in messages
                                                h1: ({ node, ...props }) => <strong {...props} />,
                                                h2: ({ node, ...props }) => <strong {...props} />,
                                                h3: ({ node, ...props }) => <strong {...props} />,
                                                // Break long words
                                                p: ({ node, ...props }) => <p {...props} style={{ margin: 0, wordBreak: 'break-word' }} />
                                            }}
                                        >
                                            {text}
                                        </ReactMarkdown>
                                    ) : null}
                                    {reactionPickerMessageId === msg.id && (
                                        <ReactionPicker
                                            onClose={closeReactionPicker}
                                            onSelect={(emoji) => handleToggleReaction(msg.id, emoji)}
                                            onMore={() => setReactionPickerState({ conversationId, messageId: msg.id, full: true })}
                                            onReply={() => startReply(msg)}
                                        />
                                    )}
                                </div>
                                <div style={{ alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
                                    <ReactionChips
                                        messageId={msg.id}
                                        allReactions={allReactions}
                                        currentUserId={currentUser.id}
                                        onToggle={(emoji) => handleToggleReaction(msg.id, emoji)}
                                    />
                                </div>
                                <span className="chat-meta" style={{
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                    marginTop: '2px',
                                    paddingRight: isMe ? '4px' : 0,
                                    paddingLeft: isMe ? 0 : '4px',
                                    opacity: 'var(--meta-opacity)'
                                }}>
                                    {formatRelativeTime(msg.timestamp)}
                                    {isMe && (
                                        <span
                                            aria-label={isReadReceipt ? 'Read' : 'Delivered'}
                                            title={isReadReceipt ? 'Read' : 'Delivered'}
                                            style={{
                                                marginLeft: '6px',
                                                color: isReadReceipt ? 'var(--read-tick)' : 'var(--text-muted)',
                                                fontWeight: '600'
                                            }}
                                        >
                                            {isReadReceipt ? '✓✓' : '✓'}
                                        </span>
                                    )}
                                </span>
                            </div>
                        </div>
                        </SwipeToReply>
                    );
                })}
                {outboxMessages.map((msg) => {
                    const isFailed = msg.status === 'failed';
                    const gif = getMessageGif(msg);
                    const quoted = msg.replyToId ? messagesById.get(msg.replyToId) || null : null;
                    return (
                        <div key={msg.clientMessageId} style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            marginBottom: '12px'
                        }}>
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                maxWidth: '75%'
                            }}>
                                <div style={{
                                    background: isFailed ? 'var(--failed-bg)' : 'var(--pending-bg)',
                                    color: isFailed ? 'var(--failed-fg)' : 'var(--pending-fg)',
                                    padding: '8px 12px',
                                    borderRadius: 'var(--bubble-radius) var(--bubble-radius) var(--bubble-tail) var(--bubble-radius)',
                                    fontSize: '14px',
                                    border: isFailed ? 'var(--failed-border)' : 'var(--pending-border)',
                                    width: mediaBubbleWidth(msg, gif) ?? undefined,
                                    maxWidth: '100%'
                                }}>
                                    {msg.replyToId && (
                                        <MessageQuote
                                            target={quoted}
                                            label={quoted ? senderLabel(quoted) : ''}
                                            onJump={jumpTo}
                                            tone="own"
                                        />
                                    )}
                                    {hasAttachmentObject(msg) && (
                                        <MessageAttachment attachment={msg.attachment} />
                                    )}
                                    {gif && <MessageGif id={gif.id} />}
                                    {gif ? gif.caption : msg.content}
                                </div>
                                <span style={{
                                    fontSize: '10px',
                                    color: 'var(--text-muted)',
                                    marginTop: '2px',
                                    paddingRight: '4px',
                                    opacity: 0.85,
                                    display: 'inline-flex',
                                    gap: '8px',
                                    alignItems: 'center'
                                }}>
                                    {isFailed ? 'Failed to send' : 'Sending...'}
                                    {isFailed && (
                                        <button
                                            type="button"
                                            onClick={() => retryFailedMessage(msg.clientMessageId)}
                                            className="btn"
                                            style={{ width: 'auto', padding: '2px 8px', fontSize: '10px' }}
                                        >
                                            Retry
                                        </button>
                                    )}
                                </span>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {reactionSheetMessageId && (
                <ReactionEmojiSheet
                    onClose={closeReactionPicker}
                    onSelect={(emoji) => handleToggleReaction(reactionSheetMessageId, emoji)}
                />
            )}

            {gifPicker && (
                <GifPicker
                    onSelect={(gif) => handleGifSelect(gifPicker, gif)}
                    onClose={() => closeGifPicker(gifPicker)}
                    canRequest={() => isMediaSessionCurrent(gifPicker.session)}
                />
            )}

            <form
                onSubmit={sendMessage}
                onKeyDown={(event) => {
                    // Escape closes the "+" drawer first; otherwise, anywhere in the composer
                    // (the reply preview included), it cancels the reply.
                    if (event.key === 'Escape' && showAddMenu) {
                        setShowAddMenu(false);
                        addButtonRef.current?.focus();
                        return;
                    }
                    if (event.key === 'Escape' && replyTarget) {
                        clearReply(replyTarget.id);
                    }
                }}
                className="chat-composer"
                style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}
            >
                {replyTarget && (
                    <div
                        data-testid="composer-reply"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 6px 6px 10px',
                            border: '1px solid var(--border)',
                            borderLeft: '3px solid var(--quote-bar)',
                            borderRadius: '8px',
                            minWidth: 0
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => jumpTo(replyTarget.id)}
                            aria-label={`Replying to ${senderLabel(replyTarget)}. Show original message`}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                textAlign: 'left',
                                font: 'inherit',
                                color: 'inherit',
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer'
                            }}
                        >
                            <span style={{ fontSize: '12px', fontWeight: 600 }}>
                                Replying to {senderLabel(replyTarget)}
                            </span>
                            <span style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {getMessagePreviewText(replyTarget)}
                            </span>
                        </button>
                        <button
                            type="button"
                            aria-label="Cancel reply"
                            title="Cancel reply"
                            onClick={() => clearReply(replyTarget.id)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                fontSize: '18px',
                                cursor: 'pointer',
                                padding: '4px',
                                lineHeight: 1,
                                flexShrink: 0
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
                {draftMedia && (
                    <div
                        data-testid="composer-attachment"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            minWidth: 0
                        }}
                    >
                        {draftMedia.phase !== 'preparing' && draftMedia.previewUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={draftMedia.previewUrl}
                                alt="Attachment preview"
                                style={{
                                    maxWidth: '96px',
                                    maxHeight: '96px',
                                    objectFit: 'contain',
                                    borderRadius: '6px',
                                    display: 'block',
                                    flexShrink: 0
                                }}
                            />
                        )}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span
                                data-testid="composer-attachment-status"
                                aria-live="polite"
                                style={{ fontSize: '12px', overflowWrap: 'anywhere' }}
                            >
                                {draftMedia.phase === 'preparing'
                                    ? 'Preparing…'
                                    : draftMedia.phase === 'uploading'
                                        ? 'Uploading…'
                                        : draftMedia.phase === 'error'
                                            ? (draftMedia.errorText || '')
                                            : ''}
                            </span>
                        </div>
                        <button
                            type="button"
                            aria-label="Remove image"
                            title="Remove image"
                            onClick={removeDraftMedia}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                fontSize: '18px',
                                cursor: 'pointer',
                                padding: '4px',
                                lineHeight: 1,
                                flexShrink: 0
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
                {!draftMedia && draftGif && (
                    <div
                        data-testid="composer-gif"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            minWidth: 0
                        }}
                    >
                        {!draftGif.previewFailed && typeof draftGif.urls[draftGif.urlIndex] === 'string' && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                key={draftGif.urls[draftGif.urlIndex]}
                                data-testid="composer-gif-preview"
                                src={draftGif.urls[draftGif.urlIndex]}
                                alt="GIF preview"
                                referrerPolicy="no-referrer"
                                onError={() => handleGifPreviewError(draftGif, draftGif.urls[draftGif.urlIndex])}
                                style={{
                                    maxWidth: '96px',
                                    maxHeight: '96px',
                                    objectFit: 'contain',
                                    borderRadius: '6px',
                                    display: 'block',
                                    flexShrink: 0
                                }}
                            />
                        )}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {draftGif.previewFailed && (
                                <span
                                    data-testid="composer-gif-status"
                                    aria-live="polite"
                                    style={{ fontSize: '12px', overflowWrap: 'anywhere' }}
                                >
                                    {GIF_PREVIEW_FAILED_TEXT}
                                </span>
                            )}
                            <span
                                style={{
                                    display: 'block',
                                    boxSizing: 'border-box',
                                    width: '100%',
                                    maxWidth: '172px',
                                    background: '#000',
                                    padding: '4px 6px',
                                    borderRadius: '4px'
                                }}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    data-testid="composer-gif-attribution"
                                    src="/giphy/PoweredBy_200px-Black_HorizLogo.png"
                                    alt="Powered by GIPHY"
                                    width={200}
                                    height={26}
                                    style={{ display: 'block', width: '100%', maxWidth: '160px', height: 'auto' }}
                                />
                            </span>
                        </div>
                        <button
                            type="button"
                            aria-label="Remove GIF"
                            title="Remove GIF"
                            onClick={() => removeDraftGif(draftGif)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                fontSize: '18px',
                                cursor: 'pointer',
                                padding: '4px',
                                lineHeight: 1,
                                flexShrink: 0
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
                <div className="composer-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        ref={addButtonRef}
                        type="button"
                        className={'composer-add' + (showAddMenu ? ' is-open' : '')}
                        aria-label="Add attachment, emoji or GIF"
                        title="Add"
                        aria-expanded={showAddMenu}
                        aria-controls="composer-add-menu"
                        onClick={() => setShowAddMenu((prev) => !prev)}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                    <div
                        ref={addMenuRef}
                        id="composer-add-menu"
                        role="group"
                        aria-label="Add to message"
                        className={'composer-add-menu' + (showAddMenu ? ' is-open' : '')}
                    >
                        {mediaEnabled && (
                            <button
                                type="button"
                                className="composer-add-item"
                                onClick={() => {
                                    setShowAddMenu(false);
                                    fileInputRef.current?.click();
                                }}
                                aria-label="Attach image"
                                title="Attach image"
                                disabled={isMediaUploading}
                            >
                                <span className="composer-add-icon" aria-hidden="true">📎</span>
                                <span>Photo</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className="composer-add-item"
                            onClick={() => {
                                setShowAddMenu(false);
                                toggleEmojiPicker();
                            }}
                            aria-label="Add emoji"
                            title="Add emoji"
                            disabled={isMediaUploading}
                        >
                            <span className="composer-add-icon" aria-hidden="true">😊</span>
                            <span>Emoji</span>
                        </button>
                        {gifEnabled && (
                            <button
                                type="button"
                                className="composer-add-item"
                                aria-label="Choose a GIF"
                                title="Choose a GIF"
                                aria-expanded={!!gifPicker}
                                disabled={isMediaUploading || !!draftMedia}
                                onClick={() => {
                                    setShowAddMenu(false);
                                    toggleGifPicker();
                                }}
                            >
                                <span className="composer-add-icon composer-add-gif" aria-hidden="true">GIF</span>
                                <span>GIF</span>
                            </button>
                        )}
                    </div>
                    {mediaEnabled && (
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif"
                            data-testid="composer-file-input"
                            onChange={handleFileChange}
                            tabIndex={-1}
                            aria-hidden="true"
                            style={{ display: 'none' }}
                        />
                    )}
                    <input
                        ref={inputRef}
                        type="text"
                        className="input composer-input"
                        style={{ marginBottom: 0, flex: 1, minWidth: 0 }}
                        value={newMessage}
                        onChange={handleInputChange}
                        onBlur={() => clearTyping(currentUser.id, conversationId)}
                        onPaste={handlePaste}
                        disabled={isMediaUploading}
                        placeholder="Type a message..."
                        aria-label="Message"
                    />
                    <button
                        type="submit"
                        className="composer-send"
                        aria-label="Send"
                        title="Send"
                        disabled={isMediaUploading || isMediaPreparing || !hasSomethingToSend}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" fill="currentColor" />
                        </svg>
                        Send
                    </button>
                </div>

                {showEmojiPicker && (
                    <div ref={emojiPickerRef} className="composer-emoji" style={{ position: 'absolute', bottom: '56px', left: '0', zIndex: 1000 }}>
                        <EmojiPicker
                            onEmojiClick={onEmojiClick}
                            theme="dark"
                            width={300}
                            height={400}
                        />
                    </div>
                )}
            </form>
        </div>
    );
}
