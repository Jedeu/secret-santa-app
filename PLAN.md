# PLAN: Bug Inventory & Mobile PWA Strategy

## Context

The Secret Santa app is a Next.js + Firebase anonymous messaging app for 8 hardcoded participants (a friend group). It's used 2-3 months/year during the Christmas gift-giving season. The owner has asked for two things:

1. **Identify bugs** in the UI and messaging logic (document only, fix later)
2. **Create a mobile app** for the same 8 participants, without going through App Store/Google Play review, and with automatic updates on deploy

---

## Part 1: Bug Inventory

### HIGH Severity

| ID | Bug | File | Lines | Impact |
|----|-----|------|-------|--------|
| BUG-1 | **Asymmetric unread count for Santa tab** | `src/hooks/useRealtimeMessages.js` | 111-141 | Recipient unread allows legacy messages (no `conversationId`) through. Santa unread requires strict `msg.conversationId === expectedConvId`, excluding all legacy messages. Santa tab never shows unread badges for legacy messages. |
| BUG-2 | **Legacy message duplication in mutual cycles** | `src/lib/message-utils.js` | 54-57 | `filterMessages()` includes legacy messages (no `conversationId`) in ALL matching conversations. If A is Santa to B AND B is Santa to A, legacy messages appear in BOTH tabs. |
| BUG-3 | **Ambiguous Santa detection in Public Feed** | `src/components/PublicFeed.js` | 44-54 | Legacy `isSantaMsg` fallback uses `fromUser.recipientId === msg.toId`, which is ambiguous in mutual cycles. Messages can land in wrong thread or show wrong sender labels. |
| BUG-4 | **Overly permissive Firestore rules** | `firestore.rules` | 7-11 | `allow read, write: if request.auth != null` lets any authenticated user read/write all documents. No validation of `fromId`, no conversation isolation, no admin-only protections. Enables message forgery, reading all conversations, and modifying assignments. Acceptable risk for trusted 8-person group; real vulnerability for broader use. |

### MEDIUM Severity

| ID | Bug | File | Lines | Impact |
|----|-----|------|-------|--------|
| BUG-5 | **Race condition in recipient selection** | `src/components/RecipientSelector.js` | 64-86 | Check-then-act: checks `recipient.gifterId` then does batch write. Another user could claim same recipient between check and commit. Should use Firestore transaction. |
| BUG-6 | **No double-click prevention** | `src/components/RecipientSelector.js` | 145 | Button disables via React state (`loading`). Fast double-click fires handler twice before state updates. |
| BUG-7 | **Client-side writes bypass validation** | `src/components/Chat.js` | 117-127 | Messages written directly to Firestore with `addDoc()`. Combined with BUG-4, any user could set any `fromId`. |

### LOW Severity

| ID | Bug | File | Lines | Impact |
|----|-----|------|-------|--------|
| BUG-8 | **PublicFeed lastViewed from localStorage only** | `src/components/PublicFeed.js` | 7-20 | Initial load reads localStorage, not Firestore. Clearing browser data resets all unread counts. Self-corrects after viewing each thread. |
| BUG-9 | **No auto-scroll for incoming messages** | `src/components/Chat.js` | 94-106 | Only auto-scrolls for own messages. Incoming messages from others don't trigger scroll even when user is at the bottom. |
| BUG-10 | **`alert()` for error messages** | RecipientSelector.js, Chat.js, AdminPanel.js, AuthGuard.js | Multiple | 18+ instances of `alert()`. Blocks UI, looks jarring on mobile/PWA standalone mode. Should be toast notifications. |
| BUG-11 | **Emoji button lacks `aria-label`** | `src/components/Chat.js` | 292-310 | Has `title` but no `aria-label`. Screen readers announce the emoji character instead of button purpose. |
| BUG-12 | **Unread badges lack `aria-live`** | Sidebar.js, TabNavigation.js, Chat.js | Multiple | Badge updates not announced to screen readers. |

---

## Part 2: Mobile App -- PWA Conversion

### Why PWA

Given the constraints (8 users, no app store, automatic updates, seasonal use), a Progressive Web App is the clear choice:

- **No app store** -- installable directly from browser via "Add to Home Screen"
- **Auto-updates** -- new deploys update the service worker automatically, no user action needed
- **Minimal new code** -- the app already has responsive CSS with mobile breakpoints at 800px
- **Zero cost** -- no Apple Developer ($99/yr) or Google Play ($25) fees
- **Full iOS support** -- iOS 16.4+ supports PWA push notifications, standalone mode, and proper home screen icons

**Trade-off:** Users need a one-time "Add to Home Screen" instruction (share URL + tap Share > Add to Home Screen). For 8 friends, this is a non-issue.

**Alternatives considered:**

| Approach | Why Not |
|----------|---------|
| Capacitor | Requires Xcode/Android Studio builds per update, extra tooling complexity, overkill for 8 users |
| React Native (Expo) | Entirely new codebase, massive overkill, still needs distribution mechanism |

### Implementation Steps

#### Step 1: Create `public/manifest.json`

No `public/` directory exists yet. Create it with the web app manifest:

```json
{
  "name": "Secret Santa",
  "short_name": "Santa",
  "description": "Secret Santa gift exchange with your friends",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#ff3b30",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Colors match existing CSS variables in `src/app/globals.css:2-5`.

#### Step 2: Create app icons in `public/icons/`

Minimum required:
- `icon-192x192.png` -- Android home screen
- `icon-512x512.png` -- Android splash + general purpose
- `icon-180x180.png` -- iOS Apple touch icon
- `icon-maskable-512x512.png` -- Android adaptive icon (with safe area padding)

Generate from a single 1024x1024 source icon. Festive red (`#ff3b30`) on dark background (`#0a0a0a`), gift/Santa motif.

#### Step 3: Update `src/app/layout.js`

Current state: Only exports `viewport`. No `metadata` export, no `<head>` tags.

Add Next.js `metadata` export:
```javascript
export const metadata = {
    title: 'Secret Santa',
    description: 'Secret Santa gift exchange with your friends',
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'Secret Santa',
    },
    icons: {
        icon: '/icons/icon-192x192.png',
        apple: '/icons/icon-180x180.png',
    },
};
```

Next.js App Router handles `<meta name="theme-color">` and Apple PWA meta tags automatically from this export.

#### Step 4: Add service worker via `@ducanh2912/next-pwa`

This is the actively maintained fork of `next-pwa`. Provides automatic service worker generation for offline caching.

**Modify `package.json`:** Add `@ducanh2912/next-pwa` dependency.

**Modify `next.config.js`:**
```javascript
const withPWA = require('@ducanh2912/next-pwa')({
    dest: 'public',
    disable: process.env.NODE_ENV === 'development',
    register: true,
    skipWaiting: true,
});

module.exports = withPWA({
    reactStrictMode: true,
});
```

This enables:
- Offline app shell caching (app loads without network)
- Combined with existing IndexedDB Firestore persistence, previously loaded messages display offline
- Automatic service worker updates on deploy

#### Step 5 (Future): Push notifications

Not in scope for initial PWA conversion. Would require:
- Firebase Cloud Messaging (FCM) integration
- Service worker push event listener
- FCM token management per user
- Available on iOS 16.4+ and all Android

### Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `public/manifest.json` | CREATE | Web app manifest |
| `public/icons/*.png` | CREATE | App icons (4 files) |
| `src/app/layout.js` | MODIFY | Add `metadata` export with manifest + Apple PWA tags |
| `next.config.js` | MODIFY | Wrap config with `next-pwa` |
| `package.json` | MODIFY | Add `@ducanh2912/next-pwa` dependency |

---

## Verification

1. **Unit tests:** `npm test` -- ensure no regressions from layout.js changes
2. **PWA install (iOS):** Safari > Share > Add to Home Screen -- app icon and name appear correctly
3. **PWA install (Android):** Chrome > menu > Install app -- install prompt shows correct metadata
4. **Standalone mode:** After install, app opens full-screen without browser chrome
5. **Lighthouse PWA audit:** `npx lighthouse <url> --only-categories=pwa` -- passes installability and basic PWA criteria
6. **Offline test (with service worker):** Enable airplane mode after install -- app shell loads, cached messages display
7. **Visual QA:** Use the `visual-qa` skill to screenshot the app on mobile viewport and verify no regressions
