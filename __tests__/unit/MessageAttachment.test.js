/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import MessageAttachment from '@/components/MessageAttachment';

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

    test('falls back when the image fails to load', () => {
        render(<MessageAttachment attachment={ATTACHMENT} />);

        fireEvent.error(screen.getByTestId('message-attachment'));

        expect(screen.queryByTestId('message-attachment')).not.toBeInTheDocument();
        expect(screen.getByTestId('message-attachment-unavailable')).toHaveTextContent('Image unavailable');
    });
});
