import { NextResponse } from 'next/server';
import { ensureAllParticipants } from '@/lib/firestore';
import { admissionErrorResponse } from '@/lib/participant-admission';

/**
 * DEV-ONLY: Seed the active year's roster. 403 outside development.
 * Refused in a closed year (YEAR_CLOSED).
 */
export async function POST() {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }

    try {
        const result = await ensureAllParticipants();

        return NextResponse.json({
            success: true,
            message: 'Database seeded with participants',
            ...result,
        });
    } catch (error) {
        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Seeding failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
