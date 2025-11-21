import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getUserByEmail, updateUser } from '@/lib/firestore';

const providers = [
    GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
];

// Add Credentials provider for non-production environments (Local & Preview)
if (process.env.VERCEL_ENV !== 'production') {
    providers.push(
        CredentialsProvider({
            name: 'Dev Login',
            credentials: {
                name: { label: "Name", type: "text", placeholder: "John Doe" },
                email: { label: "Email", type: "email", placeholder: "john@example.com" }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.name) {
                    return null;
                }

                // Return a user object that matches what Google would return
                return {
                    id: credentials.email, // Use email as ID for dev login
                    name: credentials.name,
                    email: credentials.email,
                    image: `https://ui-avatars.com/api/?name=${encodeURIComponent(credentials.name)}`
                };
            }
        })
    );
}

export const authOptions = {
    providers,
    callbacks: {
        async signIn({ user, account, profile }) {
            try {
                // All participants should already exist with their emails
                // Just need to update their OAuth data when they first log in
                let dbUser = await getUserByEmail(user.email);

                if (!dbUser) {
                    // User not in the hardcoded participants list
                    // This shouldn't happen in production, but handle gracefully
                    console.warn(`User ${user.email} not in participants list`);
                    return false; // Deny sign-in
                }

                // Update OAuth data if not already set
                if (!dbUser.oauthId) {
                    await updateUser(dbUser.id, {
                        oauthId: account.providerAccountId,
                        image: user.image,
                        name: user.name // Update name to match OAuth profile
                    });
                }

                return true;
            } catch (error) {
                console.error("Error in signIn callback:", error);
                return false;
            }
        },
        async session({ session, token }) {
            // Add our custom user ID to the session
            if (session.user) {
                try {
                    const dbUser = await getUserByEmail(session.user.email);
                    if (dbUser) {
                        session.user.id = dbUser.id;
                        session.user.recipientId = dbUser.recipientId;
                        session.user.gifterId = dbUser.gifterId;
                    }
                } catch (error) {
                    console.error("Error in session callback:", error);
                }
            }
            return session;
        },
    },
    pages: {
        signIn: '/', // Redirect to home page for sign in
    },
    session: {
        strategy: 'jwt',
    },
};
