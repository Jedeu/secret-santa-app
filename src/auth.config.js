import GoogleProvider from "next-auth/providers/google";
import { getDB, saveDB } from '@/lib/db';
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
            // Sync OAuth user with our database
            const db = getDB();

            let dbUser = db.users.find(u => u.email === user.email);

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
                db.users.push(dbUser);
                saveDB(db);
            }

            return true;
        },
        async session({ session, token }) {
            // Add our custom user ID to the session
            if (session.user) {
                const db = getDB();
                const dbUser = db.users.find(u => u.email === session.user.email);
                if (dbUser) {
                    session.user.id = dbUser.id;
                    session.user.recipientId = dbUser.recipientId;
                    session.user.gifterId = dbUser.gifterId;
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
