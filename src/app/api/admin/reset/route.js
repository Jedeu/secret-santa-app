import { NextResponse } from 'next/server';
import { resetAndReseedParticipants } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';
import { auth as adminAuth } from '@/lib/firebase';
import { isAdmin } from '@/lib/config';
import { admissionErrorResponse } from '@/lib/participant-admission';

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

        // Exclusive, fail-closed reset: begin (new epoch), delete, reseed, complete.
        await resetAndReseedParticipants(PARTICIPANTS);

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

        const mapped = admissionErrorResponse(error);
        if (mapped) return mapped;

        return NextResponse.json({ error: 'Reset did not complete. Run Reset again.' }, { status: 500 });
    }
}
