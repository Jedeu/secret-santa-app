import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getUserByEmail, createUser, getUserById, getUsersByName, updateUser } from '@/lib/firestore';
import { v4 as uuidv4 } from 'uuid';

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
                // Sync OAuth user with our database
                let dbUser = await getUserByEmail(user.email);

                if (!dbUser) {
                    // Check if there is a placeholder user with the same name (case-insensitive)
                    // This handles the case where a user was added as a recipient (placeholder) before they logged in
                    const existingUser = await getUsersByName(user.name);

                    if (existingUser && !existingUser.email) {
                        // Claim the placeholder account
                        dbUser = existingUser;
                        await updateUser(dbUser.id, {
                            email: user.email,
                            oauthId: account.providerAccountId,
                            image: user.image,
                            name: user.name // Update name to match OAuth profile
                        });
                    } else {
                        // Create new user in our database
                        dbUser = {
                            id: uuidv4(),
                            name: user.name || (profile && profile.name) || user.email.split('@')[0],
                            email: user.email,
                            oauthId: account.providerAccountId,
                            image: user.image,
                            recipientId: null,
                            gifterId: null
                        };
                        await createUser(dbUser);
                    }
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
