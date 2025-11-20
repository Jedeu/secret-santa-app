import GoogleProvider from "next-auth/providers/google";
import { getUserByEmail, createUser, getUserById } from '@/lib/firestore';
import { v4 as uuidv4 } from 'uuid';

export const authOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
    ],
    callbacks: {
        async signIn({ user, account, profile }) {
            try {
                // Sync OAuth user with our database
                let dbUser = await getUserByEmail(user.email);

                if (!dbUser) {
                    // Create new user in our database
                    dbUser = {
                        id: uuidv4(),
                        name: user.name || profile.name,
                        email: user.email,
                        oauthId: account.providerAccountId,
                        image: user.image,
                        recipientId: null,
                        gifterId: null
                    };
                    await createUser(dbUser);
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
