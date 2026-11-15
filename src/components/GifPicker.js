'use client';
import { useEffect, useRef, useState } from 'react';
import { fetchGiphyPage, describeGiphyError, GIPHY_QUERY_MAX_LENGTH } from '@/lib/giphy-client';

/**
 * GIF browse/search panel with GIPHY attribution.
 *
 * Results live only in this component's state while it is open; nothing is cached,
 * stored or reordered. The view is derived from the current input, never from past
 * results: a search slice is shown only while its query equals the trimmed input.
 * Every request is fenced by a per-mode sequence number, so a late response from a
 * provider that ignores AbortSignal is dropped.
 */

const SEARCH_DEBOUNCE_MS = 600;
const SEARCH_MIN_LENGTH = 2;
const ATTRIBUTION_SRC = '/giphy/PoweredBy_200px-Black_HorizLogo.png';

const LOADING_TEXT = 'Loading GIFs…';
const EMPTY_SEARCH_TEXT = 'No GIFs found.';
const EMPTY_TRENDING_TEXT = 'No GIFs to show.';
const HINT_TEXT = 'Type at least 2 characters to search.';
const UNSENDABLE_TEXT = "That GIF can't be sent from this app.";

function createSlice(query, status) {
    return { query, items: [], nextOffset: 0, hasMore: false, status, errorCode: null };
}

/**
 * Starts one page request for `mode`. Returns undefined and never sets state
 * synchronously; results are applied only while mounted and still the latest request.
 *
 * @param {{ requestsRef: object, mountedRef: object, propsRef: object, setTrending: Function, setSearch: Function }} context
 * @param {'trending'|'search'} mode
 * @param {{ query: string, offset: number, append: boolean }} params
 */
function requestPage(context, mode, params) {
    const req = context.requestsRef.current[mode];
    if (!context.propsRef.current.canRequest()) {
        context.propsRef.current.onClose?.();
        return;
    }

    req.controller?.abort();
    const seq = (req.seq += 1);
    const controller = new AbortController();
    req.controller = controller;

    const apply = (updater) => {
        if (mode === 'trending') {
            context.setTrending(updater);
        } else {
            context.setSearch((prev) => (prev && prev.query === params.query ? updater(prev) : prev));
        }
    };

    const onPage = (page) => {
        if (!(context.mountedRef.current && req.seq === seq)) return;
        req.controller = null;
        if (!context.propsRef.current.canRequest()) {
            context.propsRef.current.onClose?.();
            return;
        }
        const items = Array.isArray(page?.items) ? page.items : [];
        apply((prev) => ({
            ...prev,
            items: params.append ? [...prev.items, ...items] : items,
            nextOffset: page?.nextOffset,
            hasMore: page?.hasMore === true,
            status: 'ready',
            errorCode: null,
        }));
    };

    const onError = (error) => {
        if (!(context.mountedRef.current && req.seq === seq)) return;
        req.controller = null;
        const code = typeof error?.code === 'string' ? error.code : 'UNAVAILABLE';
        if (code === 'ABORTED') return;
        apply((prev) => ({ ...prev, status: 'error', errorCode: code }));
    };

    let pending;
    try {
        pending = Promise.resolve(fetchGiphyPage({ query: params.query, offset: params.offset, signal: controller.signal }));
    } catch (error) {
        pending = Promise.reject(error);
    }
    pending.then(onPage, onError);
}

function GifTile({ item, onPick }) {
    const [tileIndex, setTileIndex] = useState(0);
    const urls = item.tileUrls;
    const src = tileIndex < urls.length ? urls[tileIndex] : null;
    const label = item.title ? `GIF: ${item.title}` : 'GIF';

    const handleError = (event) => {
        const failed = event.currentTarget.getAttribute('src');
        setTileIndex((prev) => (urls[prev] === failed ? prev + 1 : prev));
    };

    return (
        <button
            type="button"
            data-testid="gif-picker-item"
            aria-label={label}
            disabled={!src}
            onClick={() => onPick(item, tileIndex)}
            style={{
                aspectRatio: '1 / 1',
                width: '100%',
                background: 'var(--surface-highlight)',
                border: 'none',
                borderRadius: '6px',
                padding: 0,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: '11px',
                cursor: src ? 'pointer' : 'default',
            }}
        >
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={handleError}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
            ) : (
                <span>Unavailable</span>
            )}
        </button>
    );
}

export default function GifPicker({ onSelect, onClose, canRequest = () => true }) {
    const [query, setQuery] = useState('');
    const [trending, setTrending] = useState(() => createSlice('', 'loading'));
    const [search, setSearch] = useState(null);
    const [notice, setNotice] = useState('');

    const mountedRef = useRef(false);
    const rootRef = useRef(null);
    const debounceRef = useRef(null);
    const propsRef = useRef({ canRequest, onSelect, onClose });
    const requestsRef = useRef({
        trending: { seq: 0, controller: null },
        search: { seq: 0, controller: null, query: '', started: false },
    });

    useEffect(() => {
        propsRef.current = { canRequest, onSelect, onClose };
    });

    useEffect(() => {
        const requests = requestsRef.current;
        mountedRef.current = true;
        rootRef.current?.focus();
        requestPage({ requestsRef, mountedRef, propsRef, setTrending, setSearch }, 'trending', { query: '', offset: 0, append: false });
        return () => {
            mountedRef.current = false;
            if (debounceRef.current !== null) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
            requests.trending.seq += 1;
            requests.search.seq += 1;
            requests.trending.controller?.abort();
            requests.search.controller?.abort();
            requests.trending.controller = null;
            requests.search.controller = null;
        };
    }, []);

    const clearDebounce = () => {
        if (debounceRef.current !== null) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
    };

    const startSearch = (q) => {
        const req = requestsRef.current.search;
        if (!mountedRef.current || req.query !== q || req.started || q.length < SEARCH_MIN_LENGTH) return;
        req.started = true;
        clearDebounce();
        setSearch((prev) => (prev && prev.query === q ? { ...prev, status: 'loading' } : prev));
        requestPage({ requestsRef, mountedRef, propsRef, setTrending, setSearch }, 'search', { query: q, offset: 0, append: false });
    };

    const handleQueryChange = (event) => {
        const value = event.target.value;
        setQuery(value);
        setNotice('');
        const next = value.trim();
        const req = requestsRef.current.search;
        if (next === req.query) return;

        // Invalidate the previous search immediately.
        req.seq += 1;
        req.controller?.abort();
        req.controller = null;
        req.query = next;
        req.started = false;
        clearDebounce();

        if (next.length < SEARCH_MIN_LENGTH) {
            setSearch(null);
            return;
        }
        setSearch(createSlice(next, 'waiting'));
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            startSearch(next);
        }, SEARCH_DEBOUNCE_MS);
    };

    const handleInputKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            startSearch(query.trim());
        }
    };

    const handleRootKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose?.();
        }
    };

    const handlePick = (item, tileIndex) => {
        if (item.id === null) {
            setNotice(UNSENDABLE_TEXT);
            return;
        }
        const skipped = item.tileUrls.slice(0, tileIndex);
        const previewUrls = item.previewUrls.filter((url) => !skipped.includes(url));
        onSelect?.({ id: item.id, title: item.title, previewUrls });
    };

    // View derived from the current input only.
    const q = query.trim();
    let mode = 'trending';
    let slice = trending;
    if (q.length > 0 && q.length < SEARCH_MIN_LENGTH) {
        mode = 'hint';
        slice = null;
    } else if (q.length >= SEARCH_MIN_LENGTH) {
        mode = 'search';
        slice = search && search.query === q ? search : createSlice(q, 'loading');
    }

    const handleLoadMore = () => {
        if (mode === 'hint' || !slice || slice.status !== 'ready' || !slice.hasMore) return;
        if (requestsRef.current[mode].controller) return;
        const target = slice;
        if (mode === 'trending') {
            setTrending((prev) => ({ ...prev, status: 'loadingMore' }));
        } else {
            setSearch((prev) => (prev && prev.query === target.query ? { ...prev, status: 'loadingMore' } : prev));
        }
        requestPage({ requestsRef, mountedRef, propsRef, setTrending, setSearch }, mode, {
            query: target.query,
            offset: target.nextOffset,
            append: true,
        });
    };

    const handleRetry = () => {
        if (mode === 'hint' || !slice || slice.status !== 'error') return;
        if (requestsRef.current[mode].controller) return;
        const target = slice;
        const append = target.items.length > 0;
        const status = append ? 'loadingMore' : 'loading';
        if (mode === 'trending') {
            setTrending((prev) => ({ ...prev, status }));
        } else {
            requestsRef.current.search.started = true;
            setSearch((prev) => (prev && prev.query === target.query ? { ...prev, status } : prev));
        }
        requestPage({ requestsRef, mountedRef, propsRef, setTrending, setSearch }, mode, {
            query: target.query,
            offset: append ? target.nextOffset : 0,
            append,
        });
    };

    const items = slice ? slice.items : [];
    const busy = !!slice && (slice.status === 'waiting' || slice.status === 'loading' || slice.status === 'loadingMore');
    let statusText = '';
    if (mode === 'hint') {
        statusText = HINT_TEXT;
    } else if (busy) {
        statusText = LOADING_TEXT;
    } else if (slice.status === 'error') {
        statusText = describeGiphyError({ code: slice.errorCode });
    } else if (items.length === 0) {
        statusText = mode === 'search' ? EMPTY_SEARCH_TEXT : EMPTY_TRENDING_TEXT;
    }
    if (notice) {
        statusText = notice;
    }
    const gridKey = mode === 'search' ? `search:${q}` : mode;

    return (
        <div
            ref={rootRef}
            data-testid="gif-picker"
            role="region"
            aria-label="GIF picker"
            tabIndex={-1}
            onKeyDown={handleRootKeyDown}
            style={{
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                height: 'min(340px, 45vh)',
                borderTop: '1px solid var(--border)',
                paddingTop: '8px',
                marginBottom: '6px',
                minWidth: 0,
                outline: 'none',
            }}
        >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', minWidth: 0 }}>
                <input
                    type="search"
                    className="input"
                    aria-label="Search GIPHY"
                    placeholder="Search GIPHY"
                    maxLength={GIPHY_QUERY_MAX_LENGTH}
                    enterKeyHint="search"
                    value={query}
                    onChange={handleQueryChange}
                    onKeyDown={handleInputKeyDown}
                    style={{ marginBottom: 0, flex: 1, minWidth: 0 }}
                />
                <button
                    type="button"
                    aria-label="Close GIF picker"
                    title="Close GIF picker"
                    onClick={() => onClose?.()}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '18px',
                        cursor: 'pointer',
                        padding: '4px',
                        lineHeight: 1,
                        flexShrink: 0,
                    }}
                >
                    ✕
                </button>
            </div>

            <div
                data-testid="gif-picker-results"
                aria-busy={busy}
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
            >
                {items.length > 0 && (
                    <div
                        key={gridKey}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(min(30%, 120px), 1fr))',
                            gap: '6px',
                        }}
                    >
                        {items.map((item, index) => (
                            <GifTile key={index} item={item} onPick={handlePick} />
                        ))}
                    </div>
                )}
                <div
                    data-testid="gif-picker-status"
                    role="status"
                    aria-live="polite"
                    style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px 2px', overflowWrap: 'anywhere' }}
                >
                    {statusText}
                </div>
                {slice && slice.status === 'ready' && slice.hasMore && (
                    <button
                        type="button"
                        className="btn"
                        aria-label="Load more GIFs"
                        onClick={handleLoadMore}
                        style={{ width: 'auto', padding: '4px 12px', fontSize: '12px', margin: '0 auto 6px', display: 'block' }}
                    >
                        Load more
                    </button>
                )}
                {slice && slice.status === 'error' && (
                    <button
                        type="button"
                        className="btn"
                        onClick={handleRetry}
                        style={{ width: 'auto', padding: '4px 12px', fontSize: '12px', margin: '0 auto 6px', display: 'block' }}
                    >
                        Try again
                    </button>
                )}
            </div>

            <div
                style={{
                    flexShrink: 0,
                    background: '#000',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '4px 0',
                    marginTop: '6px',
                    borderRadius: '4px',
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    data-testid="gif-picker-attribution"
                    src={ATTRIBUTION_SRC}
                    alt="Powered by GIPHY"
                    width={200}
                    height={26}
                    style={{ maxWidth: '100%', height: 'auto' }}
                />
            </div>
        </div>
    );
}
