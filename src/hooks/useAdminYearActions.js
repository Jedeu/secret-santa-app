'use client';
import { useCallback, useRef, useState } from 'react';
import { clientAuth } from '@/lib/firebase-client';
import { useToast } from '@/components/ClientProviders';

/**
 * Admin Close year / Start new year actions (Client SDK auth token only; the routes do
 * the work). Each action asks the admin to type the year before anything is sent.
 *
 * @param {{ onComplete?: Function }} [options]
 * @returns {{ closeYear: (year: number) => Promise<void>,
 *   startYear: (fromYear: number, targetYear: number, rosterNames: string[]) => Promise<void>,
 *   busy: boolean }}
 */
export function useAdminYearActions({ onComplete } = {}) {
    const { showToast } = useToast();
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);

    const run = useCallback(async ({ promptText, expected, url, body, successMessage, failurePrefix }) => {
        if (busyRef.current) return;

        const input = typeof window !== 'undefined' ? window.prompt(promptText) : null;
        if (input === null || input === undefined || String(input).trim() !== expected) {
            return;
        }

        busyRef.current = true;
        setBusy(true);
        try {
            const currentUser = clientAuth?.currentUser;
            if (!currentUser) {
                throw new Error('not signed in');
            }
            const token = await currentUser.getIdToken();
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            let data = null;
            try {
                data = await res.json();
            } catch {
                data = null;
            }

            if (!res.ok) {
                throw new Error(data?.error || `Request failed with status ${res.status}`);
            }

            showToast(successMessage, 'success');
            if (onComplete) {
                onComplete();
            }
        } catch (error) {
            showToast(`${failurePrefix}: ${error?.message || 'Unknown error'}`);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [onComplete, showToast]);

    const closeYear = useCallback((year) => run({
        promptText: `Close the ${year} exchange?\n\nAll ${year} chats become read-only for everyone, and the ${year} pairings become visible to all participants in the archive. This cannot be reopened from the app.\n\nType ${year} to confirm.`,
        expected: String(year),
        url: '/api/admin/year/close',
        body: { year },
        successMessage: `${year} is now closed (read-only).`,
        failurePrefix: `Failed to close ${year}`,
    }), [run]);

    const startYear = useCallback((fromYear, targetYear, rosterNames) => {
        const names = Array.isArray(rosterNames) ? rosterNames : [];
        return run({
            promptText: `Start the ${targetYear} exchange?\n\n${names.length} participants: ${names.join(', ')}.\nAnyone not on this list loses access to the app. Recipients are drawn automatically, and each participant sees theirs once when they next open the app. ${fromYear} stays in Archives.\n\nType ${targetYear} to confirm.`,
            expected: String(targetYear),
            url: '/api/admin/year/start',
            body: { fromYear, targetYear },
            successMessage: `${targetYear} has started.`,
            failurePrefix: `Failed to start ${targetYear}`,
        });
    }, [run]);

    return { closeYear, startYear, busy };
}
