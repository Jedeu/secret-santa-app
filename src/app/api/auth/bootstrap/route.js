import { NextResponse } from 'next/server';
import {
    verifyRequestToken,
    resolveParticipant,
    admissionErrorResponse,
} from '@/lib/participant-admission';

/**
 * Resolve (or create) the caller's UUID profile and server-only admission record.
 * Requires a Bearer ID token.
 */
export async function POST(request) {
    try {
        const decoded = await verifyRequestToken(request);
        const { user } = await resolveParticipant(decoded, { verifyIndex: true });
        return NextResponse.json({ success: true, user });
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
