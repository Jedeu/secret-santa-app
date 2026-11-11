import { NextResponse } from 'next/server';

/**
 * Retired. The destructive Reset was replaced by Close year and Start new year
 * (/api/admin/year/close and /api/admin/year/start). Always 410, no Firestore access.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'Reset has been retired. Use Close year and Start new year.', code: 'RESET_RETIRED' },
        { status: 410 }
    );
}
