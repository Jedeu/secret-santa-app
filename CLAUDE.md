# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm test:unit

# Run integration tests (requires emulators running)
npm test:integration

# Run tests in watch mode
npm test:watch
```

## Firebase Emulator Setup

The app uses Firebase Emulators for local development:
- **Firestore**: Port 8080
- **Auth**: Port 9099
- **UI Dashboard**: Port 4000

Always run `npm run emulators` before starting development. The emulators must be running for both the dev server and integration tests.

## Architecture

### Authentication & User Management

User authentication follows a "handshake" pattern:
1. Users sign in with Google OAuth via Firebase Auth
2. Email is checked against hardcoded participant list in `src/lib/participants.js`
3. If authorized, user document is auto-created in Firestore with UUID-based `id` (not Firebase `uid`)
4. Unauthorized emails get ACCESS_DENIED error

Key file: `src/hooks/useUser.js` implements this handshake logic.

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
- `filterMessages(messages, currentUserId, otherUserId, targetConversationId)`: Filters and time-sorts messages for a specific chat. Dual-routing logic: messages with a `conversationId` must match exactly; legacy messages (no `conversationId`) are routed by their `isSantaMsg` flag when present, otherwise assigned to a single canonical conversation (`santa=min(id)`, `recipient=max(id)`) to avoid duplicate rendering in mutual A↔B cycles

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
{ userId: string, conversationId: string, lastReadAt: Timestamp }
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

### API Routes

Auth conventions: routes verify a Firebase **Bearer ID token** (`Authorization: Bearer <token>`) via the Admin SDK. Admin checks go through `isAdmin(email)` in `src/lib/config.js` (single source of truth — the admin email is no longer duplicated inline). Routes under `/api/dev/*` are hard-disabled outside `NODE_ENV=development`.

- **POST /api/init**: Initialize all participants from the hardcoded list. No auth in development; requires an admin Bearer token in production.
- **POST /api/admin/assign**: Shuffle and assign Secret Santa pairs. Requires admin Bearer token.
- **POST /api/admin/reset**: Delete all data and reset the app. Requires admin Bearer token.
- **POST /api/dev/assign**: Dev-only assignment helper. 403 outside development.
- **POST /api/dev/inject-message**: Dev-only message injection for testing. 403 outside development.
- **POST /api/dev/seed**: Dev-only seed data from the participants list. 403 outside development.
- **POST /api/messages/send**: Send a message. Requires a Bearer token; verifies the sender matches an authorized user, validates length (≤4000), and writes idempotently keyed on `clientMessageId`. Dispatches a fail-open push notification to the recipient.
- **POST /api/push/register**: Register a Web Push subscription for the authenticated user. Requires Bearer token.
- **POST /api/push/unregister**: Remove a Web Push subscription. Requires Bearer token.

### Testing Strategy

Tests are split into unit and integration:
- **Unit tests** (`__tests__/unit/`): No external dependencies, use mocks
- **Integration tests** (`__tests__/integration/`): Require Firebase Emulators running

Integration tests are excluded from default `npm test` runs. Use `npm test:integration` explicitly.

## Key Files

- `src/app/page.js`: Main app UI with tabbed interface (Recipient/Santa/Public Feed)
- `src/components/Chat.js`: Chat component with emoji picker and markdown support
- `src/components/PublicFeed.js`: Public message feed grouped by conversation
- `src/lib/firestore.js`: Firestore operations (ensureAllParticipants, assignSecretSantas, etc.)
- `firebase.json`: Emulator configuration
- `firestore.rules`: Security rules (currently permissive for authenticated users)

## Important Notes

- Admin email lives in one place: `ADMIN_EMAILS` in `src/lib/config.js` (checked via `isAdmin()`). Update it there.
- The app uses UUID-based user IDs throughout, not Firebase Auth UIDs. A user's Firestore doc id **is** their UUID (`users/{uuid}`), and message `fromId`/`toId` reference those UUIDs.
- Production requires environment variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (server Admin SDK), plus the `NEXT_PUBLIC_FIREBASE_*` client config including `NEXT_PUBLIC_FIREBASE_VAPID_KEY`. Push notifications go through Firebase Cloud Messaging (Admin SDK `messaging`), so they reuse the server Admin credentials — there is no separate web-push private key.
- **Firestore rules are hardened** (`firestore.rules`), not minimal:
  - Per-collection field allowlists (`keys().hasOnly([...])`) on every create/update.
  - Message create verifies sender identity (`authMatchesUser(fromId)`), requires the recipient to exist, and enforces the 1–4000 char content bound at the DB layer.
  - `lastRead` writes are owner-scoped by doc-id prefix; reads are owner-only except a deliberate carve-out that lets DM read-receipt markers be cross-read (public-feed markers stay owner-only).
  - `typing` and `reactions` enforce deterministic doc-id shapes and owner identity.
  - `allow delete: if false` (and no `update`) across messages/users/lastRead; a catch-all denies every other collection.
- **Anonymity is a trust model, not a hard guarantee.** The Public Feed and Santa/Recipient split hide identities in the UI, but `messages` are readable by any signed-in participant (rules `allow read: if isSignedIn()`), so identities are technically discoverable by a determined participant inspecting raw data. Treat anonymity as social convention enforced by the client.

## Workflows & Guidelines

### 1. State Persistence (The PLAN.md Rule)
For any task involving more than 2 files, **persist your plan to disk**.
- **Why:** To enable context clearing and "Architect -> Builder" handoffs.
- **How:** Use your internal planning capabilities to generate a `PLAN.md` first.
- **Content:**
  - **Goal:** One-line summary.
  - **Proposed Changes:** List specific files (e.g., `src/lib/message-utils.js`) and the changes intended.
  - **Verification:** The specific test command (`npm run test:integration`) to run afterwards.

### 2. Strict SDK Separation
The separation between Admin and Client SDKs is strict.
- **Frontend/Hooks:** MUST import from `@/lib/firebase-client.js`.
- **API Routes/Scripts:** MUST import from `@/lib/firebase.js`.
- **Never** mix these imports.

### 3. Known Complexity (Refactoring Targets)
Be extra careful when modifying message routing logic.
- **Legacy vs New:** `src/lib/message-utils.js` contains complex logic to handle both legacy messages (no `conversationId`) and new messages.
- **Consult Tests:** Always run `__tests__/unit/PublicFeed_grouping.test.js` after touching message logic.

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

## The RPI Workflow (Research -> Plan -> Implement)

To avoid the "Dumb Zone" (context saturation), we strictly follow this 3-phase process using our specialized agents.

### Phase 1: Research (The Truth)
* **Agent:** `codebase-research-analyst`
* **Goal:** Understand the *current* state of the codebase relevant to the request.
* **Action:** Read files, check imports, verify assumptions against ground truth (code > docs).
* **Output:** `RESEARCH.md` (A summary of relevant file paths, existing function signatures, and "gotchas").

### Phase 2: Plan (The Contract)
* **Agent:** `architect-planner`
* **Input:** User Request + `RESEARCH.md`.
* **Goal:** Define *how* we will solve it without ambiguity.
* **Action:** Create a detailed implementation guide defining **Code Contracts**.
* **Output:** `PLAN.md` (Must include exact file paths, new function signatures, and test cases).
* **Review:** The user MUST approve `PLAN.md` before coding starts.

### Phase 3: Implement (The Build)
* **Agent:** `phase3-implementer`
* **Input:** `PLAN.md` (and `PROGRESS.md` if resuming).
* **Action:** Write code and run tests (`test-runner`).
* **Compaction Rule:** If the session gets too long (e.g., >20 exchanges) or you receive warnings of hitting >90% usage limits, summarize progress to `PROGRESS.md` so that another phase3-implementer agent can pick up where you left off in a new session
