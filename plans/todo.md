# PWA Migration Todo List

This file tracks all tasks for converting the Secret Santa app to a PWA with push notifications.

**Legend:**
- `pending` - Not started
- `in_progress` - Currently being worked on
- `completed` - Done and verified
- `blocked` - Cannot proceed (see notes)

---

## Tasks

```json
[
  {
    "id": "phase0_deps",
    "phase": 0,
    "task": "Install next-pwa dependency",
    "definition_of_done": [
      "Run: npm install next-pwa",
      "Verify: package.json contains next-pwa in dependencies",
      "Verify: npm run lint passes"
    ],
    "status": "pending",
    "context": "Required before Phase 1. Command: npm install next-pwa"
  },
  {
    "id": "phase1_step1",
    "phase": 1,
    "task": "Create public/manifest.json",
    "definition_of_done": [
      "File exists at public/manifest.json",
      "JSON is valid (no syntax errors)",
      "Contains required PWA fields: name, short_name, start_url, display, icons"
    ],
    "status": "pending",
    "context": {
      "content": {
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
    }
  },
  {
    "id": "phase1_step2",
    "phase": 1,
    "task": "Create PWA icon assets in public/icons/",
    "definition_of_done": [
      "Directory public/icons/ exists",
      "File public/icons/icon-192x192.png exists (placeholder OK)",
      "File public/icons/icon-512x512.png exists (placeholder OK)",
      "File public/icons/apple-touch-icon.png exists (placeholder OK)"
    ],
    "status": "pending",
    "context": "Create placeholder PNG icons. Use a simple colored square with #e94560 background. Actual design can be improved later. Can use ImageMagick: convert -size 192x192 xc:#e94560 icon-192x192.png"
  },
  {
    "id": "phase1_step3",
    "phase": 1,
    "task": "Modify next.config.js to add next-pwa wrapper",
    "definition_of_done": [
      "next.config.js imports and uses withPWA from next-pwa",
      "PWA is disabled in development mode",
      "npm run build succeeds without errors"
    ],
    "status": "pending",
    "context": {
      "new_content": "const withPWA = require('next-pwa')({\n    dest: 'public',\n    register: true,\n    skipWaiting: true,\n    disable: process.env.NODE_ENV === 'development',\n    runtimeCaching: [\n        {\n            urlPattern: /^https:\\/\\/firestore\\.googleapis\\.com\\/.*/i,\n            handler: 'NetworkFirst',\n            options: {\n                cacheName: 'firestore-cache',\n                expiration: {\n                    maxEntries: 32,\n                    maxAgeSeconds: 60 * 60\n                }\n            }\n        }\n    ]\n});\n\n/** @type {import('next').NextConfig} */\nconst nextConfig = {\n    reactStrictMode: true,\n};\n\nmodule.exports = withPWA(nextConfig);"
    }
  },
  {
    "id": "phase1_step4",
    "phase": 1,
    "task": "Modify src/app/layout.js to add PWA metadata",
    "definition_of_done": [
      "layout.js exports metadata object with manifest link",
      "layout.js includes apple-mobile-web-app meta tags in head",
      "npm run lint passes",
      "npm run build succeeds"
    ],
    "status": "pending",
    "context": "Add: export const metadata = { title, description, manifest, appleWebApp, icons }. Add <head> with iOS PWA meta tags. See PLAN.md File 4 for exact code."
  },
  {
    "id": "phase2_step1",
    "phase": 2,
    "task": "Create src/lib/fcm-client.js",
    "definition_of_done": [
      "File exists at src/lib/fcm-client.js",
      "Exports: isFcmSupported, getMessagingInstance, requestNotificationPermission, onForegroundMessage, getNotificationPermissionState",
      "Uses NEXT_PUBLIC_FIREBASE_VAPID_KEY environment variable",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "FCM client library. Imports from firebase/messaging. Must check isSupported() before FCM operations. See PLAN.md File 5 for function signatures."
  },
  {
    "id": "phase2_step2",
    "phase": 2,
    "task": "Create public/firebase-messaging-sw.js",
    "definition_of_done": [
      "File exists at public/firebase-messaging-sw.js",
      "Uses firebase-app-compat and firebase-messaging-compat scripts",
      "Handles onBackgroundMessage with notification display",
      "Handles notificationclick event"
    ],
    "status": "pending",
    "context": "Service worker for background push. Must use compat versions of Firebase SDK. Config values should be hardcoded (public anyway) or injected at build time. See PLAN.md File 6."
  },
  {
    "id": "phase2_step3",
    "phase": 2,
    "task": "Create src/hooks/useNotifications.js",
    "definition_of_done": [
      "File exists at src/hooks/useNotifications.js",
      "Exports useNotifications hook",
      "Returns: permissionState, isSupported, token, requestPermission, error",
      "POSTs token to /api/notifications/register on token retrieval",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "React hook for notification state. Takes userId option. See PLAN.md File 7 for hook contract."
  },
  {
    "id": "phase2_step4",
    "phase": 2,
    "task": "Create src/context/NotificationContext.js",
    "definition_of_done": [
      "File exists at src/context/NotificationContext.js",
      "Exports NotificationContext, NotificationProvider, useNotificationContext",
      "Provider consumes RealtimeMessagesContext for user info",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "Context for app-wide notification state. See PLAN.md File 11 for context contract."
  },
  {
    "id": "phase2_step5",
    "phase": 2,
    "task": "Create src/components/NotificationPrompt.js",
    "definition_of_done": [
      "File exists at src/components/NotificationPrompt.js",
      "Exports NotificationPrompt component",
      "Shows different UI for iOS not-installed state",
      "Uses existing CSS variables for styling",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "UI for requesting notification permission. Props: userId, onDismiss, onEnabled. See PLAN.md File 8."
  },
  {
    "id": "phase2_step6",
    "phase": 2,
    "task": "Create src/components/InstallPrompt.js",
    "definition_of_done": [
      "File exists at src/components/InstallPrompt.js",
      "Exports InstallPrompt component",
      "Detects iOS vs Android and shows appropriate instructions",
      "Uses beforeinstallprompt event on Android",
      "Uses localStorage for dismiss state",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "PWA install prompt. Props: onDismiss, onInstalled. localStorage key: secret-santa-install-prompt-dismissed. See PLAN.md File 9."
  },
  {
    "id": "phase2_step7",
    "phase": 2,
    "task": "Modify src/components/ClientProviders.js to add NotificationProvider",
    "definition_of_done": [
      "ClientProviders imports NotificationProvider",
      "NotificationProvider wraps children inside RealtimeMessagesProvider",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "Add NotificationProvider as inner wrapper. See PLAN.md File 10."
  },
  {
    "id": "phase3_step1",
    "phase": 3,
    "task": "Create src/app/api/notifications/register/route.js",
    "definition_of_done": [
      "File exists at src/app/api/notifications/register/route.js",
      "Exports POST handler",
      "Verifies Firebase ID token from Authorization header",
      "Stores token in users/{userId}/fcmTokens/{tokenHash} subcollection",
      "npm run lint passes"
    ],
    "status": "pending",
    "context": "Server-side FCM token storage. Uses Admin SDK. Token doc schema: { token, platform, createdAt, lastUsed, userAgent }. See PLAN.md File 12."
  },
  {
    "id": "phase4_step1",
    "phase": 4,
    "task": "Create functions/ directory and functions/package.json",
    "definition_of_done": [
      "Directory functions/ exists",
      "functions/package.json exists with firebase-admin and firebase-functions deps",
      "npm install in functions/ succeeds"
    ],
    "status": "pending",
    "context": {
      "package_json": {
        "name": "secret-santa-functions",
        "version": "1.0.0",
        "description": "Firebase Cloud Functions for Secret Santa push notifications",
        "main": "index.js",
        "engines": { "node": "20" },
        "dependencies": {
          "firebase-admin": "^12.0.0",
          "firebase-functions": "^5.0.0"
        }
      }
    }
  },
  {
    "id": "phase4_step2",
    "phase": 4,
    "task": "Create functions/index.js with onMessageCreate trigger",
    "definition_of_done": [
      "File exists at functions/index.js",
      "Exports onMessageCreate function",
      "Triggers on messages/{messageId} document creation",
      "Sends FCM notification to recipient's tokens",
      "Handles anonymous Santa case",
      "Cleans up invalid tokens"
    ],
    "status": "pending",
    "context": "Cloud Function for push notifications. Uses firebase-functions/v2/firestore. See PLAN.md File 14 for implementation details."
  },
  {
    "id": "phase4_step3",
    "phase": 4,
    "task": "Modify firebase.json to add functions config",
    "definition_of_done": [
      "firebase.json has functions config with source: functions",
      "firebase.json has functions emulator on port 5001",
      "firebase emulators:start succeeds with functions"
    ],
    "status": "pending",
    "context": "Add functions block and functions emulator. See PLAN.md File 15 for exact JSON."
  },
  {
    "id": "phase5_step1",
    "phase": 5,
    "task": "Modify src/app/page.js to add InstallPrompt and NotificationPrompt",
    "definition_of_done": [
      "page.js imports InstallPrompt and NotificationPrompt",
      "Prompts render in authenticated section before main content",
      "npm run lint passes",
      "npm run build succeeds"
    ],
    "status": "pending",
    "context": "Add prompts after AuthGuard. Pass user.id to NotificationPrompt. See PLAN.md File 16."
  },
  {
    "id": "phase5_step2",
    "phase": 5,
    "task": "Final verification - full build and manual test",
    "definition_of_done": [
      "npm run build succeeds",
      "npm run lint passes",
      "npm test passes",
      "App loads in browser without errors",
      "Manifest is accessible at /manifest.json",
      "Service worker registers (check DevTools > Application)"
    ],
    "status": "pending",
    "context": "Final integration check. Run production build and verify PWA features work."
  }
]
```

---

## Progress Summary

| Phase | Description | Tasks | Completed |
|-------|-------------|-------|-----------|
| 0 | Dependencies | 1 | 0 |
| 1 | PWA Infrastructure | 4 | 0 |
| 2 | FCM Client | 7 | 0 |
| 3 | Token Storage | 1 | 0 |
| 4 | Cloud Functions | 3 | 0 |
| 5 | UI Integration | 2 | 0 |
| **Total** | | **18** | **0** |
