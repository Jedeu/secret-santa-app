/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';

const mockGetDocsFromServer = jest.fn();
const mockGetDocs = jest.fn();
const mockGetDoc = jest.fn();
const mockOnSnapshot = jest.fn();

jest.mock('firebase/firestore', () => ({
    collection: (db, ...segments) => ({ path: segments.join('/') }),
    doc: (db, ...segments) => ({ path: segments.join('/') }),
    getDocsFromServer: (...args) => mockGetDocsFromServer(...args),
    getDocs: (...args) => mockGetDocs(...args),
    getDoc: (...args) => mockGetDoc(...args),
    onSnapshot: (...args) => mockOnSnapshot(...args),
}));

jest.mock('@/lib/firebase-client', () => ({
    firestore: { _isMock: true },
}));

import { clearYearArchiveCache, useYearArchive } from '@/hooks/useYearArchive';

function snapshot(rows, metadata = {}) {
    return {
        docs: rows.map((row) => ({ id: row.docId ?? row.id, data: () => ({ ...row }) })),
        metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Serve every collection with one row tagged by its path. */
function serveAll(metadataFor = () => ({})) {
    mockGetDocsFromServer.mockImplementation(async (ref) => snapshot(
        [{ id: `${ref.path}#1`, path: ref.path }],
        metadataFor(ref.path)
    ));
}

function paths() {
    return mockGetDocsFromServer.mock.calls.map(([ref]) => ref.path).sort();
}

describe('useYearArchive', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearYearArchiveCache();
    });

    test('idle without a uid or a valid year; no reads', () => {
        const { result: noUid } = renderHook(() => useYearArchive({ authUid: null, year: 2025, immutable: true }));
        const { result: badYear } = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2024, immutable: true }));

        expect(noUid.current.status).toBe('idle');
        expect(badYear.current.status).toBe('idle');
        expect(mockGetDocsFromServer).not.toHaveBeenCalled();
    });

    test('loads users, messages and reactions with getDocsFromServer only', async () => {
        serveAll();
        const { result } = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));

        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('ready'));

        expect(paths()).toEqual(['messages', 'reactions', 'users']);
        expect(mockGetDocs).not.toHaveBeenCalled();
        expect(mockGetDoc).not.toHaveBeenCalled();
        expect(mockOnSnapshot).not.toHaveBeenCalled();
        expect(result.current.data.users).toEqual([{ id: 'users#1', path: 'users' }]);
        expect(result.current.data.messages).toEqual([{ id: 'messages#1', path: 'messages' }]);
        expect(result.current.data.reactions).toEqual([{ id: 'reactions#1', path: 'reactions' }]);
    });

    test('a later year reads its own namespace; a missing id field falls back to the doc id', async () => {
        mockGetDocsFromServer.mockImplementation(async (ref) => snapshot([{ docId: 'doc-1', text: ref.path }]));
        const { result } = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2026, immutable: true }));

        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(paths()).toEqual(['years/2026/messages', 'years/2026/reactions', 'years/2026/users']);
        expect(result.current.data.users[0].id).toBe('doc-1');
    });

    test('immutable results are cached: a second mount reads nothing', async () => {
        serveAll();
        const first = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(first.result.current.status).toBe('ready'));
        first.unmount();
        mockGetDocsFromServer.mockClear();

        const second = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(second.result.current.status).toBe('ready'));

        expect(mockGetDocsFromServer).not.toHaveBeenCalled();
        expect(second.result.current.data.users).toEqual([{ id: 'users#1', path: 'users' }]);
    });

    test('non-immutable results are never cached', async () => {
        serveAll();
        const first = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: false }));
        await waitFor(() => expect(first.result.current.status).toBe('ready'));
        first.unmount();
        mockGetDocsFromServer.mockClear();

        const second = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: false }));
        await waitFor(() => expect(second.result.current.status).toBe('ready'));

        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
    });

    test('one of three rejecting -> error, no data and nothing cached', async () => {
        mockGetDocsFromServer.mockImplementation(async (ref) => {
            if (ref.path === 'messages') throw new Error('offline');
            return snapshot([{ id: 'x' }]);
        });
        const first = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(first.result.current.status).toBe('error'));
        expect(first.result.current.data).toBeNull();
        first.unmount();

        serveAll();
        mockGetDocsFromServer.mockClear();
        const second = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(second.result.current.status).toBe('ready'));
        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
    });

    test('a snapshot from the cache -> error and not cached', async () => {
        serveAll((path) => (path === 'users' ? { fromCache: true } : {}));
        const first = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(first.result.current.status).toBe('error'));
        expect(first.result.current.data).toBeNull();
        first.unmount();

        serveAll();
        mockGetDocsFromServer.mockClear();
        const second = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(second.result.current.status).toBe('ready'));
        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
    });

    test('a snapshot with pending writes -> error, nothing shown; a clean reload is ready and cached', async () => {
        serveAll((path) => (path === 'reactions' ? { hasPendingWrites: true } : {}));
        const { result, unmount } = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.data).toBeNull();

        serveAll();
        mockGetDocsFromServer.mockClear();
        act(() => {
            result.current.reload();
        });
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
        unmount();

        mockGetDocsFromServer.mockClear();
        const again = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(again.result.current.status).toBe('ready'));
        expect(mockGetDocsFromServer).not.toHaveBeenCalled();
    });

    test('reload refetches all three and bypasses the cache', async () => {
        serveAll();
        const { result } = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        mockGetDocsFromServer.mockClear();

        act(() => {
            result.current.reload();
        });
        await waitFor(() => expect(result.current.status).toBe('ready'));

        expect(paths()).toEqual(['messages', 'reactions', 'users']);
    });

    test('a held load followed by clearYearArchiveCache() is neither cached nor shown', async () => {
        const held = { users: deferred(), messages: deferred(), reactions: deferred() };
        mockGetDocsFromServer.mockImplementation((ref) => held[ref.path].promise);
        const { result, unmount } = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        expect(result.current.status).toBe('loading');

        clearYearArchiveCache();
        await act(async () => {
            held.users.resolve(snapshot([{ id: 'u' }]));
            held.messages.resolve(snapshot([{ id: 'm' }]));
            held.reactions.resolve(snapshot([{ id: 'r' }]));
        });

        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.data).toBeNull();
        unmount();

        serveAll();
        mockGetDocsFromServer.mockClear();
        const again = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(again.result.current.status).toBe('ready'));
        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
    });

    test("uid A's cached entry is not served to uid B", async () => {
        serveAll();
        const a = renderHook(() => useYearArchive({ authUid: 'uid-a', year: 2025, immutable: true }));
        await waitFor(() => expect(a.result.current.status).toBe('ready'));
        a.unmount();
        mockGetDocsFromServer.mockClear();

        const b = renderHook(() => useYearArchive({ authUid: 'uid-b', year: 2025, immutable: true }));
        expect(b.result.current.status).toBe('loading');
        await waitFor(() => expect(b.result.current.status).toBe('ready'));
        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
    });

    test('a year switch mid-load discards the late result', async () => {
        const held = { users: deferred(), messages: deferred(), reactions: deferred() };
        mockGetDocsFromServer.mockImplementation((ref) => {
            if (held[ref.path]) return held[ref.path].promise;
            return Promise.resolve(snapshot([{ id: `${ref.path}#new` }]));
        });
        const { result, rerender } = renderHook(
            ({ year }) => useYearArchive({ authUid: 'uid-a', year, immutable: true }),
            { initialProps: { year: 2025 } }
        );
        expect(result.current.status).toBe('loading');

        rerender({ year: 2026 });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.data.users).toEqual([{ id: 'years/2026/users#new' }]);

        await act(async () => {
            held.users.resolve(snapshot([{ id: 'late-2025' }]));
            held.messages.resolve(snapshot([]));
            held.reactions.resolve(snapshot([]));
        });

        expect(result.current.status).toBe('ready');
        expect(result.current.data.users).toEqual([{ id: 'years/2026/users#new' }]);

        // The late 2025 result was not cached either.
        mockGetDocsFromServer.mockClear();
        mockGetDocsFromServer.mockImplementation(async (ref) => snapshot([{ id: `${ref.path}#fresh` }]));
        rerender({ year: 2025 });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.data.users).toEqual([{ id: 'users#fresh' }]);
        expect(mockGetDocsFromServer).toHaveBeenCalledTimes(3);
    });
});
