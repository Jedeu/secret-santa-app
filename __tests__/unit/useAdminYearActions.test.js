/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useAdminYearActions } from '@/hooks/useAdminYearActions';
import { clientAuth } from '@/lib/firebase-client';

const mockShowToast = jest.fn();

jest.mock('@/components/ClientProviders', () => ({
    useToast: () => ({ showToast: mockShowToast })
}));

const CLOSE_PROMPT_2025 = 'Close the 2025 exchange?\n\nAll 2025 chats become read-only for everyone, and the 2025 pairings become visible to all participants in the archive. This cannot be reopened from the app.\n\nType 2025 to confirm.';

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

describe('useAdminYearActions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.prompt = jest.fn();
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
        clientAuth.currentUser = { uid: 'admin-uid', getIdToken: jest.fn().mockResolvedValue('admin-id-token') };
    });

    afterEach(() => {
        clientAuth.currentUser = null;
    });

    test('Close: the typed year POSTs { year } with the bearer token and JSON headers', async () => {
        window.prompt.mockReturnValue(' 2025 ');
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminYearActions({ onComplete }));

        await act(async () => {
            await result.current.closeYear(2025);
        });

        expect(window.prompt).toHaveBeenCalledWith(CLOSE_PROMPT_2025);
        expect(global.fetch).toHaveBeenCalledWith('/api/admin/year/close', {
            method: 'POST',
            headers: { Authorization: 'Bearer admin-id-token', 'Content-Type': 'application/json' },
            body: '{"year":2025}',
        });
        expect(mockShowToast).toHaveBeenCalledWith('2025 is now closed (read-only).', 'success');
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('Start: the prompt lists the roster; the typed year POSTs { fromYear, targetYear }', async () => {
        window.prompt.mockReturnValue('2026');
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminYearActions({ onComplete }));

        await act(async () => {
            await result.current.startYear(2025, 2026, ['Ann', 'Ben', 'Cal']);
        });

        expect(window.prompt).toHaveBeenCalledWith(
            'Start the 2026 exchange?\n\n3 participants: Ann, Ben, Cal.\nAnyone not on this list loses access to the app. Everyone picks a new recipient. 2025 stays in Archives.\n\nType 2026 to confirm.'
        );
        expect(global.fetch).toHaveBeenCalledWith('/api/admin/year/start', {
            method: 'POST',
            headers: { Authorization: 'Bearer admin-id-token', 'Content-Type': 'application/json' },
            body: '{"fromYear":2025,"targetYear":2026}',
        });
        expect(mockShowToast).toHaveBeenCalledWith('2026 has started.', 'success');
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['cancelled', null],
        ['mistyped', '2026'],
        ['empty', ''],
    ])('a %s prompt sends nothing', async (_label, answer) => {
        window.prompt.mockReturnValue(answer);
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminYearActions({ onComplete }));

        await act(async () => {
            await result.current.closeYear(2025);
            await result.current.startYear(2025, 2027, ['Ann']);
        });

        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockShowToast).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    test('a server error shows its message and does not call onComplete', async () => {
        window.prompt.mockReturnValue('2025');
        global.fetch.mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({ error: 'Year transitions are not enabled on this deployment.', code: 'TRANSITIONS_DISABLED' }),
        });
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminYearActions({ onComplete }));

        await act(async () => {
            await result.current.closeYear(2025);
        });

        expect(mockShowToast).toHaveBeenCalledWith('Failed to close 2025: Year transitions are not enabled on this deployment.');
        expect(onComplete).not.toHaveBeenCalled();
    });

    test('a network error on Start shows a failure toast', async () => {
        window.prompt.mockReturnValue('2026');
        global.fetch.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useAdminYearActions());

        await act(async () => {
            await result.current.startYear(2025, 2026, ['Ann', 'Ben']);
        });

        expect(mockShowToast).toHaveBeenCalledWith('Failed to start 2026: offline');
    });

    test('re-entry while busy is ignored', async () => {
        window.prompt.mockReturnValue('2025');
        const pending = deferred();
        global.fetch.mockImplementation(() => pending.promise);
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminYearActions({ onComplete }));

        let first;
        await act(async () => {
            first = result.current.closeYear(2025);
            await Promise.resolve();
        });
        expect(result.current.busy).toBe(true);

        await act(async () => {
            await result.current.closeYear(2025);
        });
        expect(window.prompt).toHaveBeenCalledTimes(1);

        await act(async () => {
            pending.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
            await first;
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(result.current.busy).toBe(false);
    });
});
