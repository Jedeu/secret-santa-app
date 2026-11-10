import { getApps, initializeApp } from 'firebase/app';
import { getMessaging } from 'firebase/messaging/sw';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function hasMessagingConfig() {
    return Boolean(
        firebaseConfig.apiKey
        && firebaseConfig.projectId
        && firebaseConfig.messagingSenderId
        && firebaseConfig.appId
    );
}

if (hasMessagingConfig()) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    // Initializing messaging lets the FCM SDK display the server-provided
    // notification payload (title, body, icon, badge, conversation tag) on its own.
    // No custom background handler: a second, app-rendered notification would duplicate it.
    getMessaging(app);
}

self.addEventListener('notificationclick', (event) => {
    event.notification?.close();

    const targetUrl = event.notification?.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ('focus' in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }

            return null;
        })
    );
});
