'use client';
import { useCallback } from 'react';
import { clientAuth } from '@/lib/firebase-client';
import { useToast } from '@/components/ClientProviders';

const RESET_CONFIRM_TEXT = 'WARNING: This will delete ALL data (users, messages, assignments). This cannot be undone. Are you sure?';

/**
 * Admin reset action shared by the sidebar, the compact header button, the welcome
 * screen and the reset-in-progress screen.
 *
 * @param {{ onComplete?: Function }} [options]
 * @returns {() => Promise<void>}
 */
export function useAdminReset({ onComplete } = {}) {
    const { showToast } = useToast();

    return useCallback(async () => {
        if (!confirm(RESET_CONFIRM_TEXT)) return;

        try {
            const currentUser = clientAuth?.currentUser;
            if (!currentUser) {
                showToast('Failed to reset system: not signed in.');
                return;
            }
            const token = await currentUser.getIdToken();

            const res = await fetch('/api/admin/reset', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                showToast('System reset successfully.', 'success');
                if (onComplete) {
                    onComplete();
                }
            } else {
                let message = 'Unknown error';
                try {
                    const error = await res.json();
                    message = error?.error || message;
                } catch {
                    // keep fallback
                }
                showToast(`Failed to reset system: ${message}`);
            }
        } catch (err) {
            console.error('Reset error:', err);
            showToast('Failed to reset system.');
        }
    }, [onComplete, showToast]);
}
