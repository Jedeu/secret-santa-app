'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ClientProviders';
import {
    attachForegroundListener,
    cancelPushOperations,
    syncPushTokenIfGranted,
} from '@/lib/push-client';
import { formatPushToast, isPushChat } from '@/lib/push-copy';

// A notification's link opens /?chat=santa or /?chat=recipient (src/lib/push-server.js).
const CHAT_PARAM = 'chat';

/** Reads and removes the chat a notification opened the app on. */
function takeChatParam() {
    if (typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CHAT_PARAM)) return null;
    const chat = url.searchParams.get(CHAT_PARAM);
    url.searchParams.delete(CHAT_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return isPushChat(chat) ? chat : null;
}

function getServiceWorkerContainer() {
    return typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
}

function ignoreFailure(run) {
    Promise.resolve().then(run).catch(() => { });
}

export default function PushNotificationsRuntime({
    currentUser,
    authUid,
    activeTab = null,
    onOpenChat,
    unreadTotal = 0,
    pushOn = false,
}) {
    const { showToast } = useToast();
    const userId = currentUser?.id;
    const activeTabRef = useRef(activeTab);
    const onOpenChatRef = useRef(onOpenChat);

    useEffect(() => {
        activeTabRef.current = activeTab;
        onOpenChatRef.current = onOpenChat;
    }, [activeTab, onOpenChat]);

    useEffect(() => {
        if (!userId || !authUid) {
            return undefined;
        }

        syncPushTokenIfGranted({ authUid }).catch((error) => {
            console.error('Push token sync failed:', error);
        });

        let unsubscribe = () => { };
        try {
            unsubscribe = attachForegroundListener((payload) => {
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                    return;
                }

                const chat = payload?.data?.chat;
                // The chat on screen already shows the message.
                if (isPushChat(chat) && chat === activeTabRef.current) {
                    return;
                }

                showToast(formatPushToast({
                    chat,
                    body: payload?.data?.body || payload?.notification?.body,
                }), 'success');
            });
        } catch (error) {
            console.error('Push foreground listener failed:', error);
        }

        return () => {
            cancelPushOperations();
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [userId, authUid, showToast]);

    // Tapping a notification opens its chat: a cold start arrives on /?chat=…, and an open
    // app receives FCM's notification-clicked message (onMessage never sees clicks).
    useEffect(() => {
        const chat = takeChatParam();
        if (chat) {
            onOpenChatRef.current?.(chat);
        }

        const container = getServiceWorkerContainer();
        if (typeof container?.addEventListener !== 'function') {
            return undefined;
        }

        const handleMessage = (event) => {
            const data = event?.data;
            if (!data?.isFirebaseMessaging || data.messageType !== 'notification-clicked') return;
            const target = data.data?.chat;
            if (isPushChat(target)) {
                onOpenChatRef.current?.(target);
            }
        };
        container.addEventListener('message', handleMessage);
        return () => container.removeEventListener('message', handleMessage);
    }, []);

    // Reading a chat clears its notification from the tray.
    useEffect(() => {
        const container = getServiceWorkerContainer();
        if (!isPushChat(activeTab) || typeof container?.getRegistration !== 'function') {
            return undefined;
        }

        const closeChatNotifications = () => {
            if (document.visibilityState !== 'visible') return;
            ignoreFailure(async () => {
                const registration = await container.getRegistration();
                if (typeof registration?.getNotifications !== 'function') return;
                const notifications = await registration.getNotifications({ tag: `chat-${activeTab}` });
                notifications.forEach((notification) => notification.close());
            });
        };

        closeChatNotifications();
        document.addEventListener('visibilitychange', closeChatNotifications);
        return () => document.removeEventListener('visibilitychange', closeChatNotifications);
    }, [activeTab]);

    // Home Screen badge: unread messages across both chats while notifications are on.
    useEffect(() => {
        if (typeof navigator === 'undefined' || typeof navigator.setAppBadge !== 'function') {
            return;
        }
        const count = userId && pushOn && unreadTotal > 0 ? unreadTotal : 0;
        ignoreFailure(() => (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge?.()));
    }, [userId, pushOn, unreadTotal]);

    // Signing out unmounts this runtime (AuthGuard): leave no badge behind.
    useEffect(() => () => {
        if (typeof navigator !== 'undefined' && typeof navigator.clearAppBadge === 'function') {
            ignoreFailure(() => navigator.clearAppBadge());
        }
    }, []);

    return null;
}
