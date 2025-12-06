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
- Each message has `conversationId` (deterministic hash of two user IDs)
- `senderId` and `recipientId` track message direction
- `isSantaAnonymous` boolean controls name display
- Real-time updates via Firestore listeners in `src/hooks/useRealtimeMessages.js`

Key utilities in `src/lib/message-utils.js`:
- `getConversationId(userId1, userId2)`: Generates deterministic conversation ID
- `filterMessages(allMessages, userId, otherId, conversationId)`: Filters messages for a specific chat

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
  id: string,              // UUID
  conversationId: string,  // Hash of two user IDs
  senderId: string,        // UUID
  recipientId: string,     // UUID
  message: string,
  timestamp: Firestore Timestamp,
  isSantaAnonymous: boolean,
  read: boolean
}
```

### API Routes

- **POST /api/init**: Initialize all participants in Firestore from hardcoded list
- **POST /api/admin/assign**: Shuffle and assign Secret Santa pairs (admin only)
- **POST /api/admin/reset**: Delete all data and reset app (admin only)
- **POST /api/dev/seed**: Create seed data for testing

Admin routes check for email `jed.piezas@gmail.com` via Firebase Auth token.

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

- Admin email is hardcoded as `jed.piezas@gmail.com` in multiple places
- The app uses UUID-based user IDs throughout, not Firebase Auth UIDs
- Production requires environment variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- Firestore rules are minimal - tighten for production use

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

To avoid the "Dumb Zone" (context saturation), we strictly follow this 3-phase process for complex features:

### Phase 1: Research (The Truth)
* **Goal:** Understand the *current* state of the codebase relevant to the request.
* **Action:** Read files, check imports, verify assumptions.
* **Output:** `RESEARCH.md` (A summary of relevant file paths, existing function signatures, and "gotchas").
* **Stop:** Do not propose changes yet.

### Phase 2: Plan (The Blueprint)
* **Input:** User Request + `RESEARCH.md`.
* **Goal:** Define *how* we will solve it.
* **Action:** Create a detailed implementation guide.
* **Output:** `PLAN.md`.
    * **Must Include:** Exact file paths, new function signatures (pseudo-code), and test cases.
* **Review:** The user MUST approve `PLAN.md` before coding starts.

### Phase 3: Implement (The Build)
* **Input:** `PLAN.md`.
* **Action:** Write code and run tests.
* **Compaction Rule:** If the session gets too long (e.g., >20 exchanges), summarize progress to `PROGRESS.md`, restart the session, and feed it `PROGRESS.md` to continue.
