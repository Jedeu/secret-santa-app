/** @jest-environment jsdom */
import { render, screen, fireEvent, within } from '@testing-library/react';
import PublicFeed from '@/components/PublicFeed';

// Synthetic users and messages only.

const USERS = [
    { id: 'ann', name: 'Ann', recipientId: 'ben', gifterId: 'cat' },
    { id: 'ben', name: 'Ben', recipientId: 'cat', gifterId: 'ann' },
    { id: 'cat', name: 'Cat', recipientId: 'ann', gifterId: 'ben' },
];

function attachment(format, id) {
    return {
        id,
        kind: 'image',
        provider: 'cloudinary',
        cloudName: 'unit-cloud',
        publicId: `ss-2026-${id}`,
        version: 1700000000,
        format,
        width: 640,
        height: 480,
        bytes: 4321,
    };
}

const PHOTO = attachment('png', '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e');
const GIF = attachment('gif', '7e1c3a5b-2d4f-4a6c-8b9e-0f1d2c3b4a5e');

const ANN_TO_BEN = 'santa_ann_recipient_ben';
const BEN_TO_CAT = 'santa_ben_recipient_cat';
const CAT_TO_ANN = 'santa_cat_recipient_ann';

const MESSAGES = [
    // Ben's exchange: text first, then a captioned photo (latest).
    { id: 'm1', fromId: 'ann', toId: 'ben', content: 'Hello Ben', timestamp: '2026-12-01T10:00:00.000Z', conversationId: ANN_TO_BEN },
    { id: 'm2', fromId: 'ann', toId: 'ben', content: 'Look at this', attachment: PHOTO, timestamp: '2026-12-01T11:00:00.000Z', conversationId: ANN_TO_BEN },
    // Cat's exchange: a media-only GIF.
    { id: 'm3', fromId: 'ben', toId: 'cat', content: '', attachment: GIF, timestamp: '2026-12-01T12:00:00.000Z', conversationId: BEN_TO_CAT },
    // Ann's exchange: text only.
    { id: 'm4', fromId: 'cat', toId: 'ann', content: 'Plain text only', timestamp: '2026-12-01T09:00:00.000Z', conversationId: CAT_TO_ANN },
];

function threadRow(name) {
    return screen.getByText(name).parentElement;
}

describe('PublicFeed media', () => {
    test('thread previews: captioned photo, media-only GIF and unchanged text', () => {
        render(<PublicFeed messages={MESSAGES} allUsers={USERS} />);

        expect(within(threadRow("🎁 Ben's Gift Exchange")).getByText('📷 Look at this')).toBeInTheDocument();
        expect(within(threadRow("🎁 Cat's Gift Exchange")).getByText('📷 GIF')).toBeInTheDocument();
        expect(within(threadRow("🎁 Ann's Gift Exchange")).getByText('Plain text only')).toBeInTheDocument();
    });

    test('a media-only photo preview says Photo', () => {
        const messages = [{ ...MESSAGES[2], attachment: PHOTO }];
        render(<PublicFeed messages={messages} allUsers={USERS} />);

        expect(screen.getByText('📷 Photo')).toBeInTheDocument();
    });

    test('an image with a caption renders the image above the text', () => {
        render(<PublicFeed messages={MESSAGES} allUsers={USERS} />);
        fireEvent.click(screen.getByText("🎁 Ben's Gift Exchange"));

        const img = screen.getByTestId('message-attachment');
        expect(img).toHaveAttribute('src', expect.stringContaining('/v1700000000/ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e.png'));
        const caption = screen.getByText('Look at this');
        expect(caption).toContainElement(img);
        expect(img.compareDocumentPosition(caption.lastChild) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Hello Ben')).toBeInTheDocument();
    });

    test('a media-only message renders the image and no text', () => {
        render(<PublicFeed messages={MESSAGES} allUsers={USERS} />);
        fireEvent.click(screen.getByText("🎁 Cat's Gift Exchange"));

        const img = screen.getByTestId('message-attachment');
        expect(img).toHaveAttribute('alt', 'GIF');
        const bubble = img.parentElement;
        expect(bubble.textContent).toBe('');
    });

    test('a text-only thread renders no image', () => {
        render(<PublicFeed messages={MESSAGES} allUsers={USERS} />);
        fireEvent.click(screen.getByText("🎁 Ann's Gift Exchange"));

        expect(screen.getByText('Plain text only')).toBeInTheDocument();
        expect(screen.queryByTestId('message-attachment')).not.toBeInTheDocument();
    });
});
