# Research: Mobile App Conversion (iOS/Android) for Secret Santa App

## Request Summary
Convert the existing Next.js/Firebase web app into iOS and Android mobile apps for 8 private users, with push notification support for message tracking.

---

## 1. Current Architecture Assessment

### 1.1 Frontend Structure

**Framework:** Next.js with React (App Router)
- All components use `'use client'` directive (client-side rendering)
- No Server Components are utilized - the app is essentially a SPA with Next.js routing

**Component Hierarchy:**
```
RootLayout (src/app/layout.js)
  └── ClientProviders (src/components/ClientProviders.js)
        └── RealtimeMessagesProvider (Context)
              └── Home Page (src/app/page.js)
                    ├── AuthGuard
                    │     ├── RecipientSelector (if no recipient assigned)
                    │     └── Main App Layout
                    │           ├── Sidebar (desktop)
                    │           ├── TabNavigation (mobile)
                    │           └── ChatTabs
                    │                 ├── Chat (recipient/santa tabs)
                    │                 └── PublicFeed (feed tab)
```

**Key Components:**
| Component | Location | Purpose |
|-----------|----------|---------|
| `AuthGuard` | `src/components/AuthGuard.js` | Handles auth states (loading, access denied, sign-in, authenticated) |
| `Chat` | `src/components/Chat.js` | Real-time chat with emoji picker, markdown support |
| `PublicFeed` | `src/components/PublicFeed.js` | Read-only feed showing all conversations |
| `TabNavigation` | `src/components/TabNavigation.js` | Mobile tab bar |
| `Sidebar` | `src/components/Sidebar.js` | Desktop navigation |
| `RecipientSelector` | `src/components/RecipientSelector.js` | First-time recipient selection |
| `AdminPanel` | `src/components/AdminPanel.js` | Admin controls (assign/reset) |

### 1.2 State Management

**React Context:**
- `RealtimeMessagesContext` (`src/context/RealtimeMessagesContext.js`) - Singleton pattern for real-time messages
  - Provides: `allMessages`, `allMessagesLoading`, `allMessagesError`, `currentUser`
  - Exposes: `updateLastReadTimestamp`, `subscribeToLastReadChanges`, `getLastReadTimestamp`

**Custom Hooks:**
| Hook | Location | Purpose |
|------|----------|---------|
| `useUser()` | `src/hooks/useUser.js` | Firebase Auth state + Firestore user document sync |
| `useRealtimeAllMessages()` | `src/hooks/useRealtimeMessages.js` | Subscribes to all messages from Context |
| `useRealtimeUnreadCounts()` | `src/hooks/useRealtimeMessages.js` | Client-side unread count calculation |

**Local State Patterns:**
- `useState` for UI state (activeTab, loading, etc.)
- `useMemo` for derived data (filtered messages, conversation IDs)
- `useCallback` for memoized functions
- `useRef` for StrictMode listener protection

### 1.3 Firebase Features Used

**Firebase Auth:**
- Google OAuth Sign-in (`signInWithPopup`, `GoogleAuthProvider`)
- Auth state listener (`onAuthStateChanged`)
- Token retrieval for API auth (`getIdToken`)
- Location: `src/lib/firebase-client.js`, `src/components/AuthGuard.js`

**Firestore (Client SDK):**
- Collections: `users`, `messages`, `lastRead`
- Real-time listeners (`onSnapshot`) - singleton pattern
- Document reads (`getDoc`, `getDocs`)
- Document writes (`setDoc`, `addDoc`)
- Batch writes (`writeBatch`)
- Queries with `where`, `orderBy`, `limit`
- IndexedDB persistence enabled (`enableIndexedDbPersistence`)
- Location: `src/lib/firebase-client.js`, `src/context/RealtimeMessagesContext.js`

**Firebase Admin SDK (Server-side):**
- Used in API routes only
- Location: `src/lib/firebase.js`
- Operations: `src/lib/firestore.js`

**NOT Currently Used:**
- Firebase Cloud Messaging (FCM)
- Firebase Cloud Functions
- Firebase Storage
- Firebase Analytics

### 1.4 Real-Time Messaging Implementation

**Architecture:**
```
                         ┌─────────────────────────────────────┐
                         │   RealtimeMessagesProvider         │
                         │   (Singleton Firestore Listener)   │
                         │                                    │
                         │   onSnapshot('messages',           │
                         │     orderBy('timestamp', 'desc'))  │
                         └──────────────┬────────────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────────────┐
                         │   allMessages state (Array)         │
                         └──────────────┬────────────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
           ▼                            ▼                            ▼
    ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
    │ Chat         │           │ Chat         │           │ PublicFeed   │
    │ (recipient)  │           │ (santa)      │           │              │
    │              │           │              │           │              │
    │ filterMessages()         │ filterMessages()         │ (all msgs)   │
    └──────────────┘           └──────────────┘           └──────────────┘
```

**Key Functions:**
```javascript
// src/lib/message-utils.js
getConversationId(santaId, recipientId)  // Returns: `santa_${santaId}_recipient_${recipientId}`
getLegacyConversationId(userId1, userId2) // Returns: sorted IDs joined with underscore
filterMessages(messages, currentUserId, otherUserId, targetConversationId)
```

**Message Sending (Direct Firestore Write):**
```javascript
// src/components/Chat.js:116-127
const messageData = {
    id: uuidv4(),
    fromId: currentUser.id,
    toId: otherUser.id,
    content: newMessage.trim(),
    timestamp: new Date().toISOString(),
    conversationId: conversationId
};
await addDoc(collection(firestore, 'messages'), messageData);
```

### 1.5 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Authentication "Handshake"                        │
└─────────────────────────────────────────────────────────────────────────┘

1. User clicks "Sign in with Google"
   └── AuthGuard.handleSignIn() → signInWithPopup(clientAuth, GoogleAuthProvider)

2. Firebase Auth state changes
   └── useUser() → onAuthStateChanged callback fires

3. Email validation
   └── getParticipantName(email) checks against PARTICIPANTS array
   └── If not found: return ACCESS_DENIED error

4. Firestore user lookup/creation
   └── Query: where('email', '==', email)
   └── If found: use existing user document
   └── If not found: auto-create with UUID:
       {
         id: uuidv4(),
         name: participantName,
         email: email,
         oauthId: firebaseUser.uid,
         image: firebaseUser.photoURL,
         recipientId: null,
         gifterId: null
       }

5. Real-time user document listener
   └── onSnapshot(userDocRef) → updates on recipientId/gifterId changes
```

---

## 2. Data Models (Verified from Code)

### 2.1 Users Collection
```javascript
// Verified from src/hooks/useUser.js:63-71 and src/lib/firestore.js:64-74
{
  id: string,           // UUID (NOT Firebase uid) - generated by uuidv4()
  name: string,         // From PARTICIPANTS list, Title Case normalized
  email: string,        // From Google OAuth
  oauthId: string,      // Firebase Auth uid (may be null for placeholder users)
  image: string | null, // Google profile photo URL
  recipientId: string | null,  // UUID of who they're buying for
  gifterId: string | null      // UUID of who's buying for them
}
```

### 2.2 Messages Collection
```javascript
// Verified from src/components/Chat.js:118-125
{
  id: string,              // UUID generated by uuidv4()
  fromId: string,          // UUID of sender
  toId: string,            // UUID of recipient
  content: string,         // Message text (supports markdown)
  timestamp: string,       // ISO 8601 format
  conversationId: string   // Format: santa_${santaId}_recipient_${recipientId}
}
// Note: Legacy messages may not have conversationId field
```

### 2.3 LastRead Collection
```javascript
// Verified from src/lib/lastReadClient.js:86-94
// Document ID format: `${userId}_${conversationId}`
{
  userId: string,
  conversationId: string,  // Can be legacy format or new format or "publicFeed_threadId"
  lastReadAt: string       // ISO 8601 timestamp
}
```

### 2.4 Participants List (Hardcoded)
```javascript
// From src/lib/participants.js:6-15
export const PARTICIPANTS = [
    { name: 'Jed', email: 'jed.piezas@gmail.com' },
    { name: 'Natalie', email: 'ncammarasana@gmail.com' },
    { name: 'Chinh', email: 'chinhhuynhlmft@gmail.com' },
    { name: 'Gaby', email: 'gabrielle@glim.ca' },
    { name: 'Jana', email: 'jana.j.maclaren@gmail.com' },
    { name: 'Peter', email: 'peter.planta@gmail.com' },
    { name: 'Louis', email: 'ldeschner@gmail.com' },
    { name: 'Genevieve', email: 'genevieve.ayukawa@gmail.com' }
];
// Total: 8 participants
```

---

## 3. Mobile Conversion Options Analysis

### 3.1 PWA (Progressive Web App)

**What It Is:** Convert the existing web app to be installable on mobile devices with push notifications via service workers.

**Effort Level:** LOW (1-2 weeks)

**Pros:**
- Minimal code changes required - leverage existing React/Next.js codebase
- Single codebase for web, iOS, and Android
- Firebase already supports PWA push notifications via FCM (Firebase Cloud Messaging)
- No app store approval needed - users install directly from browser
- Instant updates without app store review
- Already has responsive CSS (`globals.css` has mobile breakpoints at 800px)
- IndexedDB persistence already enabled (offline support partially implemented)

**Cons:**
- iOS Safari PWA support is limited (no background sync, restricted push notification support)
- iOS push notifications require iOS 16.4+ and Safari 16.4+ (released March 2023)
- Users must use "Add to Home Screen" - not as discoverable as app stores
- Some native features unavailable (e.g., background app refresh reliability)
- Cannot access all device APIs (contacts, file system, etc.)

**Required Changes:**
1. Add `manifest.json` for PWA metadata
2. Add service worker for offline caching and push notifications
3. Implement FCM push notification handling
4. Add "Add to Home Screen" prompt UI

**Reusable Code:** 95%+ (all existing code)

### 3.2 Capacitor/Ionic (Hybrid Wrapper)

**What It Is:** Wrap the existing web app in a native container (WebView) with access to native device APIs.

**Effort Level:** LOW-MEDIUM (2-4 weeks)

**Pros:**
- Uses existing React codebase directly (runs in WebView)
- Full native push notification support via `@capacitor/push-notifications`
- Can be distributed via App Store and Google Play
- Access to device APIs (camera, file system, etc.) via Capacitor plugins
- Same codebase for web, iOS, and Android
- Can incrementally add native features

**Cons:**
- Performance is WebView-based (not native rendering)
- App feels slightly less "native" than React Native/Flutter
- Requires Xcode for iOS builds (macOS required)
- App store approval process required
- Larger app size compared to pure native

**Required Changes:**
1. Add Capacitor to the project (`npm install @capacitor/core @capacitor/cli`)
2. Initialize iOS and Android projects (`npx cap init`)
3. Add push notification plugin (`@capacitor/push-notifications`)
4. Implement FCM registration and token handling
5. Configure iOS APNs and Android FCM in Firebase Console
6. Build and sign apps for store submission

**Reusable Code:** 90%+ (all existing code, minor native API adaptations)

### 3.3 React Native (Full Rewrite)

**What It Is:** Build native iOS and Android apps using React Native, which renders to native components.

**Effort Level:** HIGH (6-10 weeks)

**Pros:**
- True native performance and feel
- Large ecosystem of libraries
- Can share business logic with web (hooks, utilities)
- React knowledge transfers well
- Strong community support

**Cons:**
- Complete UI rewrite required (no JSX/CSS reuse)
- Need to learn React Native-specific patterns
- Different navigation paradigm (React Navigation)
- Firebase integration via `@react-native-firebase` (different API)
- Requires managing native build tools (Xcode, Android Studio)
- Potential for platform-specific bugs

**Reusable Code:**
- **Can Reuse (~30%):**
  - `src/lib/message-utils.js` - Pure JavaScript utilities
  - `src/lib/participants.js` - Hardcoded data
  - `src/lib/config.js` - Configuration
  - Business logic concepts from hooks (not exact code)
- **Must Rewrite (~70%):**
  - All React components (different JSX syntax, native components)
  - All CSS (must use StyleSheet or styled-components)
  - Firebase client (`@react-native-firebase/app`, `@react-native-firebase/auth`, `@react-native-firebase/firestore`)
  - Navigation (React Navigation instead of tabs)

### 3.4 Expo (Managed React Native)

**What It Is:** Simplified React Native development with managed build services and easier setup.

**Effort Level:** HIGH (5-8 weeks)

**Pros:**
- Easier setup than bare React Native
- EAS Build service handles iOS/Android builds
- No Xcode/Android Studio initially needed for development
- Over-the-air updates via `expo-updates`
- Push notifications via `expo-notifications`
- Well-documented Firebase integration

**Cons:**
- Still requires full UI rewrite
- Some native modules require "ejecting" to bare workflow
- Build service costs money for production
- Less control over native code initially

**Reusable Code:** Same as React Native (~30%)

### 3.5 Flutter (Complete Rewrite)

**What It Is:** Google's cross-platform framework using Dart language.

**Effort Level:** VERY HIGH (8-12 weeks)

**Pros:**
- Excellent Firebase support (FlutterFire)
- Consistent UI across platforms
- Good performance (compiles to native ARM)
- Growing ecosystem

**Cons:**
- Complete rewrite in Dart (different language)
- No React knowledge transfer
- Different paradigm (Widget trees, StatefulWidget)
- Learning curve for team
- Smaller talent pool than React

**Reusable Code:** ~0% (different language and framework)

---

## 4. Push Notification Requirements

### 4.1 Firebase Cloud Messaging (FCM) Overview

FCM is the recommended solution for push notifications with Firebase backend.

**How It Works:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Push Notification Flow                              │
└─────────────────────────────────────────────────────────────────────────┘

1. Mobile App Registers for Notifications
   └── App requests permission → Gets FCM token
   └── Store token in Firestore: users/{userId}/fcmTokens/{tokenId}

2. New Message Arrives
   └── Message written to Firestore messages collection

3. Cloud Function Triggers (NEW - needs to be created)
   └── Firestore onCreate trigger on 'messages' collection
   └── Function reads recipient's FCM tokens from Firestore
   └── Sends notification via FCM Admin SDK

4. FCM Delivers to Device
   └── iOS: Via APNs (Apple Push Notification service)
   └── Android: Via FCM directly
```

### 4.2 Required FCM Setup

**Firebase Console Configuration:**
1. Enable Cloud Messaging in Firebase Console
2. For iOS: Upload APNs authentication key (.p8 file) or certificates
3. For Android: FCM is auto-enabled with google-services.json

**New Code Required:**

1. **FCM Token Storage** (Client-side)
```javascript
// New function to add to user management
async function storeFcmToken(userId, token) {
  await setDoc(doc(firestore, 'users', userId, 'fcmTokens', token), {
    token: token,
    createdAt: serverTimestamp(),
    platform: Platform.OS  // 'ios' or 'android'
  });
}
```

2. **Cloud Function** (Server-side - NEW)
```javascript
// functions/index.js (Firebase Cloud Functions - does not exist yet)
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendMessageNotification = functions.firestore
  .document('messages/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.data();
    const recipientId = message.toId;

    // Get recipient's FCM tokens
    const tokensSnapshot = await admin.firestore()
      .collection('users').doc(recipientId)
      .collection('fcmTokens').get();

    const tokens = tokensSnapshot.docs.map(doc => doc.data().token);

    if (tokens.length === 0) return;

    // Get sender info for notification
    const senderDoc = await admin.firestore()
      .collection('users').doc(message.fromId).get();
    const senderName = senderDoc.exists ? senderDoc.data().name : 'Someone';

    // Send notification
    const payload = {
      notification: {
        title: `New message from ${senderName}`,
        body: message.content.substring(0, 100),
      },
      data: {
        messageId: context.params.messageId,
        conversationId: message.conversationId,
        senderId: message.fromId,
      }
    };

    await admin.messaging().sendToDevice(tokens, payload);
  });
```

### 4.3 Platform-Specific Requirements

**iOS:**
- Apple Developer Account ($99/year) required
- APNs configuration in Apple Developer portal
- App must request notification permission (`UNUserNotificationCenter`)
- Background modes: Remote notifications enabled
- Provision profile with Push Notifications capability

**Android:**
- Firebase project linked to app via google-services.json
- Notification channel configuration (Android 8.0+)
- Optional: Custom notification icon

---

## 5. Code Reusability Assessment Summary

| Approach | UI Code | Business Logic | Firebase Code | Effort | Native Feel |
|----------|---------|----------------|---------------|--------|-------------|
| **PWA** | 100% | 100% | 95% | LOW | Medium |
| **Capacitor** | 95% | 100% | 95% | LOW-MED | Medium |
| **React Native** | 0% | 60% | 30% | HIGH | High |
| **Expo** | 0% | 60% | 40% | HIGH | High |
| **Flutter** | 0% | 0% | 0% | VERY HIGH | High |

---

## 6. Recommendation for 8-User Private App

### Primary Recommendation: PWA + Capacitor Hybrid

**Phase 1: PWA (1-2 weeks)**
- Add PWA support to existing web app
- Implement FCM push notifications for Android
- Test with Android users immediately

**Phase 2: Capacitor (if iOS push needed) (2-3 weeks)**
- Wrap PWA in Capacitor for iOS native push support
- Submit to App Store for private distribution (TestFlight or Enterprise)

**Rationale:**
1. **Minimal Effort:** Leverages 95%+ of existing code
2. **Quick Deployment:** PWA can be deployed immediately
3. **Push Notifications:** FCM works well with PWA on Android; Capacitor solves iOS
4. **8 Users:** App Store overhead is justifiable via TestFlight (free)
5. **Existing Backend:** Firebase backend unchanged

### Alternative: Skip PWA, Go Direct to Capacitor

If iOS push notifications are critical from day one, skip the PWA phase and implement Capacitor directly. This gives you:
- Native push notifications on both platforms
- App Store distribution (more professional)
- Same development effort as PWA + slightly more for build setup

---

## 7. Files That Would Need Modification

### For PWA Approach:

| File | Changes |
|------|---------|
| `public/manifest.json` | NEW - PWA manifest |
| `public/sw.js` | NEW - Service worker |
| `src/app/layout.js` | Add manifest link, service worker registration |
| `src/lib/fcm-client.js` | NEW - FCM token management |
| `src/hooks/useUser.js` | Add FCM token registration on auth |
| `functions/index.js` | NEW - Cloud Function for push notifications |

### For Capacitor Approach:

Same as PWA, plus:

| File | Changes |
|------|---------|
| `capacitor.config.ts` | NEW - Capacitor configuration |
| `ios/` | NEW - iOS native project |
| `android/` | NEW - Android native project |
| `src/lib/push-notifications.js` | NEW - Capacitor push notification handling |

---

## 8. Gaps and Considerations

### Technical Gaps:
1. **No FCM setup currently** - Firebase Cloud Messaging not configured
2. **No Cloud Functions** - Backend is purely client-side Firestore; push notifications require server-side trigger
3. **No device token storage** - User documents don't track FCM tokens

### Security Considerations:
1. **Firestore Rules are permissive** - Current rules allow any authenticated user full read/write
2. **Hardcoded participants** - Authorization is based on email allowlist, which is fine for 8 users

### Cost Considerations:
1. **Firebase Cloud Functions** - Required for push notifications; has free tier
2. **Apple Developer Account** - $99/year for iOS distribution
3. **Capacitor/Expo Build Services** - Free for local builds; paid for cloud builds

---

## 9. Verification Commands

```bash
# Check current dependencies
cat /Users/jed.piezas/Desktop/secret-santa-app/package.json | grep -E "(firebase|react)"

# Search for existing FCM code (should return empty)
grep -r "messaging\|fcm\|notification" /Users/jed.piezas/Desktop/secret-santa-app/src/

# Check Firebase configuration
cat /Users/jed.piezas/Desktop/secret-santa-app/firebase.json

# Check if Cloud Functions exist (should not exist)
ls /Users/jed.piezas/Desktop/secret-santa-app/functions/ 2>/dev/null || echo "No functions directory"
```

---

## 10. Next Steps (If Proceeding)

1. **Decide on approach:** PWA, Capacitor, or PWA+Capacitor hybrid
2. **Create PLAN.md** with detailed implementation steps
3. **Set up Firebase Cloud Functions** (required for all approaches)
4. **Configure FCM in Firebase Console**
5. **For iOS:** Obtain Apple Developer account and configure APNs
