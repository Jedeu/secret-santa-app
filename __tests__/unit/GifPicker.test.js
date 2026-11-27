/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GifPicker from '@/components/GifPicker';
import { GiphyClientError } from '@/lib/giphy-client';
import { onEasterEgg } from '@/lib/easter-eggs';

/**
 * GifPicker with a mocked page fetch. Every call returns its own deferred so a test can
 * resolve, reject or hold it (a held call models a provider that ignores AbortSignal).
 * Synthetic GIF data only.
 */

const mockFetchGiphyPage = jest.fn();

jest.mock('@/lib/giphy-client', () => {
    const actual = jest.requireActual('@/lib/giphy-client');
    return {
        ...actual,
        fetchGiphyPage: (...args) => mockFetchGiphyPage(...args),
    };
});

const MEDIA = 'https://media.giphy.com/media';
const LOADING = 'Loading GIFs…';
const HINT = 'Type at least 2 characters to search.';
const GENERIC_ERROR = "Couldn't load GIFs. Try again.";
const UNSENDABLE = "That GIF can't be sent from this app.";

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function item(id, overrides = {}) {
    const key = id || 'NoId';
    const tileUrls = [`${MEDIA}/${key}/200w.webp`, `${MEDIA}/${key}/200w.gif`];
    return {
        id,
        title: `Title ${key}`,
        tileUrls,
        previewUrls: [`${MEDIA}/${key}/giphy.webp`, ...tileUrls],
        ...overrides,
    };
}

function page(ids, { nextOffset = ids.length, hasMore = false } = {}) {
    return { items: ids.map((id) => item(id)), nextOffset, hasMore };
}

function ids(prefix, count) {
    return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

let calls;

async function settle(fn = () => { }) {
    await act(async () => {
        await fn();
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
    });
}

async function resolveCall(index, value) {
    await settle(() => { calls[index].resolve(value); });
}

async function rejectCall(index, error) {
    await settle(() => { calls[index].reject(error); });
}

function renderPicker(props = {}) {
    const onSelect = props.onSelect || jest.fn();
    const onClose = props.onClose || jest.fn();
    const utils = render(<GifPicker onSelect={onSelect} onClose={onClose} {...props} />);
    return { ...utils, onSelect, onClose };
}

function searchInput() {
    return screen.getByRole('searchbox', { name: 'Search GIPHY' });
}

function type(value) {
    fireEvent.change(searchInput(), { target: { value } });
}

function advance(ms) {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

function status() {
    return screen.getByTestId('gif-picker-status');
}

function tiles() {
    return screen.queryAllByTestId('gif-picker-item');
}

function tileLabels() {
    return tiles().map((tile) => tile.getAttribute('aria-label'));
}

describe('GifPicker', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        calls = [];
        mockFetchGiphyPage.mockReset();
        mockFetchGiphyPage.mockImplementation((params) => {
            const d = deferred();
            calls.push({ params, ...d });
            return d.promise;
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('trending', () => {
        test('one trending call on mount; unmount before it resolves leaves it aborted', async () => {
            const { unmount } = renderPicker();

            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);
            expect(calls[0].params).toMatchObject({ query: '', offset: 0 });
            expect(calls[0].params.signal.aborted).toBe(false);
            expect(status()).toHaveTextContent(LOADING);
            expect(screen.getByTestId('gif-picker-results')).toHaveAttribute('aria-busy', 'true');
            expect(document.activeElement).toBe(screen.getByTestId('gif-picker'));

            unmount();
            expect(calls[0].params.signal.aborted).toBe(true);

            await resolveCall(0, page(['Late']));
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);
        });

        test('results render in API order; an empty page says so', async () => {
            renderPicker();
            await resolveCall(0, page(['T0', 'T1', 'T2']));

            expect(tileLabels()).toEqual(['GIF: Title T0', 'GIF: Title T1', 'GIF: Title T2']);
            expect(screen.getByTestId('gif-picker-results')).toHaveAttribute('aria-busy', 'false');
            expect(status()).toHaveTextContent('');
            const images = tiles().map((tile) => tile.querySelector('img'));
            expect(images[0]).toHaveAttribute('src', `${MEDIA}/T0/200w.webp`);
            expect(images[0]).toHaveAttribute('alt', '');
            expect(images[0]).toHaveAttribute('loading', 'lazy');
            expect(images[0]).toHaveAttribute('decoding', 'async');
            expect(images[0]).toHaveAttribute('referrerpolicy', 'no-referrer');
        });

        test('an empty trending page shows "No GIFs to show."', async () => {
            renderPicker();
            await resolveCall(0, page([]));
            expect(status()).toHaveTextContent('No GIFs to show.');
            expect(tiles()).toHaveLength(0);
        });

        test('a tile without a title is labelled GIF', async () => {
            renderPicker();
            await resolveCall(0, { items: [item('A', { title: '' })], nextOffset: 1, hasMore: false });
            expect(tileLabels()).toEqual(['GIF']);
        });
    });

    describe('search', () => {
        test('the debounce produces one search', async () => {
            renderPicker();
            await resolveCall(0, page(['T0']));

            type('c');
            type('ca');
            type('cat');
            advance(599);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);
            expect(status()).toHaveTextContent(LOADING);

            advance(1);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
            expect(calls[1].params).toMatchObject({ query: 'cat', offset: 0 });

            await resolveCall(1, page(['Cat0', 'Cat1']));
            expect(tileLabels()).toEqual(['GIF: Title Cat0', 'GIF: Title Cat1']);
        });

        test('searching "grinch" sends the Grinch once per opened picker', async () => {
            const seen = [];
            const off = onEasterEgg((effect) => seen.push(effect));
            renderPicker();
            type('grin');
            advance(600);
            expect(seen).toEqual([]);
            type('The Grinch');
            advance(600);
            expect(seen).toEqual(['grinch']);
            type('grinch dance');
            advance(600);
            expect(seen).toEqual(['grinch']);
            off();
        });

        test('the trimmed query is searched; a whitespace-only edit does nothing', async () => {
            renderPicker();
            type('  snow ');
            advance(600);
            expect(calls[1].params).toMatchObject({ query: 'snow', offset: 0 });

            type('  snow  ');
            advance(600);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
            expect(calls[1].params.signal.aborted).toBe(false);
        });

        test('Enter then the debounce is one call', async () => {
            renderPicker();
            type('cat');
            fireEvent.keyDown(searchInput(), { key: 'Enter' });
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
            advance(600);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
        });

        test('Enter twice is one call', async () => {
            renderPicker();
            type('cat');
            fireEvent.keyDown(searchInput(), { key: 'Enter' });
            fireEvent.keyDown(searchInput(), { key: 'Enter' });
            advance(1000);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
            expect(calls[1].params.query).toBe('cat');
        });

        test('Enter with a one-character query makes no call', async () => {
            renderPicker();
            type('c');
            fireEvent.keyDown(searchInput(), { key: 'Enter' });
            advance(1000);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);
        });

        test('an edit aborts the previous search signal immediately', async () => {
            renderPicker();
            type('cat');
            advance(600);
            const first = calls[1].params.signal;
            expect(first.aborted).toBe(false);

            type('cats');
            expect(first.aborted).toBe(true);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);

            advance(600);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(3);
            expect(calls[2].params.query).toBe('cats');
        });

        test('a late response that ignored abort never changes the view after clearing', async () => {
            renderPicker();
            await resolveCall(0, page(['T0']));
            type('cat');
            advance(600);

            type('');
            expect(tileLabels()).toEqual(['GIF: Title T0']);
            await resolveCall(1, page(['CatLate']));

            expect(tileLabels()).toEqual(['GIF: Title T0']);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
        });

        test('a late response that ignored abort never changes the view after an edit', async () => {
            renderPicker();
            await resolveCall(0, page(['T0']));
            type('cat');
            advance(600);
            type('dog');
            advance(600);
            expect(calls[2].params.query).toBe('dog');

            await resolveCall(1, page(['CatLate']));
            expect(tiles()).toHaveLength(0);
            expect(status()).toHaveTextContent(LOADING);

            await resolveCall(2, page(['Dog0']));
            expect(tileLabels()).toEqual(['GIF: Title Dog0']);

            type('cat');
            expect(tiles()).toHaveLength(0);
            expect(status()).toHaveTextContent(LOADING);
        });

        test('a late error for an old search is ignored', async () => {
            renderPicker();
            type('cat');
            advance(600);
            type('dog');
            advance(600);
            await rejectCall(1, new GiphyClientError('NETWORK'));
            expect(status()).toHaveTextContent(LOADING);
            expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        });

        test('clearing shows trending with no new call', async () => {
            renderPicker();
            await resolveCall(0, page(['T0', 'T1']));
            type('cat');
            advance(600);
            await resolveCall(1, page(['Cat0']));
            expect(tileLabels()).toEqual(['GIF: Title Cat0']);

            type('');
            expect(tileLabels()).toEqual(['GIF: Title T0', 'GIF: Title T1']);
            advance(1000);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
        });

        test('a one-character query shows the hint, an empty grid and makes no call', async () => {
            renderPicker();
            await resolveCall(0, page(['T0']));
            type('c');

            expect(status()).toHaveTextContent(HINT);
            expect(tiles()).toHaveLength(0);
            advance(1000);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);
        });

        test('results for "ab" disappear as soon as the input becomes "abc"', async () => {
            renderPicker();
            type('ab');
            advance(600);
            await resolveCall(1, page(['Ab0']));
            expect(tileLabels()).toEqual(['GIF: Title Ab0']);

            type('abc');
            expect(tiles()).toHaveLength(0);
            expect(status()).toHaveTextContent(LOADING);
        });

        test('returning to an earlier query requests again', async () => {
            renderPicker();
            type('cat');
            advance(600);
            await resolveCall(1, page(['Cat0']));
            type('dog');
            advance(600);
            type('cat');
            advance(600);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(4);
            expect(calls[3].params).toMatchObject({ query: 'cat', offset: 0 });
            expect(tiles()).toHaveLength(0);
        });

        test('an empty search says "No GIFs found."', async () => {
            renderPicker();
            type('zzzz');
            advance(600);
            await resolveCall(1, page([]));
            expect(status()).toHaveTextContent('No GIFs found.');
        });
    });

    describe('paging and retry', () => {
        test('load-more failure keeps items and offset; Try again requests that offset with append', async () => {
            renderPicker();
            await resolveCall(0, page(ids('T', 24), { nextOffset: 24, hasMore: true }));
            expect(tiles()).toHaveLength(24);

            fireEvent.click(screen.getByRole('button', { name: 'Load more GIFs' }));
            expect(calls[1].params).toMatchObject({ query: '', offset: 24 });
            expect(status()).toHaveTextContent(LOADING);
            expect(tiles()).toHaveLength(24);

            await rejectCall(1, new GiphyClientError('NETWORK'));
            expect(status()).toHaveTextContent(GENERIC_ERROR);
            expect(tiles()).toHaveLength(24);

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(3);
            expect(calls[2].params).toMatchObject({ query: '', offset: 24 });

            await resolveCall(2, page(ids('U', 24), { nextOffset: 48, hasMore: false }));
            expect(tiles()).toHaveLength(48);
            expect(tileLabels()[0]).toBe('GIF: Title T0');
            expect(tileLabels()[24]).toBe('GIF: Title U0');
            expect(screen.queryByRole('button', { name: 'Load more GIFs' })).not.toBeInTheDocument();
        });

        test('an initial failure retries at offset 0', async () => {
            renderPicker();
            await rejectCall(0, new GiphyClientError('RATE_LIMITED'));
            expect(status()).toHaveTextContent('GIF search is busy right now. Try again in a minute.');

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
            expect(calls[1].params).toMatchObject({ query: '', offset: 0 });
            await resolveCall(1, page(['T0']));
            expect(tileLabels()).toEqual(['GIF: Title T0']);
        });

        test('a failed search retries the same query at offset 0', async () => {
            renderPicker();
            type('cat');
            advance(600);
            await rejectCall(1, new GiphyClientError('UPDATE_REQUIRED'));
            expect(status()).toHaveTextContent('GIF search is still updating. Try again in a moment, or reload the app.');

            fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
            expect(calls[2].params).toMatchObject({ query: 'cat', offset: 0 });
            fireEvent.keyDown(searchInput(), { key: 'Enter' });
            advance(1000);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(3);
        });

        test('search load more appends to the search slice', async () => {
            renderPicker();
            type('cat');
            advance(600);
            await resolveCall(1, page(ids('C', 24), { nextOffset: 24, hasMore: true }));
            fireEvent.click(screen.getByRole('button', { name: 'Load more GIFs' }));
            expect(calls[2].params).toMatchObject({ query: 'cat', offset: 24 });
            await resolveCall(2, page(['D0'], { nextOffset: 25, hasMore: false }));
            expect(tiles()).toHaveLength(25);
        });

        test('no overlapping load-more', async () => {
            renderPicker();
            await resolveCall(0, page(ids('T', 24), { nextOffset: 24, hasMore: true }));
            const loadMore = screen.getByRole('button', { name: 'Load more GIFs' });

            fireEvent.click(loadMore);
            fireEvent.click(loadMore);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(2);
            expect(screen.queryByRole('button', { name: 'Load more GIFs' })).not.toBeInTheDocument();
        });
    });

    describe('canRequest', () => {
        test('false: no request and onClose', () => {
            const onClose = jest.fn();
            renderPicker({ onClose, canRequest: () => false });
            expect(mockFetchGiphyPage).not.toHaveBeenCalled();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        test('turning false before the response: nothing is applied and onClose is called', async () => {
            let allowed = true;
            const onClose = jest.fn();
            renderPicker({ onClose, canRequest: () => allowed });
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);

            allowed = false;
            await resolveCall(0, page(['T0']));

            expect(tiles()).toHaveLength(0);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        test('false before a search: no search request', async () => {
            let allowed = true;
            const onClose = jest.fn();
            renderPicker({ onClose, canRequest: () => allowed });
            allowed = false;
            type('cat');
            advance(600);
            expect(mockFetchGiphyPage).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('tiles and selection', () => {
        test('a tile whose WebP errors selects with previewUrls lacking that URL', async () => {
            const { onSelect } = renderPicker();
            await resolveCall(0, page(['A']));
            const img = tiles()[0].querySelector('img');
            expect(img).toHaveAttribute('src', `${MEDIA}/A/200w.webp`);

            fireEvent.error(img);
            expect(tiles()[0].querySelector('img')).toHaveAttribute('src', `${MEDIA}/A/200w.gif`);

            fireEvent.click(tiles()[0]);
            expect(onSelect).toHaveBeenCalledTimes(1);
            expect(onSelect).toHaveBeenCalledWith({
                id: 'A',
                title: 'Title A',
                previewUrls: [`${MEDIA}/A/giphy.webp`, `${MEDIA}/A/200w.gif`],
            });
        });

        test('selection without an error passes every preview URL in order', async () => {
            const { onSelect } = renderPicker();
            await resolveCall(0, page(['A']));
            fireEvent.click(tiles()[0]);
            expect(onSelect).toHaveBeenCalledWith({
                id: 'A',
                title: 'Title A',
                previewUrls: [`${MEDIA}/A/giphy.webp`, `${MEDIA}/A/200w.webp`, `${MEDIA}/A/200w.gif`],
            });
        });

        test('a tile with every URL failed becomes Unavailable and disabled in place', async () => {
            const { onSelect } = renderPicker();
            await resolveCall(0, page(['A', 'B']));
            fireEvent.error(tiles()[0].querySelector('img'));
            fireEvent.error(tiles()[0].querySelector('img'));

            expect(tiles()).toHaveLength(2);
            expect(tiles()[0]).toBeDisabled();
            expect(tiles()[0]).toHaveTextContent('Unavailable');
            expect(tiles()[1]).not.toBeDisabled();
            fireEvent.click(tiles()[0]);
            expect(onSelect).not.toHaveBeenCalled();
        });

        test('a null-id item shows the notice and does not select; a no-media item is disabled in place', async () => {
            const { onSelect } = renderPicker();
            await resolveCall(0, {
                items: [item(null), item('NoMedia', { tileUrls: [], previewUrls: [] }), item('C')],
                nextOffset: 3,
                hasMore: false,
            });

            fireEvent.click(tiles()[0]);
            expect(onSelect).not.toHaveBeenCalled();
            expect(status()).toHaveTextContent(UNSENDABLE);

            expect(tiles()).toHaveLength(3);
            expect(tiles()[1]).toBeDisabled();
            expect(tiles()[1]).toHaveTextContent('Unavailable');
            expect(tiles()[1].querySelector('img')).toBeNull();
            expect(tileLabels()[2]).toBe('GIF: Title C');

            type('x');
            expect(status()).toHaveTextContent(HINT);
        });
    });

    describe('markup', () => {
        test('search input, attribution, Escape and Close', async () => {
            const { onClose } = renderPicker();
            const input = searchInput();
            expect(input).toHaveAttribute('type', 'search');
            expect(input).toHaveAttribute('placeholder', 'Search GIPHY');
            expect(input).toHaveAttribute('maxLength', '50');
            expect(input).toHaveAttribute('enterKeyHint', 'search');

            const region = screen.getByRole('region', { name: 'GIF picker' });
            expect(region).toHaveAttribute('tabIndex', '-1');

            const mark = screen.getByTestId('gif-picker-attribution');
            expect(mark).toHaveAttribute('src', '/giphy/PoweredBy_200px-Black_HorizLogo.png');
            expect(mark).toHaveAttribute('alt', 'Powered by GIPHY');
            expect(mark).toHaveAttribute('width', '200');
            expect(mark).toHaveAttribute('height', '26');
            expect(screen.getByTestId('gif-picker-results')).not.toContainElement(mark);

            expect(status()).toHaveAttribute('role', 'status');
            expect(status()).toHaveAttribute('aria-live', 'polite');

            fireEvent.keyDown(input, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);

            fireEvent.click(screen.getByRole('button', { name: 'Close GIF picker' }));
            expect(onClose).toHaveBeenCalledTimes(2);

            screen.getAllByRole('button').forEach((button) => {
                expect(button).toHaveAttribute('type', 'button');
            });
        });

        test('control names contain no send, santa or recipient', async () => {
            renderPicker();
            await rejectCall(0, new GiphyClientError('NETWORK'));
            ['Close GIF picker', 'Try again'].forEach((name) => {
                expect(name).not.toMatch(/send|santa|recipient/i);
                expect(screen.getByRole('button', { name })).toBeInTheDocument();
            });
            expect('Search GIPHY').not.toMatch(/send|santa|recipient/i);
            expect('Load more GIFs').not.toMatch(/send|santa|recipient/i);
        });
    });
});
