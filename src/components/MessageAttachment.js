'use client';
import { useState } from 'react';
import { getAttachmentUrl } from '@/lib/message-media';
import { GIF_WIDTH } from '@/components/MessageGif';

const MAX_WIDTH = 320;
const MAX_HEIGHT = 320;

/**
 * Width in px the image is shown at: its own width, scaled down to fit MAX_WIDTH and
 * maxHeight. Bubbles use it so they hug the image instead of letterboxing it.
 */
export function attachmentDisplayWidth(attachment, maxHeight = MAX_HEIGHT) {
    const width = Number(attachment?.width);
    const height = Number(attachment?.height);
    if (!(width > 0 && height > 0)) return MAX_WIDTH;
    return Math.round(Math.min(MAX_WIDTH, width, width * (maxHeight / height)));
}

/**
 * Width a bubble should take (its horizontal padding included) so it hugs the message's
 * image or GIF and its caption wraps under it, as on phones; null for a text-only message.
 * A captioned bubble is at least MIN_CAPTION_WIDTH wide so a tall, narrow image does not
 * squeeze its caption into a sliver.
 */
const MIN_CAPTION_WIDTH = 220;

export function mediaBubbleWidth(message, gif, horizontalPadding = 24) {
    let width = null;
    if (message?.attachment && typeof message.attachment === 'object') {
        width = attachmentDisplayWidth(message.attachment) + horizontalPadding;
    } else if (gif) {
        width = GIF_WIDTH + horizontalPadding;
    }
    if (width === null) return null;
    const caption = gif ? gif.caption : message?.content;
    return typeof caption === 'string' && caption.trim() ? Math.max(width, MIN_CAPTION_WIDTH) : width;
}

/**
 * Renders a message's image from the validated attachment fields on the fixed host.
 * The referrer is suppressed. An invalid attachment or a failed load shows a short
 * fallback instead.
 */
export default function MessageAttachment({ attachment, maxHeight = MAX_HEIGHT }) {
    const url = getAttachmentUrl(attachment);
    const [failedUrl, setFailedUrl] = useState(null);

    if (!url || failedUrl === url) {
        return (
            <span
                data-testid="message-attachment-unavailable"
                style={{ display: 'block', fontSize: '12px', fontStyle: 'italic', opacity: 0.8 }}
            >
                Image unavailable
            </span>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            data-testid="message-attachment"
            src={url}
            alt={attachment.format === 'gif' ? 'GIF' : 'Image'}
            width={attachment.width}
            height={attachment.height}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(url)}
            style={{
                width: attachmentDisplayWidth(attachment, maxHeight),
                maxWidth: '100%',
                height: 'auto',
                maxHeight,
                objectFit: 'contain',
                borderRadius: 8,
                display: 'block',
                marginInline: 'auto',
                aspectRatio: `${attachment.width} / ${attachment.height}`,
            }}
        />
    );
}
