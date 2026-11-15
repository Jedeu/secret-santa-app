/**
 * GIPHY GIF message reference: the only builder and parser.
 *
 * Pure module (no Firebase SDK, no imports), shared by every renderer.
 *
 * A GIF message is an ordinary text message whose first line is exactly
 * `https://giphy.com/embed/{id}`, optionally followed by a newline and a caption.
 * Only this reference is stored; never GIPHY API objects, media URLs or media.
 */

export const GIPHY_EMBED_URL_PREFIX = 'https://giphy.com/embed/';
export const GIF_MESSAGE_MAX_LENGTH = 4000; // same bound as POST /api/messages/send

const GIPHY_ID_REGEX = /^[A-Za-z0-9]{1,64}$/;
const GIF_FIRST_LINE_REGEX = /^https:\/\/giphy\.com\/embed\/([A-Za-z0-9]{1,64})$/;

export function isGiphyId(value) {
    return typeof value === 'string' && GIPHY_ID_REGEX.test(value);
}

export function getGiphyEmbedUrl(id) {
    if (!isGiphyId(id)) return null;
    return `${GIPHY_EMBED_URL_PREFIX}${id}`;
}

/**
 * Message content for a GIF with an optional caption, or null for an invalid id.
 * Never truncates; the caller checks GIF_MESSAGE_MAX_LENGTH.
 */
export function buildGifMessageContent(id, caption) {
    const url = getGiphyEmbedUrl(id);
    if (!url) return null;
    const text = typeof caption === 'string' ? caption.trim() : '';
    return text ? `${url}\n${text}` : url;
}

/**
 * @returns {{ id: string, caption: string } | null}
 */
export function parseGifMessageContent(content) {
    if (typeof content !== 'string') return null;
    const newline = content.indexOf('\n');
    const firstLine = newline === -1 ? content : content.slice(0, newline);
    const match = GIF_FIRST_LINE_REGEX.exec(firstLine);
    if (!match) return null;
    const rest = newline === -1 ? '' : content.slice(newline + 1);
    return { id: match[1], caption: rest.trim() ? rest : '' };
}

/**
 * The GIF reference of a message, or null. A message with an attachment object is
 * never a GIF message.
 */
export function getMessageGif(message) {
    const attachment = message?.attachment;
    if (attachment && typeof attachment === 'object') return null;
    return parseGifMessageContent(message?.content);
}
