import { NextResponse } from 'next/server';
import { ensureAllParticipants } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';

/**
 * Initialize the application by ensuring all participants exist in the database
 * This should be called when the app starts or after a reset
 */
export async function POST() {
    try {
        await ensureAllParticipants(PARTICIPANTS);
        return NextResponse.json({ success: true, message: 'All participants initialized' });
    } catch (error) {
        console.error('Failed to initialize participants:', error);
        return NextResponse.json({ error: 'Failed to initialize participants' }, { status: 500 });
    }
}
