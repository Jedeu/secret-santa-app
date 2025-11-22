import { NextResponse } from 'next/server';
import { ensureAllParticipants } from '@/lib/firestore';
import { PARTICIPANTS } from '@/lib/participants';

export async function POST() {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }

    try {
        // Debug: Check if we are using Firestore or Local DB
        const firebaseAdmin = await import('@/lib/firebase');
        const usingFirestore = !!firebaseAdmin.firestore;

        // Get Project ID from the initialized app if possible
        const adminApp = (await import('firebase-admin')).apps[0];
        const projectId = adminApp ? adminApp.options.projectId : 'unknown';

        console.log('Seeding - Using Firestore:', usingFirestore);
        console.log('Seeding - Project ID:', projectId);
        console.log('Seeding - Env Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);

        await ensureAllParticipants(PARTICIPANTS);

        // Verify by reading back one user
        const testUser = await (await import('@/lib/firestore')).getUserByEmail(PARTICIPANTS[0].email);

        return NextResponse.json({
            success: true,
            message: 'Database seeded with participants',
            debug: {
                usingFirestore,
                projectId,
                envProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                verification: testUser ? 'User found' : 'User NOT found',
                testUserEmail: testUser?.email
            }
        });
    } catch (error) {
        console.error('Seeding failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
