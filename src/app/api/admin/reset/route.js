import { NextResponse } from 'next/server';
import { resetDatabase, ensureAllParticipants } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth.config";

export async function POST(request) {
    const session = await getServerSession(authOptions);

    // Check if user is admin
    if (!session || !session.user || session.user.email !== 'jed.piezas@gmail.com') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Reset the database
        await resetDatabase();

        // Re-create all participants
        await ensureAllParticipants(PARTICIPANTS);

        return NextResponse.json({ success: true, message: 'Database reset and participants re-initialized' });
    } catch (error) {
        console.error('Reset failed:', error);
        return NextResponse.json({ error: 'Failed to reset database' }, { status: 500 });
    }
}
