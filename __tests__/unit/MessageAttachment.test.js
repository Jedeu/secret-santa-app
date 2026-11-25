/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import MessageAttachment, { attachmentDisplayWidth, mediaBubbleWidth } from '@/components/MessageAttachment';

const ATTACHMENT = {
    id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    kind: 'image',
    provider: 'cloudinary',
    cloudName: 'unit-cloud',
    publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    version: 1700000000,
    format: 'png',
    width: 1600,
    height: 1200,
    bytes: 524288,
};

describe('MessageAttachment', () => {
    test('renders a lazy, referrer-free image from the fixed host', () => {
        render(<MessageAttachment attachment={ATTACHMENT} />);

        const img = screen.getByTestId('message-attachment');
        expect(img.tagName).toBe('IMG');
        expect(img).toHaveAttribute(
            'src',
            'https://res.cloudinary.com/unit-cloud/image/upload/v1700000000/ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e.png'
        );
        expect(img).toHaveAttribute('alt', 'Image');
        expect(img).toHaveAttribute('width', '1600');
        expect(img).toHaveAttribute('height', '1200');
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img).toHaveAttribute('decoding', 'async');
        expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
        expect(img.style.maxWidth).toBe('100%');
        expect(img.style.maxHeight).toBe('320px');
        expect(img.style.display).toBe('block');
        expect(screen.queryByTestId('message-attachment-unavailable')).not.toBeInTheDocument();
    });

    test('GIF alt text and a custom max height', () => {
        render(<MessageAttachment attachment={{ ...ATTACHMENT, format: 'gif' }} maxHeight={200} />);

        const img = screen.getByTestId('message-attachment');
        expect(img).toHaveAttribute('alt', 'GIF');
        expect(img.getAttribute('src')).toMatch(/\.gif$/);
        expect(img.style.maxHeight).toBe('200px');
    });

    test.each([
        ['null', null],
        ['a client-supplied URL', { url: 'https://evil.example/x.png' }],
        ['a bad cloud name', { ...ATTACHMENT, cloudName: 'evil.example/x' }],
        ['a bad version', { ...ATTACHMENT, version: -1 }],
    ])('falls back for %s', (_label, attachment) => {
        render(<MessageAttachment attachment={attachment} />);

        expect(screen.queryByTestId('message-attachment')).not.toBeInTheDocument();
        expect(screen.getByTestId('message-attachment-unavailable')).toHaveTextContent('Image unavailable');
    });

    // Bug: on desktop a captioned image's bubble grew to the caption's width and the image
    // was letterboxed inside it. The image now has its real display width and the bubble hugs it.
    test('shows the image at its scaled width, and the bubble hugs it', () => {
        render(<MessageAttachment attachment={ATTACHMENT} />);
        // 1600x1200 fits 320x320 at 320 wide (240 tall).
        expect(screen.getByTestId('message-attachment').style.width).toBe('320px');

        expect(attachmentDisplayWidth({ width: 2560, height: 1600 })).toBe(320);
        expect(attachmentDisplayWidth({ width: 1170, height: 2532 })).toBe(148);
        expect(attachmentDisplayWidth({ width: 200, height: 150 })).toBe(200);

        const longCaption = 'Well well, looks like Christmas came early for you. '.repeat(3);
        // Bubble = image + 24px padding, whatever the caption length.
        expect(mediaBubbleWidth({ attachment: ATTACHMENT, content: longCaption }, null)).toBe(344);
        // A tall image keeps its caption readable: captioned bubbles are at least 220px.
        expect(mediaBubbleWidth({ attachment: { width: 1170, height: 2532 }, content: 'Snow!' }, null)).toBe(220);
        expect(mediaBubbleWidth({ attachment: { width: 1170, height: 2532 }, content: '' }, null)).toBe(172);
        // A GIPHY GIF is 280 wide; text-only messages keep their natural width.
        expect(mediaBubbleWidth({ content: 'x' }, { id: 'abc', caption: longCaption })).toBe(304);
        expect(mediaBubbleWidth({ content: 'Just text' }, null)).toBeNull();
    });

    test('falls back when the image fails to load', () => {
        render(<MessageAttachment attachment={ATTACHMENT} />);

        fireEvent.error(screen.getByTestId('message-attachment'));

        expect(screen.queryByTestId('message-attachment')).not.toBeInTheDocument();
        expect(screen.getByTestId('message-attachment-unavailable')).toHaveTextContent('Image unavailable');
    });
});
