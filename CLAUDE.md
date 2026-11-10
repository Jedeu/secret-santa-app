# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is the source of truth for architecture, the data model, and code-level constraints. The agent workflow is defined once, in `AGENTS.md`.

## Agent Workflow (read first)

- A Claude Code session in this repository is a **delegate** of the primary assistant: the **planner** or the **implementer**, as its launch prompt states. With no role assigned by the launch prompt or by the user in the session, it is read-only and asks first.
- Delegates do not run checks, tests, builds, emulators, or browsers, do not use Git, do not touch databases, and do not delegate to subagents or skills. The primary assistant owns all of that.
- No implementation starts without a user-approved `PLAN.md`.
- These bullets are a summary. `AGENTS.md` governs and is imported on the next line; if its content is not in your context, read `AGENTS.md` before doing anything else.

@AGENTS.md

## Project Overview

Secret Santa app built with Next.js, Firebase, and Firestore. Users authenticate with Google OAuth, get assigned Secret Santa recipients, and exchange anonymous messages with their Santa and their recipient.

## Development Commands

```bash
# Start Firebase Emulators (required for development)
npm run emulators

# Development server (in a separate terminal)
npm run dev

# Build for production
npm run build

# Run linter
npm run lint

# Run all tests (unit tests only, excludes integration)
npm test

# Run unit tests only
npm run test:unit

# Run integration tests (requires emulators running)
npm run test:integration

# Run Playwright end-to-end tests (requires emulators; Playwright starts or reuses the dev server)
npm run test:e2e

# Run tests in watch mode
npm run test:watch
```

Node `>=22.13.0 <23` is required (`engines` in `package.json`; `.nvmrc` pins `22.15.0`). CI (`.github/workflows/ci.yml`) runs the emulator-backed suites through `npx firebase emulators:exec --project=xmasteak-app "<npm script>"`. In the agent workflow only the primary assistant runs these commands (see `AGENTS.md`). Local setup and multi-user browser verification notes are in [`docs/runtime-verification.md`](docs/runtime-verification.md).

## Firebase Emulator Setup

The app uses Firebase Emulators for local development:
- **Firestore**: Port 8080
- **Auth**: Port 9099
- **UI Dashboard**: Port 4000

Always run `npm run emulators` before starting development. The emulators must be running for both the dev server and integration tests.

## Architecture

### Authentication & User Management

User authentication is a server-mediated handshake:
1. Users sign in with Google OAuth via Firebase Auth.
2. `src/context/UserContext.js` is the single auth/profile owner (`useUser()` reads it). It POSTs the ID token to `/api/auth/bootstrap`.
3. `src/lib/participant-admission.js` checks the email against `src/lib/participants.js` (and `email_verified` outside development), then atomically resolves or creates the UUID profile and writes a server-only `authIdentities/{authUid}` record.
4. Firestore rules admit only callers whose admission record matches the current `system/lifecycle` epoch. Unauthorized emails get ACCESS_DENIED.

Clients never create `users` documents. After an admin reset, open clients re-bootstrap automatically. To remove a participant mid-season, remove them from the list and delete their `authIdentities` document.

### Dual Firebase Configuration

The app maintains two Firebase instances:
- **Client-side** (`src/lib/firebase-client.js`): Browser Firebase SDK, connects to emulators in dev
- **Server-side** (`src/lib/firebase.js`): Firebase Admin SDK for API routes

Both auto-detect development mode and connect to emulators at 127.0.0.1.

### Participant Management

Participants are defined in `src/lib/participants.js` as the source of truth:
- Hardcoded array of `{ name, email }` objects
- Helper functions: `getParticipantEmail()`, `getParticipantName()`, `getParticipantNames()`
- Used for authorization, recipient selection, and initial seeding

### Message Architecture

Messages use a **conversationId-based system**:
- Each message has `fromId` and `toId` (both are user UUIDs) tracking direction
- `content` holds the message body; `timestamp` is an **ISO 8601 string** (not a Firestore Timestamp)
- `conversationId` is a **directional** string, not a hash — format `santa_{santaId}_recipient_{recipientId}`
- Optional idempotency fields `clientMessageId` (UUID) and `clientCreatedAt` (ISO string) support safe retries; the message doc id is the `clientMessageId` when provided, else a fresh UUID
- Real-time updates via Firestore listeners in `src/hooks/useRealtimeMessages.js`

Key utilities in `src/lib/message-utils.js`:
- `getConversationId(santaId, recipientId)`: Builds the directional conversation ID `santa_{santaId}_recipient_{recipientId}` (order matters — swapping the args yields a different conversation)
- `getLegacyConversationId(userId1, userId2)`: Sorted-join (`{minId}_{maxId}`) fallback for old messages that predate `conversationId`; loses directionality
- `filterMessages(messages, currentUserId, otherUserId, targetConversationId)`: Filters and time-sorts messages for a specific chat. Routing is decided by resolveMessageConversation: explicit conversationId, then legacy isSantaMsg, then the known assignment, then a canonical fallback (santa = smaller id) only for genuinely ambiguous rows.

### Data Model

**users collection:**
```javascript
{
  id: string,           // UUID (not Firebase uid)
  name: string,         // From PARTICIPANTS list
  email: string,        // From Google OAuth
  oauthId: string,      // Firebase uid
  image: string,        // Google profile photo
  recipientId: string,  // UUID of who they're buying for
  gifterId: string      // UUID of who's buying for them
}
```

**messages collection:**
```javascript
{
  id: string,                 // UUID (equals clientMessageId when provided)
  fromId: string,             // Sender's user UUID
  toId: string,               // Recipient's user UUID
  content: string,            // Message body (1–4000 chars)
  timestamp: string,          // ISO 8601 string, e.g. "2026-07-05T18:30:00.000Z"
  conversationId: string,     // Directional: santa_{santaId}_recipient_{recipientId} (or null)
  clientMessageId?: string,   // Optional UUID for idempotent retries
  clientCreatedAt?: string    // Optional ISO string set by the client
}
```

Firestore rules additionally permit the **legacy** fields `isSantaMsg`, `fromName`, and `toName` on message create for backward compatibility. New messages written by `/api/messages/send` do not set them.

**lastRead collection** (per-user read markers; doc id `{userId}_{conversationId}`):
```javascript
{ userId: string, conversationId: string, lastReadAt: Timestamp } // lastReadAt = timestamp of the latest message the user has observed; monotonic
```

**typing collection** (ephemeral typing indicators; doc id `{conversationId}_{userId}`):
```javascript
{ userId: string, conversationId: string, typingAt: string }
```

**reactions collection** (emoji reactions; doc id `{messageId}_{userId}_{emoji}`):
```javascript
{ messageId: string, userId: string, emoji: string, createdAt: string }
```

**pushTokens collection**: Web Push subscription storage, managed server-side by `src/lib/push-server.js`.

**Server-only collections** (clients cannot read or write them): `authIdentities/{authUid}` `{ uid, email, userId, epoch, createdAt, updatedAt }`; `participantIndex/{email}` `{ email, userId, epoch, createdAt }`; `system/lifecycle` `{ epoch, state, resetId, resetStartedAt, updatedAt }`. `pushTokens` documents carry `authUid`, `revision` and `epoch`; push mutations must present the `epoch` and `revision` returned by `/api/push/status`.

### API Routes

Auth conventions: routes verify a Firebase **Bearer ID token** (`Authorization: Bearer <token>`) via the Admin SDK. Admin checks go through `isAdmin(email)` in `src/lib/config.js` (single source of truth — the admin email is no longer duplicated inline). Routes under `/api/dev/*` are hard-disabled outside `NODE_ENV=development`.

- **POST /api/auth/bootstrap**: Resolve or create the caller's profile and admission record. Requires a Bearer token.
- **POST /api/init**: Initialize all participants from the hardcoded list. No auth in development; requires an admin Bearer token in production.
- **POST /api/admin/reset**: Delete all data and reset the app. Requires admin Bearer token. Exclusive and fail-closed: if it does not complete, run it again.
- **POST /api/dev/assign**: Dev-only assignment helper. 403 outside development.
- **POST /api/dev/inject-message**: Dev-only message injection for testing. 403 outside development.
- **POST /api/dev/seed**: Dev-only seed data from the participants list. 403 outside development.
- **POST /api/messages/send**: Send a message. Requires a Bearer token; validates the conversation against both users' assignments and commits replay check, validation and write in one transaction keyed on clientMessageId. Dispatches a fail-open push notification to the recipient.
- **POST /api/push/status**: Report this device token's registration state (epoch, revision, ownership). Requires a Bearer token.
- **POST /api/push/register**: Register a Web Push subscription for the authenticated user. Requires Bearer token. Requires expectedEpoch and expectedRevision from /api/push/status.
- **POST /api/push/unregister**: Remove a Web Push subscription. Requires Bearer token. Requires expectedEpoch and expectedRevision from /api/push/status.

### Testing Strategy

Tests are split into unit and integration:
- **Unit tests** (`__tests__/unit/`): No external dependencies, use mocks
- **Integration tests** (`__tests__/integration/`): Require Firebase Emulators running

Integration tests are excluded from default `npm test` runs. Use `npm run test:integration` explicitly.

## Key Files

- `src/app/page.js`: Main app UI with tabbed interface (Recipient/Santa/Public Feed)
- `src/components/Chat.js`: Chat component with emoji picker and markdown support
- `src/components/PublicFeed.js`: Public message feed grouped by conversation
- `src/lib/firestore.js`: Firestore operations (ensureAllParticipants, assignSecretSantas, etc.)
- `firebase.json`: Emulator configuration
- `firestore.rules`: Firestore security rules (authoritative; summarized under Important Notes)
- `AGENTS.md`: Agent workflow contract (roles, approval loop, safety boundaries)

## Important Notes

- Admin email lives in one place: `ADMIN_EMAILS` in `src/lib/config.js` (checked via `isAdmin()`). Update it there.
- The app uses UUID-based user IDs throughout, not Firebase Auth UIDs. A user's Firestore doc id **is** their UUID (`users/{uuid}`), and message `fromId`/`toId` reference those UUIDs.
- Production requires environment variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (server Admin SDK), plus the `NEXT_PUBLIC_FIREBASE_*` client config including `NEXT_PUBLIC_FIREBASE_VAPID_KEY`. Push notifications go through Firebase Cloud Messaging (Admin SDK `messaging`), so they reuse the server Admin credentials — there is no separate web-push private key.
- **Firestore rules are hardened** (`firestore.rules`), not minimal. The rules file is authoritative; this list is a reading aid, not a guarantee:
  - Per-collection field allowlists (`keys().hasOnly([...])`) on every create/update.
  - Clients cannot create users or messages; both are written only by the server. Recipient selection must update both users reciprocally in one transaction.
  - lastRead doc ids must equal {userId}_{conversationId}; markers are monotonic; a user can read their own markers, and other users' DM markers for read receipts, but never another user's public-feed markers.
  - `typing` and `reactions` enforce deterministic doc-id shapes and owner identity.
  - `allow delete: if false` on users/messages/lastRead. `messages` also deny `update`; `users` and `lastRead` allow only the specific updates the rules check. `typing` and `reactions` let a signed-in user delete their own docs. A catch-all denies every other collection.
- Push dispatch: PUSH_DISPATCH_ENABLED=false always disables it and =true always enables it; unset means production only, and never when an emulator host is configured. The emulators do not emulate FCM.
- The message outbox stores one localStorage entry per queued message under secret-santa-message-outbox-v2:*; the v1 key is read-only legacy input. Tabs running an older build must reload before the outbox fixes apply.
- **Anonymity is a trust model, not a hard guarantee.** The Public Feed and Santa/Recipient split hide identities in the UI, but `messages` are readable by any signed-in participant (rules `allow read: if isSignedIn()`), so identities are technically discoverable by a determined participant inspecting raw data. Treat anonymity as social convention enforced by the client.

## Workflows & Guidelines

### 1. Plans (The PLAN.md Rule)
All implementation is driven by a user-approved root `PLAN.md`. Its required sections, who writes and saves it, and the review and approval loop are defined in `AGENTS.md`.

### 2. Strict SDK Separation
The separation between Admin and Client SDKs is strict.
- **Frontend/Hooks:** MUST import from `@/lib/firebase-client.js`.
- **API Routes/Scripts:** MUST import from `@/lib/firebase.js`.
- **Never** mix these imports.

### 3. Known Complexity (Refactoring Targets)
Be extra careful when modifying message routing logic.
- **Legacy vs New:** `src/lib/message-utils.js` contains complex logic to handle both legacy messages (no `conversationId`) and new messages.
- **Consult Tests:** Any change to message logic must be verified with `__tests__/unit/PublicFeed_grouping.test.js`. Plans touching this area list it under Verification; the primary assistant runs it (see `AGENTS.md`).

### 4. Firestore Listener Management (Read Optimization)

The app uses optimized Firestore listeners to minimize reads on the free tier.

**Singleton Pattern for All Messages:**
- `useRealtimeAllMessages()` uses a singleton listener shared across all components
- Only ONE Firestore listener for all messages exists at any time
- Prevents duplicate listeners during React.StrictMode double-mounts

**Listener Tracking (Dev Mode):**
- `src/lib/firestore-listener-tracker.js` provides debugging utilities
- In browser console, use `window.__firestoreDebug.printListenerSummary()` to see active listeners
- All listener creation/destruction is logged with `[Firestore]` prefix

**Client-Side Caching:**
- IndexedDB persistence is enabled via `enableIndexedDbPersistence()`
- Subsequent reads often come from cache (0 Firestore reads)
- Look for "from CACHE" vs "from SERVER" in snapshot logs

**Key Optimizations Applied:**
1. `includeMetadataChanges: false` - Reduces unnecessary snapshot callbacks
2. Singleton pattern for `allMessages` listener - Prevents duplicate reads
3. Refs to track listener state in StrictMode - Prevents recreation on double-mount
4. Memoized params comparison in `useRealtimeUnreadCounts` - Only recreates on real changes

**Expected Read Behavior:**
- Page refresh: ONE initial read of all messages (N reads for N docs)
- Send message: ONE read (only the new message via listener update)
- View message tab: ZERO reads (filtered client-side from cached messages)
