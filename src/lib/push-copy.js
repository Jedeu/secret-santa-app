/**
 * Push notification copy: the only place that words a notification.
 *
 * Pure module (no Firebase SDK), shared by the server payload and the in-app toast.
 *
 * Anonymity: the title says which chat a message is in from the receiver's side
 * ("Your Santa" or "Your recipient") and never names anyone. Message text is previewed
 * only for messages from the receiver's Santa: the Santa is anonymous on the receiver's
 * phone, while a recipient's own words on their Santa's lock screen can reveal who that
 * Santa is buying for.
 */

import { parseGifMessageContent } from '@/lib/giphy-reference';
import { parseConversationId } from '@/lib/message-utils';

/** Chat tabs a notification can open, named from the receiver's side. */
export const PUSH_CHATS = ['santa', 'recipient'];

export const PREVIEW_MAX_LENGTH = 100;

const CHAT_TITLES = {
    santa: '🎅 Your Santa',
    recipient: '🎁 Your recipient',
};
const FALLBACK_TITLE = 'Secret Santa';

const HIDDEN_BODIES = {
    text: 'Sent you a message',
    reply: 'Replied to your message',
    photo: 'Sent a photo',
    gif: 'Sent a GIF',
};

export function isPushChat(value) {
    return PUSH_CHATS.includes(value);
}

/**
 * The receiver's chat tab for a message: 'santa' when the receiver's Santa sent it,
 * 'recipient' when the receiver's recipient did, else null.
 */
export function getReceiverChat(message) {
    const parsed = parseConversationId(message?.conversationId);
    if (!parsed || !message?.fromId || !message?.toId) return null;
    if (message.fromId === parsed.santaId && message.toId === parsed.recipientId) return 'santa';
    if (message.fromId === parsed.recipientId && message.toId === parsed.santaId) return 'recipient';
    return null;
}

// Line starts the chat renders as Markdown blocks: headings, quotes, list items.
const BLOCK_MARKER = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/;

function stripBlockMarkers(line) {
    let current = line;
    let next = current.replace(BLOCK_MARKER, '');
    while (next !== current) {
        current = next;
        next = current.replace(BLOCK_MARKER, '');
    }
    return current;
}

/** Plain text of a Markdown message, whitespace collapsed, cut to PREVIEW_MAX_LENGTH characters. */
export function toPreviewText(value) {
    if (typeof value !== 'string') return '';
    const plain = value
        .split('\n')
        .map(stripBlockMarkers)
        .join(' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`/g, '')
        .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
        .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
    const chars = Array.from(plain);
    if (chars.length <= PREVIEW_MAX_LENGTH) return plain;
    return `${chars.slice(0, PREVIEW_MAX_LENGTH - 1).join('').trimEnd()}…`;
}

/**
 * What a message is, for its notification.
 * @returns {{ kind: 'text'|'reply'|'photo'|'gif', text: string }}
 */
export function describeMessage(message) {
    const content = typeof message?.content === 'string' ? message.content : '';
    const attachment = message?.attachment;
    if (attachment && typeof attachment === 'object') {
        return { kind: attachment.format === 'gif' ? 'gif' : 'photo', text: toPreviewText(content) };
    }
    const gif = parseGifMessageContent(content);
    if (gif) {
        return { kind: 'gif', text: toPreviewText(gif.caption) };
    }
    return { kind: message?.replyToId ? 'reply' : 'text', text: toPreviewText(content) };
}

export function getChatTitle(chat) {
    return CHAT_TITLES[chat] || FALLBACK_TITLE;
}

function previewBody(kind, text) {
    if (kind === 'photo') return text ? `📷 Photo · ${text}` : '📷 Photo';
    if (kind === 'gif') return text ? `GIF · ${text}` : 'GIF';
    if (!text) return HIDDEN_BODIES[kind] || HIDDEN_BODIES.text;
    return kind === 'reply' ? `Replied: ${text}` : text;
}

/**
 * Title and body of one chat's notification.
 *
 * @param {{ chat: 'santa'|'recipient'|null, kind: string, text?: string, unread?: number|null }} args
 *   unread: unread messages in this chat including this one; a count shows only above 1.
 * @returns {{ title: string, body: string }}
 */
export function buildPushNotification({ chat, kind, text = '', unread = null }) {
    const baseTitle = getChatTitle(chat);
    const title = Number.isInteger(unread) && unread > 1 ? `${baseTitle} · ${unread} new` : baseTitle;
    const body = chat === 'santa'
        ? previewBody(kind, text)
        : HIDDEN_BODIES[kind] || HIDDEN_BODIES.text;
    return { title, body };
}

/** One line for the in-app toast: the chat's title and the notification body. */
export function formatPushToast({ chat, body } = {}) {
    const text = typeof body === 'string' && body.trim() ? body.trim() : HIDDEN_BODIES.text;
    return `${getChatTitle(isPushChat(chat) ? chat : null)}: ${text}`;
}
