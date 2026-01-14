# PLAN: PWA Conversion with Push Notifications

## Goal
Convert the Secret Santa web app into a Progressive Web App (PWA) with Firebase Cloud Messaging (FCM) push notifications for iOS (16.4+) and Android, enabling direct browser installation without app store distribution.

**Success Criteria:**
- [ ] App is installable from browser on iOS Safari and Android Chrome
- [ ] Push notifications trigger when new messages are received
- [ ] iOS 16.4+ users receive push notifications via FCM Web Push
- [ ] Offline capability via service worker caching
- [ ] No Apple Developer account required (web push only)

---

## Architecture

### Component Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PWA Architecture                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  Browser (PWA installed via "Add to Home Screen")                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Next.js App (src/app/)                                                 │ │
│  │  ┌───────────────────────┐  ┌──────────────────────────────────────────┐│ │
│  │  │ RealtimeMessagesContext│  │ NotificationProvider (NEW)              ││ │
│  │  │ (existing)            │  │ - Requests FCM permission               ││ │
│  │  │                       │  │ - Stores FCM token                      ││ │
│  │  └───────────────────────┘  │ - Handles foreground notifications      ││ │
│  │                             └──────────────────────────────────────────┘│ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐│ │
│  │  │ UI Components                                                        ││ │
│  │  │ ┌────────────────────┐  ┌───────────────────────────────────────────┐││ │
│  │  │ │ NotificationPrompt │  │ InstallPrompt (NEW)                       │││ │
│  │  │ │ (NEW)              │  │ - iOS: Manual instructions                │││ │
│  │  │ │ - Request permission│  │ - Android: beforeinstallprompt           │││ │
│  │  │ └────────────────────┘  └───────────────────────────────────────────┘││ │
│  │  └──────────────────────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Service Worker (firebase-messaging-sw.js)                              │ │
│  │  - Background push notification handling                                 │ │
│  │  - Offline caching (via next-pwa workbox)                               │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ FCM Token Registration
                                    │ (via API route)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Next.js API Routes (src/app/api/)                                           │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │  POST /api/notifications/register (NEW)                                  ││
│  │  - Receives FCM token from client                                        ││
│  │  - Stores in Firestore under users/{userId}/fcmTokens/{tokenHash}        ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Firestore Trigger
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Firebase Cloud Functions (functions/) (NEW)                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │  onMessageCreate (Firestore onCreate trigger)                            ││
│  │  - Reads recipient's FCM tokens                                          ││
│  │  - Sends push notification via FCM Admin SDK                             ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### SDK Separation

| File | SDK | Justification |
|------|-----|---------------|
| `src/lib/firebase-client.js` | Client | Existing client SDK - add FCM getToken |
| `src/lib/fcm-client.js` (NEW) | Client | FCM token retrieval, permission request |
| `src/hooks/useNotifications.js` (NEW) | Client | React hook for notification state |
| `src/components/NotificationPrompt.js` (NEW) | Client | UI component for permission request |
| `src/components/InstallPrompt.js` (NEW) | Client | UI component for PWA install |
| `src/context/NotificationContext.js` (NEW) | Client | Context for notification state |
| `src/app/api/notifications/register/route.js` (NEW) | Admin | Server-side FCM token storage |
| `functions/index.js` (NEW) | Admin (Firebase Functions) | Push notification trigger |
| `public/firebase-messaging-sw.js` (NEW) | N/A (Service Worker) | Background message handling |

---

## Proposed Changes

### Phase 1: PWA Infrastructure

#### File 1: `public/manifest.json` - CREATE

**SDK:** N/A (Static file)

**Purpose:** PWA manifest for installability and metadata

```json
{
  "name": "Secret Santa",
  "short_name": "Santa",
  "description": "Secret Santa gift exchange app",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**Verification:** `npx pwa-asset-generator` can validate manifest.

---

#### File 2: `public/icons/` - CREATE (Directory with Icons)

**SDK:** N/A (Static assets)

**Required Files:**
- `icon-192x192.png` - 192x192px PNG with Christmas/Santa theme
- `icon-512x512.png` - 512x512px PNG with Christmas/Santa theme
- `apple-touch-icon.png` - 180x180px PNG for iOS home screen

**Specification:**
- Background: `#1a1a2e` (matches app theme)
- Foreground: Gift/Santa icon in `#e94560` (primary color)
- Safe zone for maskable: 80% center area

---

#### File 3: `next.config.js` - MODIFY

**SDK:** N/A (Build configuration)

**Current State (verified from codebase):**
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
};

module.exports = nextConfig;
```

**New State:**
```javascript
const withPWA = require('next-pwa')({
    dest: 'public',
    register: true,
    skipWaiting: true,
    disable: process.env.NODE_ENV === 'development', // Disable in dev to avoid caching issues
    runtimeCaching: [
        {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
                cacheName: 'firestore-cache',
                expiration: {
                    maxEntries: 32,
                    maxAgeSeconds: 60 * 60 // 1 hour
                }
            }
        }
    ]
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
};

module.exports = withPWA(nextConfig);
```

**New Dependency Required:**
```bash
npm install next-pwa
```

---

#### File 4: `src/app/layout.js` - MODIFY

**SDK:** N/A (React layout)

**Current State (verified from codebase, lines 1-22):**
```javascript
import './globals.css';
import ClientProviders from '@/components/ClientProviders';

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};


export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <ClientProviders>
                    {children}
                </ClientProviders>
            </body>
        </html>
    );
}
```

**New State:**
```javascript
import './globals.css';
import ClientProviders from '@/components/ClientProviders';

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    themeColor: '#e94560',
};

export const metadata = {
    title: 'Secret Santa',
    description: 'Secret Santa gift exchange app',
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'Secret Santa',
    },
    icons: {
        icon: '/icons/icon-192x192.png',
        apple: '/icons/apple-touch-icon.png',
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                {/* iOS PWA meta tags for older iOS versions */}
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
            </head>
            <body>
                <ClientProviders>
                    {children}
                </ClientProviders>
            </body>
        </html>
    );
}
```

---

### Phase 2: Firebase Cloud Messaging (Client-Side)

#### File 5: `src/lib/fcm-client.js` - CREATE

**SDK:** Client (imports from `firebase/messaging`)

**Imports Required:**
```javascript
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { getApp } from 'firebase/app';
```

**Functions to Add:**

```javascript
/**
 * @constant {string} VAPID_KEY - Public VAPID key for FCM Web Push
 * Must be generated in Firebase Console > Project Settings > Cloud Messaging > Web Push certificates
 */
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/** @type {import('firebase/messaging').Messaging | null} */
let messagingInstance = null;

/**
 * Check if FCM is supported in the current browser environment.
 * FCM Web Push requires:
 * - HTTPS (or localhost)
 * - Service Worker support
 * - Notification API support
 * - For iOS: Safari 16.4+ running as installed PWA
 *
 * @returns {Promise<boolean>}
 */
async function isFcmSupported(): Promise<boolean>

/**
 * Get the FCM messaging instance (singleton).
 * Returns null if FCM is not supported.
 *
 * @returns {Promise<import('firebase/messaging').Messaging | null>}
 */
async function getMessagingInstance(): Promise<Messaging | null>

/**
 * Request notification permission and retrieve FCM token.
 *
 * @returns {Promise<{ granted: boolean, token: string | null, error?: string }>}
 */
async function requestNotificationPermission(): Promise<{
    granted: boolean;
    token: string | null;
    error?: string;
}>

/**
 * Set up foreground message handler.
 * Called when a message is received while the app is in the foreground.
 *
 * @param {(payload: import('firebase/messaging').MessagePayload) => void} callback
 * @returns {() => void} Unsubscribe function
 */
function onForegroundMessage(callback: (payload: MessagePayload) => void): () => void

/**
 * Get the current notification permission state.
 *
 * @returns {'granted' | 'denied' | 'default' | 'unsupported'}
 */
function getNotificationPermissionState(): 'granted' | 'denied' | 'default' | 'unsupported'
```

**Implementation Notes:**
- Must check `isSupported()` before any FCM operations
- iOS Safari PWA requires the app to be installed to home screen first
- Token retrieval requires service worker to be registered

---

#### File 6: `public/firebase-messaging-sw.js` - CREATE

**SDK:** N/A (Service Worker - runs outside React context)

**Purpose:** Handle background push notifications when app is not in foreground

```javascript
// Import Firebase scripts for service worker (compat versions required for SW)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
// Note: These config values must match the client config
firebase.initializeApp({
    apiKey: 'YOUR_API_KEY',           // Will be replaced with actual value
    authDomain: 'YOUR_AUTH_DOMAIN',
    projectId: 'xmasteak-app',
    storageBucket: 'YOUR_STORAGE_BUCKET',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
});

const messaging = firebase.messaging();

/**
 * Handle background messages.
 * This is called when the app is not in the foreground.
 */
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);

    const notificationTitle = payload.notification?.title || 'New Message';
    const notificationOptions = {
        body: payload.notification?.body || 'You have a new message',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: payload.data?.conversationId || 'default', // Group by conversation
        data: payload.data,
        actions: [
            { action: 'open', title: 'Open' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * Handle notification click events.
 */
self.addEventListener('notificationclick', (event) => {
    console.log('[firebase-messaging-sw.js] Notification clicked:', event);

    event.notification.close();

    if (event.action === 'dismiss') {
        return;
    }

    // Open or focus the app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If app is already open, focus it
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise, open a new window
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
```

**Critical Note:** The Firebase config values in the service worker must be replaced with actual production values during build or via environment variable injection.

---

#### File 7: `src/hooks/useNotifications.js` - CREATE

**SDK:** Client

**Imports Required:**
```javascript
import { useState, useEffect, useCallback } from 'react';
import {
    requestNotificationPermission,
    onForegroundMessage,
    getNotificationPermissionState,
    isFcmSupported
} from '@/lib/fcm-client';
```

**Hook Contract:**
```javascript
/**
 * React hook for managing push notification state and permissions.
 *
 * @param {Object} options
 * @param {string} options.userId - Current user's UUID (required for token registration)
 * @returns {{
 *   permissionState: 'granted' | 'denied' | 'default' | 'unsupported' | 'loading',
 *   isSupported: boolean,
 *   token: string | null,
 *   requestPermission: () => Promise<boolean>,
 *   error: string | null
 * }}
 */
function useNotifications({ userId }: { userId: string }): {
    permissionState: 'granted' | 'denied' | 'default' | 'unsupported' | 'loading';
    isSupported: boolean;
    token: string | null;
    requestPermission: () => Promise<boolean>;
    error: string | null;
}
```

**Behavior:**
1. On mount, check if FCM is supported
2. Check current permission state
3. If permission is granted, attempt to get existing token
4. `requestPermission()` triggers permission prompt and token retrieval
5. On token retrieval, POST to `/api/notifications/register`
6. Set up foreground message handler to show in-app toast

---

#### File 8: `src/components/NotificationPrompt.js` - CREATE

**SDK:** Client

**Imports Required:**
```javascript
'use client';
import { useState } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
```

**Component Props Contract:**
```javascript
/**
 * @typedef {Object} NotificationPromptProps
 * @property {string} userId - Current user's UUID
 * @property {() => void} [onDismiss] - Callback when user dismisses the prompt
 * @property {() => void} [onEnabled] - Callback when notifications are enabled
 */

/**
 * Renders a prompt encouraging users to enable push notifications.
 * Handles iOS-specific instructions for PWA installation requirement.
 *
 * Only renders when:
 * - FCM is supported
 * - Permission is not yet granted or denied
 * - User hasn't dismissed the prompt in this session
 *
 * @param {NotificationPromptProps} props
 */
function NotificationPrompt({ userId, onDismiss, onEnabled }: NotificationPromptProps): JSX.Element | null
```

**UI States:**
1. **Default:** "Enable notifications to know when you get messages!"
2. **iOS Not Installed:** "First, install this app: Tap Share > Add to Home Screen"
3. **Requesting:** Loading spinner
4. **Denied:** "Notifications blocked. Enable in browser settings."
5. **Error:** Display error message

**Styling:** Use existing CSS variables from `globals.css` (`.card`, `.btn`, etc.)

---

#### File 9: `src/components/InstallPrompt.js` - CREATE

**SDK:** Client

**Imports Required:**
```javascript
'use client';
import { useState, useEffect } from 'react';
```

**Component Props Contract:**
```javascript
/**
 * @typedef {Object} InstallPromptProps
 * @property {() => void} [onDismiss] - Callback when user dismisses the prompt
 * @property {() => void} [onInstalled] - Callback when app is installed
 */

/**
 * Renders platform-specific PWA install instructions.
 *
 * - Android Chrome: Uses beforeinstallprompt event to show native install prompt
 * - iOS Safari: Shows manual instructions (Share > Add to Home Screen)
 * - Already installed: Does not render
 *
 * Uses localStorage to remember if user dismissed the prompt.
 *
 * @param {InstallPromptProps} props
 */
function InstallPrompt({ onDismiss, onInstalled }: InstallPromptProps): JSX.Element | null
```

**Platform Detection Logic:**
```javascript
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
const isAndroid = /Android/.test(navigator.userAgent);
```

**localStorage Key:** `secret-santa-install-prompt-dismissed`

---

#### File 10: `src/components/ClientProviders.js` - MODIFY

**SDK:** Client

**Current State (verified from codebase):**
```javascript
'use client';

import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';

export default function ClientProviders({ children }) {
    return (
        <RealtimeMessagesProvider>
            {children}
        </RealtimeMessagesProvider>
    );
}
```

**New State:**
```javascript
'use client';

import { RealtimeMessagesProvider } from '@/context/RealtimeMessagesContext';
import { NotificationProvider } from '@/context/NotificationContext';

/**
 * ClientProviders
 *
 * Wraps children with all client-side Context providers.
 * This component has 'use client' directive and is imported by layout.js.
 *
 * Provider order (outermost to innermost):
 * 1. RealtimeMessagesProvider (consumes useUser internally)
 * 2. NotificationProvider (consumes user from RealtimeMessagesContext)
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export default function ClientProviders({ children }) {
    return (
        <RealtimeMessagesProvider>
            <NotificationProvider>
                {children}
            </NotificationProvider>
        </RealtimeMessagesProvider>
    );
}
```

---

#### File 11: `src/context/NotificationContext.js` - CREATE

**SDK:** Client

**Imports Required:**
```javascript
'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRealtimeMessagesContext } from '@/context/RealtimeMessagesContext';
import {
    requestNotificationPermission,
    onForegroundMessage,
    getNotificationPermissionState,
    isFcmSupported
} from '@/lib/fcm-client';
```

**Context Contract:**
```javascript
/**
 * @typedef {Object} NotificationContextValue
 * @property {'granted' | 'denied' | 'default' | 'unsupported' | 'loading'} permissionState
 * @property {boolean} isSupported
 * @property {string | null} token
 * @property {() => Promise<boolean>} requestPermission
 * @property {string | null} error
 * @property {boolean} showPrompt - Whether to show the notification prompt UI
 * @property {() => void} dismissPrompt - Dismiss the prompt for this session
 */

const NotificationContext = createContext<NotificationContextValue | null>(null);

/**
 * Hook to access notification context.
 * @throws {Error} If used outside NotificationProvider
 */
function useNotificationContext(): NotificationContextValue

/**
 * Provider component for notification state.
 * Must be a child of RealtimeMessagesProvider to access currentUser.
 */
function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element
```

---

### Phase 3: Server-Side FCM Token Storage

#### File 12: `src/app/api/notifications/register/route.js` - CREATE

**SDK:** Admin (Firebase Admin SDK)

**Imports Required:**
```javascript
import { NextResponse } from 'next/server';
import { firestore, auth } from '@/lib/firebase';
import admin from 'firebase-admin';
```

**API Contract:**
```javascript
/**
 * POST /api/notifications/register
 *
 * Registers an FCM token for push notifications.
 *
 * Request Headers:
 * - Authorization: Bearer <Firebase ID Token>
 *
 * Request Body:
 * {
 *   token: string,          // FCM registration token
 *   platform: 'web' | 'ios' | 'android'
 * }
 *
 * Response (200):
 * {
 *   success: true,
 *   message: 'Token registered'
 * }
 *
 * Response (401):
 * {
 *   error: 'Unauthorized'
 * }
 *
 * Response (400):
 * {
 *   error: 'Missing token'
 * }
 */
export async function POST(request: Request): Promise<NextResponse>
```

**Implementation Details:**

1. Verify Firebase ID token from Authorization header
2. Extract user's email from verified token
3. Look up user document by email to get UUID
4. Store token in subcollection: `users/{userId}/fcmTokens/{tokenHash}`
5. Use token hash as document ID to prevent duplicates

**Token Document Schema:**
```javascript
// users/{userId}/fcmTokens/{tokenHash}
{
    token: string,           // Full FCM token
    platform: 'web' | 'ios' | 'android',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsed: admin.firestore.FieldValue.serverTimestamp(),
    userAgent: string        // For debugging
}
```

---

### Phase 4: Firebase Cloud Functions

#### File 13: `functions/package.json` - CREATE

**SDK:** N/A (Node.js project config)

```json
{
  "name": "secret-santa-functions",
  "version": "1.0.0",
  "description": "Firebase Cloud Functions for Secret Santa push notifications",
  "main": "index.js",
  "engines": {
    "node": "20"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0"
  }
}
```

---

#### File 14: `functions/index.js` - CREATE

**SDK:** Admin (Firebase Admin SDK in Cloud Functions)

**Imports Required:**
```javascript
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
```

**Function Contract:**
```javascript
/**
 * Firestore trigger: Send push notification when a new message is created.
 *
 * Trigger: onCreate on 'messages/{messageId}'
 *
 * Behavior:
 * 1. Read the new message document
 * 2. Look up recipient user by toId
 * 3. Fetch all FCM tokens from users/{recipientId}/fcmTokens
 * 4. Look up sender name (handle anonymous Santa case)
 * 5. Send push notification via FCM
 * 6. Clean up invalid tokens (token errors)
 *
 * Anonymous Handling:
 * - If conversationId starts with 'santa_', and sender is Santa,
 *   use "Your Secret Santa" instead of sender name
 *
 * @param {Object} event - Firestore trigger event
 * @param {Object} event.data - Snapshot of created document
 */
exports.onMessageCreate = onDocumentCreated('messages/{messageId}', async (event) => { ... });
```

**Notification Payload:**
```javascript
{
    notification: {
        title: string,    // "New message from {name}" or "New message from Your Secret Santa"
        body: string      // Message content (truncated to 100 chars)
    },
    data: {
        messageId: string,
        conversationId: string,
        senderId: string,
        click_action: '/'  // URL to open on click
    },
    webpush: {
        fcmOptions: {
            link: '/'
        }
    }
}
```

**Error Handling:**
- If token is invalid (messaging/invalid-registration-token, messaging/registration-token-not-registered), delete the token document
- Log but don't fail on individual token errors
- Use `sendEachForMulticast` for batch sending to multiple tokens

---

#### File 15: `firebase.json` - MODIFY

**SDK:** N/A (Firebase config)

**Current State (verified from codebase):**
```json
{
  "firestore": {
    "database": "(default)",
    "location": "us-west1",
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": {
      "port": 9099,
      "host": "127.0.0.1"
    },
    "firestore": {
      "port": 8080,
      "host": "127.0.0.1"
    },
    "ui": {
      "enabled": true,
      "port": 4000,
      "host": "127.0.0.1"
    },
    "singleProjectMode": true
  }
}
```

**New State (add functions config):**
```json
{
  "firestore": {
    "database": "(default)",
    "location": "us-west1",
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs20"
  },
  "emulators": {
    "auth": {
      "port": 9099,
      "host": "127.0.0.1"
    },
    "firestore": {
      "port": 8080,
      "host": "127.0.0.1"
    },
    "functions": {
      "port": 5001,
      "host": "127.0.0.1"
    },
    "ui": {
      "enabled": true,
      "port": 4000,
      "host": "127.0.0.1"
    },
    "singleProjectMode": true
  }
}
```

---

### Phase 5: UI Integration

#### File 16: `src/app/page.js` - MODIFY

**SDK:** Client

**Changes Required:**

Add import for new components:
```javascript
import NotificationPrompt from '@/components/NotificationPrompt';
import InstallPrompt from '@/components/InstallPrompt';
```

Add prompts to the main UI (after AuthGuard, before main content):
```javascript
{/* Show install and notification prompts */}
<InstallPrompt />
<NotificationPrompt userId={user.id} />
```

**Placement:** Inside the authenticated section, rendered once at the top of the main layout.

---

## Data Model Changes

### New Subcollection: `users/{userId}/fcmTokens/{tokenHash}`

```javascript
// Document ID: SHA-256 hash of token (first 32 chars) to prevent duplicates
{
    token: string,           // Full FCM registration token
    platform: 'web' | 'ios' | 'android',
    createdAt: Timestamp,    // Server timestamp
    lastUsed: Timestamp,     // Updated on each notification send
    userAgent: string        // Browser/device info for debugging
}
```

**Index Requirements:** None (queries are by document ID only)

**Migration Strategy:** No migration needed - new subcollection, existing data unaffected.

---

## Environment Variables

### New Variables Required

Add to `.env.local` (development) and Vercel environment (production):

```bash
# Firebase Cloud Messaging
NEXT_PUBLIC_FIREBASE_VAPID_KEY=<your-vapid-key>    # From Firebase Console > Cloud Messaging > Web Push certificates
NEXT_PUBLIC_FIREBASE_API_KEY=<your-api-key>        # Already exists, ensure set
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<your-auth-domain>
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<your-sender-id>
NEXT_PUBLIC_FIREBASE_APP_ID=<your-app-id>
```

### Firebase Console Setup

1. **Enable Cloud Messaging:** Firebase Console > Project Settings > Cloud Messaging
2. **Generate VAPID Key:** Cloud Messaging > Web Push certificates > Generate key pair
3. **Enable Cloud Functions:** Upgrade to Blaze plan (required for Cloud Functions)

---

## Verification

### Automated Tests

#### New Test File: `__tests__/unit/fcm-client.test.js`
```javascript
// Test cases:
// - isFcmSupported() returns false in Node.js environment
// - getNotificationPermissionState() returns 'unsupported' when Notification API missing
// - requestNotificationPermission() handles permission denial gracefully
```

#### New Test File: `__tests__/integration/notifications.test.js`
```javascript
// Test cases (requires emulators):
// - POST /api/notifications/register stores token in Firestore
// - POST /api/notifications/register rejects invalid auth token
// - POST /api/notifications/register updates lastUsed on duplicate token
```

#### Existing Tests Must Pass
```bash
npm run test:unit                    # All unit tests
npm run test:integration             # All integration tests (with emulators)
```

### Manual QA

#### PWA Installation Test
1. Build production: `npm run build && npm start`
2. Open in Chrome (Android) or Safari (iOS 16.4+)
3. **Android:** Look for "Install" prompt or menu > "Add to Home Screen"
4. **iOS:** Tap Share > "Add to Home Screen"
5. **Expected:** App icon appears on home screen, opens in standalone mode

#### Push Notification Test (Requires Production or ngrok)
1. Deploy to Vercel or use ngrok for HTTPS
2. Sign in as test user
3. Enable notifications when prompted
4. From another device/browser, sign in as a different user
5. Send a message to the first user
6. **Expected:** First user's device shows push notification

#### iOS-Specific Tests
1. Install PWA on iOS device (Safari 16.4+)
2. Request notification permission
3. **Expected:** iOS shows native permission dialog
4. Send message from another user
5. **Expected:** Push notification appears even when app is closed

### Emulator Testing (Limited)

Push notifications cannot be fully tested in emulators, but you can verify:
1. Token registration API works: `curl -X POST http://localhost:3000/api/notifications/register`
2. Cloud Function triggers on message creation (view in Functions emulator UI at port 5001)
3. Token is stored in Firestore emulator

---

## Open Questions

1. **VAPID Key Management:** Should the VAPID key be committed to the repo (it's public), or should it always be an environment variable?
   - **Recommendation:** Environment variable for flexibility, but VAPID keys are safe to expose.

2. **Notification Opt-Out:** Should users be able to disable notifications after enabling them (beyond browser settings)?
   - **Recommendation:** Add a toggle in a future settings page, not blocking for MVP.

3. **Notification Grouping:** Should multiple messages from the same conversation collapse into a single notification?
   - **Recommendation:** Use `tag: conversationId` in notification options (already in spec) - this replaces rather than stacks.

4. **Anonymous Santa in Notifications:** When Santa sends a message, the notification says "Your Secret Santa". But the recipient knows who their Santa is only if they look at the message content. Is this the desired behavior?
   - **Recommendation:** Yes, maintain anonymity in notification title. Santa identity is revealed in message content only.

5. **Token Cleanup:** How often should stale FCM tokens be cleaned up?
   - **Recommendation:** Clean on failed send (already in spec). No scheduled cleanup for 8-user app.

---

## Risk Assessment

### Complexity: MEDIUM-HIGH
- **Cloud Functions:** New infrastructure component not previously used
- **Service Worker:** Separate execution context with different debugging needs
- **iOS Safari Quirks:** Push notifications only work in installed PWA mode

### Firestore Reads Impact
- **Token Storage:** +1 write per token registration (one-time per device)
- **Cloud Function:** +2 reads per message (recipient lookup + tokens lookup)
- **Acceptable:** For 8 users with moderate messaging, well within free tier

### Backward Compatibility
- **No Breaking Changes:** All existing functionality preserved
- **Additive Only:** New files and optional features
- **Graceful Degradation:** If FCM not supported, app works normally without notifications

### Known Risks
1. **iOS 16.4 Requirement:** Older iOS devices cannot receive push notifications
2. **PWA Installation Required for iOS:** Must be installed to home screen for notifications
3. **Firebase Blaze Plan:** Cloud Functions require pay-as-you-go plan (free tier generous)
4. **Service Worker Caching:** May need to manually clear during development

### Mitigation
- Clear documentation for users on iOS installation steps
- Disable service worker in development mode
- Monitor Firebase usage in console

---

## Implementation Order

1. **Phase 1: PWA Infrastructure** (no dependencies)
   - manifest.json, icons, next.config.js, layout.js meta tags

2. **Phase 2a: FCM Client Library** (depends on Phase 1 for SW)
   - fcm-client.js, firebase-messaging-sw.js

3. **Phase 2b: React Integration** (depends on Phase 2a)
   - useNotifications.js, NotificationContext.js, NotificationPrompt.js, InstallPrompt.js

4. **Phase 3: Server-Side Token Storage** (can parallel with Phase 2)
   - /api/notifications/register

5. **Phase 4: Cloud Functions** (depends on Phase 3)
   - functions/index.js, firebase.json update

6. **Phase 5: UI Integration** (depends on Phase 2b)
   - page.js updates

---

## Dependencies to Install

```bash
# PWA support
npm install next-pwa

# No additional dependencies for FCM - already included in firebase package
```

---

## Files Summary

| File | Action | SDK | Priority |
|------|--------|-----|----------|
| `public/manifest.json` | CREATE | N/A | P1 |
| `public/icons/*.png` | CREATE | N/A | P1 |
| `next.config.js` | MODIFY | N/A | P1 |
| `src/app/layout.js` | MODIFY | N/A | P1 |
| `src/lib/fcm-client.js` | CREATE | Client | P2 |
| `public/firebase-messaging-sw.js` | CREATE | N/A | P2 |
| `src/hooks/useNotifications.js` | CREATE | Client | P2 |
| `src/context/NotificationContext.js` | CREATE | Client | P2 |
| `src/components/NotificationPrompt.js` | CREATE | Client | P2 |
| `src/components/InstallPrompt.js` | CREATE | Client | P2 |
| `src/components/ClientProviders.js` | MODIFY | Client | P2 |
| `src/app/api/notifications/register/route.js` | CREATE | Admin | P3 |
| `functions/package.json` | CREATE | Admin | P4 |
| `functions/index.js` | CREATE | Admin | P4 |
| `firebase.json` | MODIFY | N/A | P4 |
| `src/app/page.js` | MODIFY | Client | P5 |
