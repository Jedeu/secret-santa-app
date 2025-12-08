'use client';
import { signInWithPopup, signOut as firebaseSignOut, GoogleAuthProvider } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase-client';

/**
 * AuthGuard - Handles authentication UI states
 *
 * Shows appropriate UI based on auth state:
 * - Loading: Shows loading spinner
 * - Access Denied: Shows error and sign-out button
 * - Not authenticated: Shows sign-in button
 * - Authenticated: Renders children
 *
 * @param {Object} props
 * @param {boolean} props.isLoading - Whether auth is still loading
 * @param {Object|null} props.currentUser - Current authenticated user or null
 * @param {Object|null} props.authError - Auth error object with code and message
 * @param {React.ReactNode} props.children - Content to render when authenticated
 */
export default function AuthGuard({ isLoading, currentUser, authError, children }) {
    // Handle sign in with Google
    const handleSignIn = async () => {
        try {
            if (!clientAuth) {
                alert('Firebase Auth not initialized. Make sure Firebase emulators are running: npm run emulators');
                console.error('clientAuth is null - Firebase not initialized');
                return;
            }
            const provider = new GoogleAuthProvider();
            await signInWithPopup(clientAuth, provider);
        } catch (error) {
            console.error('Sign in error:', error);
            if (error.code !== 'auth/popup-closed-by-user') {
                alert('Failed to sign in. Please try again.');
            }
        }
    };

    // Handle sign out
    const handleSignOut = () => {
        firebaseSignOut(clientAuth);
    };

    // Loading state
    if (isLoading) {
        return (
            <main className="container" style={{ justifyContent: 'center' }}>
                <div className="card">
                    <p style={{ textAlign: 'center' }}>Loading...</p>
                </div>
            </main>
        );
    }

    // Access denied state
    if (authError?.code === 'ACCESS_DENIED') {
        return (
            <main className="container" style={{ justifyContent: 'center' }}>
                <div className="card">
                    <h1 className="title">Access Denied</h1>
                    <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                        {authError.message}
                    </p>
                    <p className="text-muted" style={{ textAlign: 'center', marginBottom: '20px' }}>
                        Please contact the administrator if you believe this is an error.
                    </p>
                    <button
                        className="btn"
                        onClick={handleSignOut}
                        style={{ width: '100%' }}
                    >
                        Sign out
                    </button>
                </div>
            </main>
        );
    }

    // Not authenticated state
    if (!currentUser) {
        return (
            <main className="container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div className="card login-card">
                    <h1 className="title login-title">🎄 Secret Santa</h1>
                    <p className="login-subtitle">
                        Sign in to join the gift exchange!
                    </p>

                    <button
                        className="btn"
                        onClick={handleSignIn}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px'
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.208 1.126-.842 2.08-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4" />
                            <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853" />
                            <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
                            <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335" />
                        </svg>
                        Sign in with Google
                    </button>
                </div>
            </main>
        );
    }

    // Authenticated - render children
    return children;
}

// Export helper functions for use in other components
export { firebaseSignOut as signOut };
