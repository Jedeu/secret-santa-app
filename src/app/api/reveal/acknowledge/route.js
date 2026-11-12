import { NextResponse } from 'next/server';
import { firestore } from '@/lib/firebase';
import { verifyRequestToken, runFencedTransaction, admissionErrorResponse } from '@/lib/participant-admission';
import { getRevealState } from '@/lib/recipient-reveal';
import { isValidYear, yearCollectionPath } from '@/lib/year-paths';

/**
 * Record that the caller saw their drawn recipient (the one-time reveal).
 * Requires a Bearer ID token.
 *
 * Body: { year, epoch, userId, recipientId }
 *
 * Writes only the caller's own profile (resolved from the admission record inside the
 * same transaction), only when the year, epoch, profile id and recipient id all match
 * the server's current state, and only from "not this recipient" to "this recipient".
 * Idempotent: a replay returns the stored time with no write. Refused in a closed year.
 */

const MAX_ID_LENGTH = 128;

const MESSAGES = {
    INVALID_REQUEST: 'Invalid acknowledgment request.',
    REVEAL_STALE: 'Your recipient information changed. Reloading it now.',
    REVEAL_NOT_APPLICABLE: 'There is no recipient reveal to acknowledge.',
    REVEAL_UNAVAILABLE: 'Your recipient is not available. Ask an admin for help.',
};

/**
 * Typed route error, returned as { error, code }.
 */
class RevealRouteError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'RevealRouteError';
        this.status = status;
        this.code = code;
    }
}

function routeError(status, code) {
    return new RevealRouteError(status, code, MESSAGES[code]);
}

function isValidId(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= MAX_ID_LENGTH
        && !value.includes('/');
}

function isValidEpoch(value) {
    return Number.isInteger(value) && value >= 1;
}

export async function POST(request) {
    try {
        const decoded = await verifyRequestToken(request);

        let body;
        try {
            body = await request.json();
        } catch {
            throw routeError(400, 'INVALID_REQUEST');
        }

        const year = body?.year;
        const epoch = body?.epoch;
        const userId = body?.userId;
        const recipientId = body?.recipientId;
        if (!isValidYear(year) || !isValidEpoch(epoch) || !isValidId(userId) || !isValidId(recipientId)) {
            throw routeError(400, 'INVALID_REQUEST');
        }

        // No additional reads: the lifecycle, admission record and profile were read by
        // runFencedTransaction in this transaction.
        const work = async (tx, { user, profileId, year: activeYear, epoch: activeEpoch }) => {
            if (activeYear !== year
                || activeEpoch !== epoch
                || profileId !== userId
                || user?.id !== profileId) {
                throw routeError(409, 'REVEAL_STALE');
            }

            const state = getRevealState(user);
            if (state === 'manual') {
                throw routeError(409, 'REVEAL_NOT_APPLICABLE');
            }
            if (state === 'invalid') {
                throw routeError(409, 'REVEAL_UNAVAILABLE');
            }
            if (user.recipientId !== recipientId) {
                throw routeError(409, 'REVEAL_STALE');
            }
            if (state === 'acknowledged') {
                return {
                    changed: false,
                    acknowledgedAt: typeof user.revealAckAt === 'string' ? user.revealAckAt : null,
                };
            }

            const acknowledgedAt = new Date().toISOString();
            tx.update(
                firestore.collection(yearCollectionPath(activeYear, 'users').join('/')).doc(profileId),
                { revealAckRecipientId: recipientId, revealAckAt: acknowledgedAt }
            );
            return { changed: true, acknowledgedAt };
        };

        const result = await runFencedTransaction(decoded, work);

        return NextResponse.json({
            success: true,
            changed: result.changed,
            year,
            epoch,
            userId,
            recipientId,
            acknowledgedAt: result.acknowledgedAt,
        });
    } catch (error) {
        if (error instanceof RevealRouteError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }

        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Reveal acknowledgment failed:', error?.message);
        return NextResponse.json(
            { error: 'Could not save. Try again.', code: 'INTERNAL' },
            { status: 500 }
        );
    }
}
