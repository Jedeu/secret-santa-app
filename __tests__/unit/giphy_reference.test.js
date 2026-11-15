import {
    GIPHY_EMBED_URL_PREFIX,
    GIF_MESSAGE_MAX_LENGTH,
    buildGifMessageContent,
    getGiphyEmbedUrl,
    getMessageGif,
    isGiphyId,
    parseGifMessageContent,
} from '@/lib/giphy-reference';

// Synthetic GIF ids only.

const ID = 'SyntheticGif01';
const REF = 'https://giphy.com/embed/SyntheticGif01';

const ATTACHMENT = {
    id: '3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    kind: 'image',
    provider: 'cloudinary',
    cloudName: 'unit-cloud',
    publicId: 'ss-2026-3f2b8c1d-5e6a-4b7c-9d8e-1f2a3b4c5d6e',
    version: 1700000000,
    format: 'gif',
    width: 64,
    height: 64,
    bytes: 2048,
};

describe('giphy-reference constants', () => {
    test('prefix and the send-route length bound', () => {
        expect(GIPHY_EMBED_URL_PREFIX).toBe('https://giphy.com/embed/');
        expect(GIF_MESSAGE_MAX_LENGTH).toBe(4000);
    });
});

describe('isGiphyId and getGiphyEmbedUrl', () => {
    test.each(['a', 'Z', '0', 'abcDEF123', 'x'.repeat(64)])('accepts %s', (value) => {
        expect(isGiphyId(value)).toBe(true);
        expect(getGiphyEmbedUrl(value)).toBe(`${GIPHY_EMBED_URL_PREFIX}${value}`);
    });

    test.each([
        ['empty', ''],
        ['65 chars', 'x'.repeat(65)],
        ['space', 'ab c'],
        ['hyphen', 'ab-c'],
        ['underscore', 'ab_c'],
        ['slash', 'ab/c'],
        ['carriage return', 'abc\r'],
        ['newline', 'abc\n'],
        ['unicode', 'abcé'],
        ['null', null],
        ['undefined', undefined],
        ['number', 123],
        ['object', { id: 'abc' }],
    ])('rejects %s', (_label, value) => {
        expect(isGiphyId(value)).toBe(false);
        expect(getGiphyEmbedUrl(value)).toBeNull();
    });
});

describe('buildGifMessageContent', () => {
    test('GIF only is the bare reference', () => {
        expect(buildGifMessageContent(ID)).toBe(REF);
        expect(buildGifMessageContent(ID, '')).toBe(REF);
        expect(buildGifMessageContent(ID, '   \n  ')).toBe(REF);
        expect(buildGifMessageContent(ID, 42)).toBe(REF);
        expect(buildGifMessageContent(ID, null)).toBe(REF);
    });

    test('a caption is trimmed and follows one newline', () => {
        expect(buildGifMessageContent(ID, '  Happy holidays!  ')).toBe(`${REF}\nHappy holidays!`);
    });

    test('caption newlines are preserved', () => {
        expect(buildGifMessageContent(ID, 'Line one\nLine two')).toBe(`${REF}\nLine one\nLine two`);
    });

    test('an invalid id returns null', () => {
        expect(buildGifMessageContent('bad-id', 'caption')).toBeNull();
        expect(buildGifMessageContent('', 'caption')).toBeNull();
        expect(buildGifMessageContent(null)).toBeNull();
    });

    test('never truncates', () => {
        const caption = 'c'.repeat(GIF_MESSAGE_MAX_LENGTH + 100);
        const content = buildGifMessageContent(ID, caption);
        expect(content).toBe(`${REF}\n${caption}`);
        expect(content.length).toBeGreaterThan(GIF_MESSAGE_MAX_LENGTH);
    });
});

describe('parseGifMessageContent', () => {
    test('round-trips with and without a caption', () => {
        expect(parseGifMessageContent(buildGifMessageContent(ID))).toEqual({ id: ID, caption: '' });
        expect(parseGifMessageContent(buildGifMessageContent(ID, 'Nice one'))).toEqual({ id: ID, caption: 'Nice one' });
    });

    test('caption newlines are preserved', () => {
        expect(parseGifMessageContent(`${REF}\nLine one\nLine two`)).toEqual({ id: ID, caption: 'Line one\nLine two' });
    });

    test('the caption is the remainder; whitespace-only becomes empty', () => {
        expect(parseGifMessageContent(`${REF}\n  spaced  `)).toEqual({ id: ID, caption: '  spaced  ' });
        expect(parseGifMessageContent(`${REF}\n   `)).toEqual({ id: ID, caption: '' });
        expect(parseGifMessageContent(`${REF}\n`)).toEqual({ id: ID, caption: '' });
    });

    test('accepts the 64-character id', () => {
        const long = 'A'.repeat(64);
        expect(parseGifMessageContent(`${GIPHY_EMBED_URL_PREFIX}${long}`)).toEqual({ id: long, caption: '' });
    });

    test.each([
        ['leading space', ` ${REF}`],
        ['trailing space', `${REF} `],
        ['trailing text on the first line', `${REF} caption`],
        ['carriage return', `${REF}\r\ncaption`],
        ['bare carriage return', `${REF}\r`],
        ['slug path', 'https://giphy.com/gifs/funny-cat-SyntheticGif01'],
        ['slug id', 'https://giphy.com/embed/funny-cat-SyntheticGif01'],
        ['http', 'http://giphy.com/embed/SyntheticGif01'],
        ['other host', 'https://media.giphy.com/embed/SyntheticGif01'],
        ['lookalike host', 'https://giphy.com.evil.example/embed/SyntheticGif01'],
        ['www host', 'https://www.giphy.com/embed/SyntheticGif01'],
        ['query string', `${REF}?autoplay=1`],
        ['trailing slash', `${REF}/`],
        ['65-character id', `${GIPHY_EMBED_URL_PREFIX}${'A'.repeat(65)}`],
        ['empty id', GIPHY_EMBED_URL_PREFIX],
        ['text before', `See ${REF}`],
        ['caption first', `caption\n${REF}`],
        ['markdown link', `[gif](${REF})`],
    ])('rejects %s', (_label, value) => {
        expect(parseGifMessageContent(value)).toBeNull();
    });

    test.each([[null], [undefined], [42], [{}], [[REF]]])('non-string %p is null', (value) => {
        expect(parseGifMessageContent(value)).toBeNull();
    });
});

describe('getMessageGif', () => {
    test('a text message whose first line is the reference', () => {
        expect(getMessageGif({ content: `${REF}\nCaption` })).toEqual({ id: ID, caption: 'Caption' });
        expect(getMessageGif({ content: REF, attachment: null })).toEqual({ id: ID, caption: '' });
    });

    test('an attachment object means it is not a GIF message', () => {
        expect(getMessageGif({ content: REF, attachment: ATTACHMENT })).toBeNull();
        expect(getMessageGif({ content: REF, attachment: {} })).toBeNull();
    });

    test('anything else is null', () => {
        expect(getMessageGif(null)).toBeNull();
        expect(getMessageGif(undefined)).toBeNull();
        expect(getMessageGif({})).toBeNull();
        expect(getMessageGif({ content: 'Hello' })).toBeNull();
        expect(getMessageGif({ content: 'https://giphy.com/embed/bad-id' })).toBeNull();
    });
});
