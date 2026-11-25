'use client';
import { getGiphyEmbedUrl } from '@/lib/giphy-reference';

/**
 * Renders a GIF reference as a sandboxed GIPHY embed. The embed URL is rebuilt from
 * the validated id; no key or API call is needed. The referrer is suppressed.
 */
export const GIF_WIDTH = 280;

export default function MessageGif({ id, width = GIF_WIDTH }) {
    const embedUrl = getGiphyEmbedUrl(id);

    if (!embedUrl) {
        return <span data-testid="message-gif-unavailable">GIF unavailable</span>;
    }

    return (
        <span data-testid="message-gif" style={{ display: 'block', width, maxWidth: '100%' }}>
            <span
                style={{
                    display: 'block',
                    aspectRatio: '4 / 3',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: '#000',
                }}
            >
                <iframe
                    src={embedUrl}
                    title="GIF from GIPHY"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin"
                    style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
                />
            </span>
            <a
                href={embedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ fontSize: '10px', textDecoration: 'underline', color: 'inherit' }}
            >
                via GIPHY
            </a>
        </span>
    );
}
