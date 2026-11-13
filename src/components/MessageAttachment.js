'use client';
import { useState } from 'react';
import { getAttachmentUrl } from '@/lib/message-media';

/**
 * Renders a message's image from the validated attachment fields on the fixed host.
 * The referrer is suppressed. An invalid attachment or a failed load shows a short
 * fallback instead.
 */
export default function MessageAttachment({ attachment, maxHeight = 320 }) {
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
                maxWidth: '100%',
                height: 'auto',
                maxHeight,
                objectFit: 'contain',
                borderRadius: 8,
                display: 'block',
                aspectRatio: `${attachment.width} / ${attachment.height}`,
            }}
        />
    );
}
