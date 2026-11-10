/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useAdminReset } from '@/hooks/useAdminReset';
import { clientAuth } from '@/lib/firebase-client';

const mockShowToast = jest.fn();

jest.mock('@/components/ClientProviders', () => ({
    useToast: () => ({ showToast: mockShowToast })
}));

describe('useAdminReset', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.confirm = jest.fn(() => true);
        global.fetch = jest.fn();
        clientAuth.currentUser = { uid: 'admin-uid', getIdToken: jest.fn().mockResolvedValue('admin-id-token') };
    });

    afterEach(() => {
        clientAuth.currentUser = null;
    });

    test('a declined confirm sends no request', async () => {
        global.confirm = jest.fn(() => false);
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminReset({ onComplete }));

        await act(async () => {
            await result.current();
        });

        expect(global.fetch).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    test('success POSTs with the Bearer token, toasts and calls onComplete', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminReset({ onComplete }));

        await act(async () => {
            await result.current();
        });

        expect(global.fetch).toHaveBeenCalledWith('/api/admin/reset', {
            method: 'POST',
            headers: { Authorization: 'Bearer admin-id-token' }
        });
        expect(mockShowToast).toHaveBeenCalledWith('System reset successfully.', 'success');
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('failure shows the server error text and does not call onComplete', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Reset did not complete. Run Reset again.' })
        });
        const onComplete = jest.fn();
        const { result } = renderHook(() => useAdminReset({ onComplete }));

        await act(async () => {
            await result.current();
        });

        expect(mockShowToast).toHaveBeenCalledWith('Failed to reset system: Reset did not complete. Run Reset again.');
        expect(onComplete).not.toHaveBeenCalled();
    });

    test('a network error shows a generic failure toast', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useAdminReset());

        await act(async () => {
            await result.current();
        });

        expect(mockShowToast).toHaveBeenCalledWith('Failed to reset system.');
        console.error.mockRestore();
    });
});
