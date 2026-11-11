import { NextResponse } from 'next/server';
import {
    verifyRequestToken,
    resolveParticipant,
    admissionErrorResponse,
} from '@/lib/participant-admission';

/**
 * Resolve (or create) the caller's UUID profile in the active year and the server-only
 * admission record. Requires a Bearer ID token.
 *
 * Year-aware clients send `X-Secret-Santa-Client: 2`. Without it the route answers only
 * while the active year is 2025 (older clients get 409 CLIENT_UPDATE_REQUIRED).
 */
export async function POST(request) {
    try {
        const decoded = await verifyRequestToken(request);
        const yearAware = request.headers.get('x-secret-santa-client') === '2';
        const { user, year, state, epoch, closedYears } = await resolveParticipant(decoded, {
            verifyIndex: true,
            requireLegacyYear: !yearAware,
        });
        return NextResponse.json({ success: true, user, year, yearState: state, epoch, closedYears });
    } catch (error) {
        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Auth bootstrap failed:', error);
        return NextResponse.json(
            { error: 'Failed to load your profile', code: 'INTERNAL' },
            { status: 500 }
        );
    }
}
