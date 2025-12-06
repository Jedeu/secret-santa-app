import { NextResponse } from 'next/server';
import { ensureAllParticipants } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';
import { auth as adminAuth } from '@/lib/firebase';
import { isAdmin } from '@/lib/config';

/**
 * Initialize the application by ensuring all participants exist in the database
 * This should be called when the app starts or after a reset
 * Requires admin authentication or development mode
 */
export async function POST(request) {
    try {
        // Allow in development mode without auth
        if (process.env.NODE_ENV === 'development') {
            await ensureAllParticipants(PARTICIPANTS);
            return NextResponse.json({ success: true, message: 'All participants initialized' });
        }

        // In production, require admin authentication
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

        await ensureAllParticipants(PARTICIPANTS);
        return NextResponse.json({ success: true, message: 'All participants initialized' });
    } catch (error) {
        console.error('Failed to initialize participants:', error);

        // Handle specific Firebase Auth errors
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ error: 'Token expired' }, { status: 401 });
        }
        if (error.code === 'auth/argument-error') {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        return NextResponse.json({ error: 'Failed to initialize participants' }, { status: 500 });
    }
}
