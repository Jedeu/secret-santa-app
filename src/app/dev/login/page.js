'use client';

import { useState } from 'react';
import { clientAuth } from '@/lib/firebase-client';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { PARTICIPANTS } from '@/lib/participants';
import { useRouter } from 'next/navigation';

/**
 * Dev Login Page for E2E Testing
 * 
 * This page provides instant "magic login" for any participant in the PARTICIPANTS list.
 * ONLY available in development mode. Guards against production usage via NODE_ENV check.
 * 
 * Usage: Navigate to /dev/login in development, click a participant name to log in.
 */

const DEFAULT_PASSWORD = 'password123';

/**
 * Handles the "Magic Login" for a selected participant
 * @param {string} email - The email of the participant to log in as
 * @returns {Promise<void>}
 */
async function handleLogin(email, setStatus, setLoading, router) {
    setLoading(true);
    setStatus(`Logging in as ${email}...`);

    try {
        // 1. Try to sign in with default password "password123"
        await signInWithEmailAndPassword(clientAuth, email, DEFAULT_PASSWORD);
        setStatus('Login successful! Redirecting...');
        // 4. Redirect to '/'
        router.push('/');
    } catch (error) {
        // 2. If 'auth/user-not-found', create user with "password123"
        if (error.code === 'auth/user-not-found') {
            try {
                setStatus(`Creating user ${email}...`);
                await createUserWithEmailAndPassword(clientAuth, email, DEFAULT_PASSWORD);
                // 3. User is now signed in after creation
                setStatus('User created and logged in! Redirecting...');
                // 4. Redirect to '/'
                router.push('/');
            } catch (createError) {
                setStatus(`Error creating user: ${createError.message}`);
                setLoading(false);
            }
        } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            // User exists but password is wrong - try to use the known password
            setStatus(`Error: ${error.message}. User may have a different password.`);
            setLoading(false);
        } else {
            setStatus(`Error: ${error.message}`);
            setLoading(false);
        }
    }
}

export default function DevLoginPage() {
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    // Only render if NODE_ENV === 'development'
    if (process.env.NODE_ENV !== 'development') {
        return (
            <main style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                padding: '20px'
            }}>
                <h1>🚫 Access Denied</h1>
                <p>Dev Login is only available in development mode.</p>
            </main>
        );
    }

    return (
        <main style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '20px',
            gap: '20px'
        }}>
            <h1>🎄 Dev Login</h1>
            <p style={{ marginBottom: '10px', color: '#666' }}>
                Click a participant to log in instantly (Firebase Emulator only)
            </p>

            {/* Grid of participant buttons */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '12px',
                maxWidth: '600px',
                width: '100%'
            }}>
                {PARTICIPANTS.map((participant) => (
                    <button
                        key={participant.email}
                        onClick={() => handleLogin(participant.email, setStatus, setLoading, router)}
                        disabled={loading}
                        style={{
                            padding: '16px 24px',
                            fontSize: '16px',
                            fontWeight: '600',
                            border: 'none',
                            borderRadius: '8px',
                            background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            transition: 'transform 0.1s ease, box-shadow 0.2s ease',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                        onMouseEnter={(e) => {
                            if (!loading) {
                                e.target.style.transform = 'scale(1.02)';
                                e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.transform = 'scale(1)';
                            e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                        }}
                    >
                        {participant.name}
                    </button>
                ))}
            </div>

            {/* Status message */}
            {status && (
                <p style={{
                    marginTop: '20px',
                    padding: '12px 20px',
                    borderRadius: '8px',
                    background: status.includes('Error') ? '#fee2e2' : '#e0f2fe',
                    color: status.includes('Error') ? '#dc2626' : '#0369a1',
                    fontFamily: 'monospace',
                    fontSize: '14px'
                }}>
                    {status}
                </p>
            )}

            {/* Environment info */}
            <p style={{ marginTop: '20px', fontSize: '12px', color: '#999' }}>
                Environment: {process.env.NODE_ENV} | Auth: Firebase Emulator
            </p>
        </main>
    );
}
