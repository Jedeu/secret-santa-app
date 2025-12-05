import { NextResponse } from 'next/server';
import { resetDatabase, ensureAllParticipants } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';
import { auth as adminAuth } from '@/lib/firebase';
import { isAdmin } from '@/lib/config';

export async function POST(request) {
    try {
        // Get Authorization header
        const authHeader = request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify Firebase ID token
        const decodedToken = await adminAuth.verifyIdToken(token);
        const email = decodedToken.email;

        // Check if user is admin
        if (!isAdmin(email)) {
            return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
        }

        // Reset the database
        await resetDatabase();

        // Re-create all participants
        await ensureAllParticipants(PARTICIPANTS);

        return NextResponse.json({ success: true, message: 'Database reset and participants re-initialized' });
    } catch (error) {
        console.error('Reset failed:', error);

        // Handle specific Firebase Auth errors
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ error: 'Token expired' }, { status: 401 });
        }
        if (error.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to reset database' }, { status: 500 });
    }
}
