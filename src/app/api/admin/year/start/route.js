import { NextResponse } from 'next/server';
import {
    AdmissionError,
    admissionErrorResponse,
    assertYearTransitionsEnabled,
    startNewYear,
    verifyAdminRequest,
} from '@/lib/participant-admission';
import { isValidYear } from '@/lib/year-paths';

/**
 * Start a new year: requires fromYear closed and a roster for targetYear; creates the new
 * year's profiles and bumps the epoch in one transaction. Idempotent.
 * Admin only; requires YEAR_TRANSITIONS_ENABLED=true outside development.
 *
 * Body: { fromYear, targetYear }
 */
export async function POST(request) {
    try {
        await verifyAdminRequest(request);
        assertYearTransitionsEnabled();

        let body;
        try {
            body = await request.json();
        } catch {
            throw new AdmissionError('INVALID_YEAR');
        }

        const fromYear = body?.fromYear;
        const targetYear = body?.targetYear;
        if (!isValidYear(fromYear) || !isValidYear(targetYear)) {
            throw new AdmissionError('INVALID_YEAR');
        }

        const result = await startNewYear({ fromYear, targetYear });

        return NextResponse.json({
            success: true,
            year: result.year,
            state: result.state,
            epoch: result.epoch,
            closedYears: result.closedYears,
            changed: result.changed,
            participants: result.changed ? result.participants : null,
        });
    } catch (error) {
        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Start year failed:', error?.message);
        return NextResponse.json(
            { error: 'The action did not complete. Check the current state and try again.', code: 'INTERNAL' },
            { status: 500 }
        );
    }
}
