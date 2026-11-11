import { NextResponse } from 'next/server';
import {
    AdmissionError,
    admissionErrorResponse,
    assertYearTransitionsEnabled,
    closeYear,
    verifyAdminRequest,
} from '@/lib/participant-admission';
import { isValidYear } from '@/lib/year-paths';

/**
 * Close a year: makes it read-only in one transaction on system/lifecycle. Idempotent.
 * Admin only; requires YEAR_TRANSITIONS_ENABLED=true outside development.
 *
 * Body: { year }
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

        const year = body?.year;
        if (!isValidYear(year)) {
            throw new AdmissionError('INVALID_YEAR');
        }

        const result = await closeYear({ year });

        return NextResponse.json({
            success: true,
            year: result.year,
            state: result.state,
            epoch: result.epoch,
            closedYears: result.closedYears,
            changed: result.changed,
        });
    } catch (error) {
        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        console.error('Close year failed:', error?.message);
        return NextResponse.json(
            { error: 'The action did not complete. Check the current state and try again.', code: 'INTERNAL' },
            { status: 500 }
        );
    }
}
