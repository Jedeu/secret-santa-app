# PLAN: Bug-Sweep Remediation (BUG_REPORT.md #1–#22 + development-push risk)

**Status: APPROVED** — revision 5; primary adversarial review complete, 2026-11-10. The user directed Fable to finish the final race and then have Opus implement the plan, subsequently specifying **Opus 5.5 at high effort**. Approval covers all 22 bugs, the conditional development-FCM safeguard, and this plan's recommended choices D1=A and D2–D7 as written. No production access, deployment, live FCM dispatch, data repair, or dependencies are authorized. Git publication is authorized separately below.

**Primary review evidence:** The remaining matching-state race is resolved by an unconditional conditional-register/fresh-revision fence on every successful reconciliation, with deterministic before-server-commit tests in both directions and no dependence on the older tab. Reset/admission, queue migration, markers, cleanup, SDK boundaries, manifest and verification were adversarially reviewed. All 24 create, 74 modify and 1 primary-delete paths, coverage of IDs 1–22 plus Risk, absence of personal emails, protected-file hashes and whitespace checks were validated. Baseline lint and 184 unit tests passed in a disposable copy; these are NOT verification of the not-yet-implemented fixes. The planner ran no checks. Production account/provider confirmation remains an unauthorized rollout prerequisite.

**Implementation checkpoint (2026-11-10):** Approved code scope implemented by Opus 5.5 HIGH, including the primary's in-scope marker/lint corrections and primary-owned route deletion. Primary automated checks passed: lint, 422 unit/API tests, 68 emulator integration tests, build/worker assertions and 48 Chromium E2E tests. Scope, whitespace and protected hashes passed. **Additional local browser checks passed:** shared profile across tabs, stable global-listener count across assignment, cross-browser read-marker propagation, open-client reset recovery, and recovery from a forced failure after profile deletion. The owner separately confirmed that the local Google popup closes and the chat loads in a normal browser. Earlier headless relay/tooling failures remain recorded as failed attempts, not passes; this does not verify production or real FCM. Browser typing-cleanup denials/cache warnings remain recorded, not hidden. See `RESEARCH.md` for evidence and limitations. No production or real FCM validation has occurred.

**Gates (separate, in order):** primary final review → user approval recorded by the primary → implementer `claude-opus-5-5` at HIGH effort (latest user direction) edits only manifest files → primary diff review → primary-executed checks. No production access, deploy, data migration, dependency change or real FCM dispatch is authorized.

## Git publication authorization (2026-11-10)

After local verification, the user requested a pushed draft PR for review. This authorizes the primary to commit the approved task changes plus `BUG_REPORT.md`, `PLAN.md` and `RESEARCH.md`, push a new review branch, and open a draft PR targeting `main`. It does not authorize deployment, a direct push to `main`, force-pushing, or including the pre-existing local settings/generated workers. The review branch starts from current `origin/main`, whose tree is identical to the validated implementation base (the earlier workflow change was squash-merged).

## Goal
Fix all 22 audited defects and the dev-FCM risk through six shared-root changes, preserving existing UUIDs, messages, markers and queued drafts.

## Data model
Server-only collections (catch-all rule denies clients):
- `system/lifecycle`: `{ epoch: number ≥ 1, state: 'active'|'resetting', resetId: string|null, resetStartedAt: string|null, updatedAt: string }`
- `authIdentities/{authUid}`: `{ uid, email, userId, epoch, createdAt, updatedAt }`
- `participantIndex/{emailKey}`: `{ email, userId, epoch, createdAt }`, `emailKey = email.trim().toLowerCase()`
- `pushTokens/{sha256(token)}` gains `authUid`, `revision` (random id replaced on every mutation; absent ≡ `null`), `epoch`, optional `invalid: true`

Unchanged: `users`, `messages`. `lastRead.lastReadAt` stays a `Timestamp` meaning "latest observed message timestamp".

## Exact manifest

**Create — source**
- `src/lib/participant-admission.js` — Admin (`@/lib/firebase`); must not import `@/lib/firestore`
- `src/app/api/auth/bootstrap/route.js` — Admin
- `src/app/api/push/status/route.js` — Admin
- `src/context/UserContext.js` — Client (`@/lib/firebase-client`)
- `src/lib/sign-out.js` — Client
- `src/hooks/useAdminReset.js` — Client
- `scripts/lib/emulator-firestore.js` — Admin, CommonJS, `require('firebase-admin/*')` only; no `@/` or `src/` imports

**Create — tests:** `__tests__/lib/participant_admission.test.js`, `__tests__/api/auth_bootstrap_api.test.js`, `__tests__/api/push_status_api.test.js`, `__tests__/api/dev_assign_api.test.js`, `__tests__/integration/participant-admission.test.js`, `__tests__/integration/reset-fencing.test.js`, `__tests__/integration/firestore-rules-admission.test.js`, `__tests__/integration/push-registration.test.js`, `__tests__/unit/firebase_client_config.test.js`, `__tests__/unit/worker_push_display.test.js`, `__tests__/unit/ChatTabs_draft_isolation.test.js`, `__tests__/unit/PublicFeed_read_state.test.js`, `__tests__/unit/useAdminReset.test.js`, `__tests__/unit/emulator_scripts_config.test.js`, `__tests__/unit/message_outbox_cross_realm.test.js`, `e2e/admission-and-reset.spec.ts`, `e2e/outbox-cross-tab.spec.ts`.

**Modify — source:** `firestore.rules`; `worker/index.js`; `src/lib/{firestore,firebase-client,message-utils,message-outbox,lastReadClient,push-client,push-server}.js`; `src/hooks/{useUser,useRealtimeMessages}.js`; `src/context/RealtimeMessagesContext.js`; `src/components/{ClientProviders,AuthGuard,AdminPanel,RecipientSelector,ChatTabs,Chat,PublicFeed,MessageOutboxRuntime,PushNotificationsRuntime,PushNotificationsControl,NotificationSoundRuntime}.js`; `src/app/page.js`; `src/app/api/{messages/send,push/register,push/unregister,admin/reset,init,dev/seed,dev/inject-message,dev/assign}/route.js`; `scripts/{wipe_db,check_all_data,check_messages,test_message_routing}.js`.

**Modify — tests:** `__tests__/setup.js`; `__tests__/integration/{helpers/firestore-rules-test-utils.js,firestore-rules-lastRead.test.js,firestore-rules-reactions.test.js,README.md}`; `__tests__/lib/{firestore,push_server}.test.js`; `__tests__/api/{admin_reset_enhanced,send_message_api,push_register_api,push_unregister_api}.test.js`; `__tests__/context/RealtimeMessagesContext.test.js`; `__tests__/unit/{useUser_realtime,message_outbox,outbox_retry_delivery,MessageOutboxRuntime,Chat_outbox,Chat_unread,lastReadClient,lastReadClient-normalization,unread_badge_clearing,unread_logic,realtime_hooks,PublicFeed_lastViewed_sync,message_routing,NotificationSoundRuntime,push_client,PushNotificationsControl,PushNotificationsRuntime,admin_ui,app_flows,RecipientSelector,participants}.test.js`; `e2e/{mobile-layout,unread-badge}.spec.ts`. (`useUser_realtime` is rewritten in place against `UserProvider`; `PublicFeed_lastViewed_sync` keeps its filename.)

**Modify — docs:** `CLAUDE.md`, `README.md`, `plans/05-admin-assign-decision.md`.

**Delete (primary-executed, only if D1 = A):** `src/app/api/admin/assign/route.js`. If D1 = C, it moves to Modify and its `getAllUsers` + `batchUpdateUsers` pair becomes the same `assignUsersInTransaction` call as the dev route.

**Inspected, expected unaffected (primary confirms by running):** `auth_timing`, `read-receipts`, `Sidebar`, `PublicFeed_grouping`, `firestore_participants`, `init`, `firestore-rules-typing`, `layout_metadata`, `typing-client`, `reactions-client`, `ReactionChips`, `next_config_pwa`, `package_scripts_build`, `pwa_manifest_assets` tests and the remaining e2e specs.

**Not in this change:** `docs/runtime-verification.md` (unread; may be stale afterwards), `scripts/seed_users.js`, `src/components/Sidebar.js`, `src/lib/firebase.js`, `package.json` and lockfile, CI, `.claude/settings*.json`, generated `public/sw.js`, `public/workbox-*.js`, `public/worker-*.js`.

## Phase 1 — Admission, lifecycle, reset, rules (#1 #6 #8 #4)

### `src/lib/participant-admission.js`
```js
export class AdmissionError extends Error {}           // fields: code, status
export function toTitleCase(name): string
export function normalizeEmail(email): string
export function requiresVerifiedEmail(): boolean       // process.env.NODE_ENV !== 'development'
export function getBearerToken(request): string|null
export async function verifyRequestToken(request): Promise<DecodedIdToken>
export function assertAdmissibleToken(decoded): { uid, email, name }
export async function admitParticipant(decoded): Promise<{ user, created: boolean }>
export async function resolveParticipant(decoded, { verifyIndex = false } = {}): Promise<{ uid, email, user, epoch }>
export async function runFencedTransaction(decoded, work): Promise<any>
export async function ensureParticipantProfiles(participants, { resetId = null } = {}): Promise<{ created, linked, existing }>
export async function beginReset(): Promise<{ resetId, epoch }>
export async function assertResetOwner(tx, resetId): Promise<void>
export async function assertLifecycleActive(tx): Promise<{ epoch }>
export async function completeReset(resetId): Promise<void>
export function admissionErrorResponse(error): NextResponse|null
```
Codes: `UNAUTHENTICATED` 401; `ACCESS_DENIED`, `EMAIL_NOT_VERIFIED` 403; `PROFILE_CONFLICT`, `RESET_SUPERSEDED` 409; `RESET_IN_PROGRESS`, `SERVICE_UNAVAILABLE` 503. `PROFILE_CONFLICT`'s message is generic (no counts or identifiers).

- **`assertAdmissibleToken`** (pure, every path): requires `uid`; email passing `normalizeEmail` (non-empty, no `/`); `getParticipantName(email)` non-null; `email_verified === true` when `requiresVerifiedEmail()`.
- **`assertLifecycleActive(tx)`**: missing doc → `SERVICE_UNAVAILABLE`; not `active` → `RESET_IN_PROGRESS`.
- **Validity predicate** (used by `resolveParticipant` and `runFencedTransaction`): lifecycle exists and `active` (else `RESET_IN_PROGRESS`); identity exists with matching `uid`, `email`, `epoch === lifecycle.epoch`; `users/{identity.userId}` exists with `normalizeEmail(user.email) === email`. Otherwise "admission required".
- **`admitParticipant`** — one transaction, reads first:
  1. `tx.getAll(lifecycle, index, identity)`. Lifecycle missing → created `{ epoch: 1, state: 'active', resetId: null, resetStartedAt: null }`; `resetting` → `RESET_IN_PROGRESS`.
  2. Index exists: `index.epoch !== epoch`, user missing, or stored email not exactly canonical → `PROFILE_CONFLICT`.
  3. Index missing: `tx.get(usersCollection)` filtered by `normalizeEmail(u.email) === email`.
     - Zero matches → create `{ id: uuidv4(), name: toTitleCase(name), email, oauthId: uid, image: decoded.picture || null, recipientId: null, gifterId: null }`.
     - Exactly one with `u.email === email` and `doc.id === (u.id ?? doc.id)` → link it, keeping its UUID.
     - Anything else → `PROFILE_CONFLICT`, no writes.
  4. Writes: lifecycle if missing; `tx.create(users/…)` if new; `tx.create(index, { email, userId, epoch, createdAt })` if new; `tx.set(identity, { uid, email, userId, epoch, createdAt: previousIdentity?.createdAt ?? now, updatedAt: now })`. Existing `users` docs are never modified.
- **`resolveParticipant`**: non-transactional `getAll(lifecycle, identity)` + user doc (+ index when `verifyIndex`: `index.userId === identity.userId`, `index.epoch === epoch`). Valid → return; else `admitParticipant`.
- **`runFencedTransaction(decoded, work)`**: `assertAdmissibleToken`; transaction reads lifecycle, identity, user, applies the predicate, calls `work(tx, { uid, email, epoch, user })` (reads before writes; no external side effects). "Admission required" on the first attempt → `admitParticipant`, retry once; second failure → `SERVICE_UNAVAILABLE`.
- **`ensureParticipantProfiles`**: one transaction per participant (steps 1–4 without identity). `resetId: null` requires `active`; a `resetId` requires `resetting` with that id. Created profiles have `oauthId: null, image: null`. After all are processed, any conflict throws `PROFILE_CONFLICT` with `error.conflicts = <count>`.

Stale requests are rejected by their own precondition, since re-admission can make the caller valid again:

| Mutation | Commit-time checks | Stale-request precondition |
|---|---|---|
| Admission, seed, init | lifecycle `active` | none |
| Send | lifecycle, identity, reciprocal assignment | `senderUserId` (always sent by the new outbox); old clients: recipient must exist and be reciprocally assigned |
| Push register / unregister | lifecycle, identity | `expectedEpoch` + `expectedRevision`, both required |
| Invalid-token cleanup | lifecycle `active` | dispatch's captured `epoch` and each row's captured `revision` |
| Dev assign / dev inject | lifecycle (+ users read in the same transaction / reciprocal assignment) | none |
| Reset steps | `resetId` | none |

**Reset protocol**
- `beginReset()`: transaction → `{ epoch: (epoch ?? 0) + 1, state: 'resetting', resetId: uuidv4(), resetStartedAt: now }`. Always succeeds; newest wins.
- Delete: per batch of ≤ 400, a transaction doing `assertResetOwner` then `tx.delete` of refs from `collection(name).limit(400).get()`, repeated until empty.
- Reseed: `ensureParticipantProfiles(participants, { resetId })`.
- `completeReset(resetId)`: `assertResetOwner` → `{ state: 'active', resetId: null, resetStartedAt: null }`.
- `assertResetOwner` throws `RESET_SUPERSEDED` unless `resetting` with a matching `resetId`.

Outcomes:
- Delayed send → 503 during reset; afterwards 403 `SENDER_MISMATCH` (new client) or 400 (old); nothing written.
- Delayed push register → 409.
- Late invalid-token response → nothing written.
- In-flight bootstrap → commits before `beginReset` (then deleted) or 503 and retried.
- Second reset → runs fully; the first fails `RESET_SUPERSEDED`.
- Crash → stays `resetting` (admissions 503, rules deny all); recovery is re-running reset.
- Seed/init/dev assign/dev inject during reset → 503.

**Outside DB fencing:** a notification already handed to FCM cannot be retracted (generic text and conversation tag only).

### `src/lib/firestore.js` (Admin)
```js
export const APP_COLLECTIONS = ['authIdentities','participantIndex','users','messages','lastRead','typing','reactions','pushTokens'];
export async function ensureAllParticipants(participants)
export async function resetDatabase({ afterBegin } = {})
export async function resetAndReseedParticipants(participants, { afterBegin, afterDelete, afterReseed } = {})
export async function assignUsersInTransaction(buildUpdates): Promise<{ usersFound, updated }>
```
- `toTitleCase` imported from `./participant-admission`.
- No `finally` in either reset function; on error they rethrow and state stays `resetting`.
- Hooks are awaited at the named points, default to no-ops, and are never passed by routes (test barriers only).
- `assignUsersInTransaction`: one transaction — `assertLifecycleActive(tx)`, `tx.get(usersCollection)`, `buildUpdates(users)`; `null` → no writes; else `tx.update(ref, { recipientId, gifterId })`.
- `batchUpdateUsers` removed; other exports unchanged.

### Routes (Admin)
- `api/auth/bootstrap` POST: `verifyRequestToken` → `resolveParticipant(decoded, { verifyIndex: true })` → 200 `{ success: true, user }`; errors via `admissionErrorResponse`; else 500 `{ code: 'INTERNAL' }`.
- `api/admin/reset`: after the existing admin gate (no admission needed), `resetAndReseedParticipants(PARTICIPANTS)`; admission errors mapped; others 500 `{ error: 'Reset did not complete. Run Reset again.' }`.
- `api/init`, `api/dev/seed`: map admission errors; `api/init` also returns `{ code: 'PROFILE_CONFLICT', conflicts: <count> }`.
- `api/dev/assign`: existing shuffle moves into local `buildUpdates(users)` (returns `null` for < 2 users); calls `assignUsersInTransaction`; `updated === 0` → existing 400; admission errors mapped.

### `firestore.rules` — exact replacement
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function identityPath() { return /databases/$(database)/documents/authIdentities/$(request.auth.uid); }
    function lifecyclePath() { return /databases/$(database)/documents/system/lifecycle; }
    function userPath(userId) { return /databases/$(database)/documents/users/$(userId); }
    function isParticipant() {
      return request.auth != null
        && exists(identityPath())
        && get(lifecyclePath()).data.state == 'active'
        && get(identityPath()).data.epoch == get(lifecyclePath()).data.epoch;
    }
    function myUserId() { return get(identityPath()).data.userId; }
    function authMatchesUser(userId) {
      return isParticipant() && myUserId() == userId && exists(userPath(userId));
    }
    function onlyChanges(fields) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(fields);
    }
    function isAllowedSelfRecipientSelection(userId) {
      return authMatchesUser(userId) && onlyChanges(['recipientId'])
        && resource.data.recipientId == null
        && request.resource.data.recipientId is string
        && request.resource.data.recipientId != userId
        && getAfter(userPath(request.resource.data.recipientId)).data.gifterId == userId;
    }
    function isAllowedRecipientClaimUpdate(recipientUserId) {
      return onlyChanges(['gifterId'])
        && resource.data.gifterId == null
        && request.resource.data.gifterId is string
        && request.resource.data.gifterId != recipientUserId
        && authMatchesUser(request.resource.data.gifterId)
        && getAfter(userPath(request.resource.data.gifterId)).data.recipientId == recipientUserId;
    }
    match /users/{userId} {
      allow read: if isParticipant();
      allow create, delete: if false;
      allow update: if isAllowedSelfRecipientSelection(userId) || isAllowedRecipientClaimUpdate(userId);
    }
    match /messages/{messageId} {
      allow read: if isParticipant();
      allow create, update, delete: if false;
    }
    function ownsLastReadId(lastReadId) {
      return isParticipant() && lastReadId.matches('^' + myUserId() + '_.+$');
    }
    function isAllowedLastReadWrite(lastReadId) {
      return request.resource.data.keys().hasOnly(['userId','conversationId','lastReadAt'])
        && request.resource.data.userId is string
        && request.resource.data.conversationId is string
        && request.resource.data.lastReadAt is timestamp
        && lastReadId == request.resource.data.userId + '_' + request.resource.data.conversationId
        && request.resource.data.lastReadAt <= request.time + duration.value(5, 'm')
        && authMatchesUser(request.resource.data.userId);
    }
    function isMonotonicLastRead() {
      return !(resource.data.lastReadAt is timestamp)
        || request.resource.data.lastReadAt >= resource.data.lastReadAt;
    }
    match /lastRead/{lastReadId} {
      allow read: if ownsLastReadId(lastReadId)
        || (isParticipant() && lastReadId.matches('^[^_]+_.+$')
            && !lastReadId.matches('^[^_]+_publicFeed_.*$'));
      allow create: if isAllowedLastReadWrite(lastReadId);
      allow update: if isAllowedLastReadWrite(lastReadId) && isMonotonicLastRead();
      allow delete: if false;
    }
    // typing and reactions: bodies unchanged except every isSignedIn() becomes isParticipant()
    match /{document=**} { allow read, write: if false; }
  }
}
```
Own-marker reads are path-based (a missing own `publicFeed_*` doc is readable; another user's stays denied). `RecipientSelector`'s existing transaction satisfies these rules unchanged.

## Phase 2 — Client auth/profile owner (#6 #7 #8, #17 reset)

### `src/context/UserContext.js` (client)
```js
export function UserProvider({ children })
export function useUserContext(): { user, authUid, authEmail, loading, error, notice, refreshUser }
```
Three separate lifecycles:
- **Auth generation** — changes only on uid change, sign-out, unmount. On change, synchronously in the auth callback: clear retry timers; call `cancelOutboxDrains()`, `cancelPushOperations()`, `resetLastReadState()`; set `{ status: 'loading'|'signed-out', user: null, authUid: null, error: null, notice: null }`. Same-uid callbacks on a ready state are ignored.
- **Request sequence** — incremented per bootstrap request; a response or retry applies only if the auth generation is unchanged and its sequence is latest.
- **Profile subscription** — effect keyed on `[authUid, user?.id]` with an effect-local `active` flag; a refresh returning the same profile id does not touch it.

Bootstrap outcomes (from `loading` / from `ready` on refresh):
- 200 → `ready` / replace `user`.
- 401 → one retry with `getIdToken(true)`.
- 503 `RESET_IN_PROGRESS` → `loading`, `notice: 'RESET_IN_PROGRESS'`, retry 1s, 2s, 4s, then every 8s (refresh drops to `loading` with `user: null` first).
- Network / other 5xx → same delays, 5 attempts, then `error { code: 'BOOTSTRAP_FAILED' }` / keep `ready`, log only.
- 403 / 409 → `error { code, message }`, `user: null`, `authUid: null`.
- Non-participant email → `ACCESS_DENIED` (existing message), no request. `refreshUser()` from `error` sets `loading` and bootstraps.

Profile listener: `onSnapshot(doc(firestore,'users',id), { includeMetadataChanges: true }, next, error)`; every branch checks `active`.
- Exists → update `user` only when `recipientId` or `gifterId` changed.
- Missing with `metadata.fromCache === true` → ignored.
- Missing from server, or `permission-denied` → profile loss: run the three cancels, set `loading` with `user: null`, bootstrap.
- Other errors → `console.error('[useUser] Error listening to user document:', error)`.

The `window.__e2eUserData__` effect and the uninitialized-client microtask path are kept; no client `users` query or `setDoc` remains.

### Other Phase 2 files
- `src/hooks/useUser.js`: `export function useUser() { return useUserContext(); }`.
- `ClientProviders.js`: `<UserProvider><RealtimeMessagesProvider>…</RealtimeMessagesProvider></UserProvider>`.
- `RealtimeMessagesContext.js`:
  - `userId = user?.id ?? null`; messages effect deps `[userId, authLoading, messagesRetry]`, reactions `[userId, authLoading, reactionsRetry]`.
  - Each effect owns `cancelled` and `retryTimer` (cleanup sets and clears); the `permission-denied` 2s retry is scheduled only when not cancelled.
- `AuthGuard.js`:
  - Props `notice`, `authEmail`, `onRetry`.
  - Loading branch with `notice === 'RESET_IN_PROGRESS'` shows "A reset is in progress. If this persists, an admin can run Reset again." and `<AdminPanel userEmail={authEmail} onResetComplete={onRetry} />`.
  - After ACCESS_DENIED, a generic error card ("Try again", "Sign out") for any other `authError`; sign-outs use `signOutCurrentUser`.
- `src/lib/sign-out.js`: `export async function signOutCurrentUser(): Promise<void>`:
  1. `await Promise.race([Promise.allSettled([flushPendingWrites(), releasePushRegistration({ timeoutMs: 3000 })]), sleep(3000)])`;
  2. `cancelOutboxDrains(); cancelPushOperations(); resetLastReadState();`
  3. `await signOut(clientAuth)`.
- `src/hooks/useAdminReset.js`: `export function useAdminReset({ onComplete } = {}): () => Promise<void>` — confirm text, token, POST, toasts (server `error` text on failure), `onComplete()`, moved from `AdminPanel.handleReset`.
- `AdminPanel.js` (D1 = A): props `{ userEmail, onResetComplete }`; compact button only, wired to the hook.
- `RecipientSelector.js`: uses `useAdminReset({ onComplete: onReset })` and `signOutCurrentUser`.
- `page.js`:
  - Reads `authUid`, `authEmail`, `notice`; `Sidebar onReset={useAdminReset({ onComplete: refreshUser })}`; sign-outs via the helper.
  - Passes `notice`, `authEmail`, `onRetry={refreshUser}` to `AuthGuard`.
  - Passes `authUid` to `MessageOutboxRuntime`, `PushNotificationsRuntime`, `ChatTabs`, both `PushNotificationsControl`s.
  - Passes memoized `buildViewerAssignmentMap(currentUser)` as the fifth `filterMessages` argument.

## Phase 3 — Routing and atomic send (#9 #14 #15)

### `src/lib/message-utils.js` (pure) — additions
```js
export function buildAssignmentMap(users): Map<string,string>          // santaId → recipientId
export function buildViewerAssignmentMap(user): Map<string,string>     // { id → recipientId, gifterId → id }
export function resolveMessageConversation(message, assignments): {
  conversationId, santaId, recipientId, isSantaMsg, isAmbiguous,
  source: 'explicit'|'legacy-flag'|'assignment'|'canonical'|'unroutable' }
export function resolveAuthorizedConversationId(sender, recipient, requestedConversationId):
  { conversationId } | { error: 'NOT_ASSIGNED'|'INVALID_CONVERSATION'|'AMBIGUOUS_CONVERSATION' }
export function matchesStoredMessage(existing, request): boolean
export function getLatestMessageTimestamp(messages): string|null
```
- **Resolver precedence:**
  1. Missing/equal endpoints → `unroutable` (`'legacy_' + (id ?? 'unknown')`, ambiguous).
  2. Parseable `conversationId` whose parties equal the endpoints as a set → `explicit`; parseable but mismatched → `unroutable`.
  3. Boolean `isSantaMsg` → `legacy-flag`.
  4. Exactly one of `assignments.get(fromId) === toId` / `assignments.get(toId) === fromId` → `assignment`.
  5. Both or neither → `canonical` (smaller id is Santa; ambiguous; `isSantaMsg: false`).

  Absent or unparseable `conversationId` falls to 3–5.
- `filterMessages(messages, currentUserId, otherUserId, targetConversationId, assignments = null)`: endpoint check, resolver match, time sort; `null` keeps today's behaviour.
- **`resolveAuthorizedConversationId`:** candidates `santa_S_recipient_R` when `sender.recipientId === recipient.id && recipient.gifterId === sender.id`, and `santa_R_recipient_S` when `sender.gifterId === recipient.id && recipient.recipientId === sender.id`. None → `NOT_ASSIGNED`; requested not a candidate → `INVALID_CONVERSATION`; none requested → the single candidate, or `AMBIGUOUS_CONVERSATION` for two.
- **`matchesStoredMessage`** (single matcher; `request = { id, fromId, toId, content, clientMessageId, clientCreatedAt, requestedConversationId }`): `id`, `fromId`, `toId`, `content` equal; `clientMessageId`, `clientCreatedAt` equal after null-normalizing; `requestedConversationId` null or equal to `existing.conversationId`.

### `src/app/api/messages/send/route.js` (Admin)
Body `{ toId, content, conversationId?, clientMessageId?, clientCreatedAt?, senderUserId? }`.
1. Service check (503); `verifyRequestToken`; existing shape validation.
2. `runFencedTransaction(decoded, work)` with `work(tx, { user: sender })`:
   1. `tx.getAll(recipientRef, messageRef)` (message id = `clientMessageId` or an outside-generated `uuidv4()`);
   2. `senderUserId` present and ≠ `sender.id` → 403 `SENDER_MISMATCH`;
   3. stored message exists → matcher true → `{ kind: 'replayed', message }`, false → 409;
   4. recipient missing → 400;
   5. `resolveAuthorizedConversationId` error → 400 `{ error: 'Invalid conversation for this recipient', code }`;
   6. `tx.create(messageRef, { id, fromId, toId, content, timestamp, conversationId, clientMessageId?, clientCreatedAt? })` → `{ kind: 'created', message }`.
3. The existing three-attempt transient retry wraps the transaction; typed route errors and `AdmissionError`s are not retried.
4. Push is dispatched after the transaction, only for `created`.

`writeMessageWithIdempotency` and `isImmutableMessageMatch` are removed. `senderUserId` is optional for old clients; the new outbox always sends it.

### Paths affected by denying direct message creates
- Client: none.
- `api/dev/inject-message`: one transaction with `assertLifecycleActive(tx)` and both user docs; requires `resolveAuthorizedConversationId(from, to, 'santa_' + fromId + '_recipient_' + toId)` (else 400); stores schema fields only (`displayName` accepted, not stored).
- `scripts/test_message_routing.js`: verifies the same reciprocal assignment before writing; exits 1 otherwise.
- `e2e/unread-badge.spec.ts` injects from the user's `gifterId` (valid).
- `firestore-rules-reactions.test.js` fixture `isSantaMsg` becomes `true`.
- Seed/init never write messages.

### Unread and feed
- `useRealtimeMessages.js`: `useRealtimeUnreadCounts` counts a message when `toId === userId`, `fromId` is the partner, the resolver (viewer map) yields that tab's conversation, and its timestamp is after the cached marker. The prime-fetch effect is replaced by `subscribeToLastRead` per non-null own conversation (#13); the event-bus subscription stays.
- `PublicFeed.js` (routing): local legacy helpers removed; uses `buildAssignmentMap(allUsers)` + the resolver.

## Phase 4 — Outbox (#2 #3)

### `src/lib/message-outbox.js` (client)
```js
export const MESSAGE_OUTBOX_STORAGE_KEY = 'secret-santa-message-outbox-v1';     // read-only import source
export const OUTBOX_ITEM_PREFIX  = 'secret-santa-message-outbox-v2:item:';
export const OUTBOX_STATE_PREFIX = 'secret-santa-message-outbox-v2:state:';
export const OUTBOX_DONE_PREFIX  = 'secret-santa-message-outbox-v2:done:';
export function subscribeOutbox(callback): () => void
export function enqueueMessage({ ownerUid, fromUserId, toId, conversationId = null, content }): item   // sync
export function retryOutboxMessage({ fromUserId, clientMessageId }): boolean                          // sync
export function getConversationOutboxMessages({ fromUserId, conversationId }): item[]                 // sync
export function clearDeliveredOrExpired({ fromUserId = null } = {}): number                           // sync
export async function drainOutboxForUser({ ownerUid, fromUserId, fetchImpl = fetch } = {}): Promise<{ delivered, retried, failed, skipped }>
export function cancelOutboxDrains(): void
```
- **Keys** (every operation is a single-key `setItem`/`removeItem`):
  - `item:{id}` = `{ clientMessageId, ownerUid|null, fromUserId, toId, conversationId, content, createdAt }` — written once, never rewritten.
  - `done:{id}` = ISO `deliveredAt` — written on any 2xx.
  - `state:{id}` = `{ attemptCount, nextAttemptAt, status: 'pending'|'failed', lastError }` — last writer wins; absent ≡ pending, zero attempts.
- **Live** = payload exists, no tombstone, not expired. **Delivered:** write the tombstone, then remove payload and state. A late failure can only write `state:{id}`, which is ignored without a live payload.
- `enqueueMessage` returns after its `setItem`; throws on quota/validation error.
- **v1 import** (start of every read, enqueue, drain), in array order. Skip an entry when:
  - it lacks `clientMessageId`, `fromUserId`, `toId`, `content` or a valid `createdAt`;
  - it is expired or `status === 'delivered'`;
  - a tombstone exists;
  - a payload already exists (never overwritten, even if content differs; duplicate ids inside v1 are skipped the same way).

  Otherwise write the payload with `ownerUid: null` and the state key if absent. The v1 key is never written or removed; a skipped count may be logged, never content.
- **Cutover boundary:** old-code tabs still overwrite the shared v1 array (audit #2 itself). The fix is in effect once every open tab has reloaded; v1 is preserved only for import.
- **GC** (`clearDeliveredOrExpired`): removes payload+state for tombstoned/expired items matching the filter (count returned); state keys with no payload; tombstones older than seven days with no payload.
- **Eligibility:** `item.fromUserId === fromUserId && (item.ownerUid === ownerUid || item.ownerUid === null)`; legacy items are never re-stamped.
- **`drainOutboxForUser`:**
  - Returns zeros unless `ownerUid`, `fromUserId`, and `clientAuth.currentUser?.uid === ownerUid`.
  - Captures `authUser` and `drainGeneration`; tokens only from `authUser.getIdToken(force)`.
  - `isCurrent()` (generation unchanged and uid matches) is checked before each item, after each token await, after each fetch.
  - A 2xx marks delivered regardless of identity; other outcomes write state only when current, else the loop stops.
  - Body adds `senderUserId: item.fromUserId`; 30s abort per fetch treated as a network error; the 401 path refreshes once on the captured user.
  - A call during an active drain sets one follow-up pass and returns the active promise.
  - No cross-tab lock (the server commits duplicates once).
- Subscribers also fire on `storage` events for the v1 key and the three prefixes.

### Outbox consumers
- `MessageOutboxRuntime.js`: props `{ currentUser, authUid }`; no-op without both; drains `{ ownerUid: authUid, fromUserId }`; deps `[currentUser?.id, authUid]`; cleanup `cancelOutboxDrains()`.
- `ChatTabs.js`: prop `authUid` to both chats; `key={'recipient:' + recipientConversationId}` / `key={'santa:' + santaConversationId}` on `Chat` (#16); `key={currentUser?.id}` on `PublicFeed`.
- `Chat.js`: prop `authUid`; `enqueueMessage({ ownerUid: authUid, … })`; both drain calls pass `ownerUid`.

## Phase 5 — Read boundaries and feed (#12 #13 #18 #19)

### `src/lib/lastReadClient.js` (client: `firestore`, `clientAuth`, `Timestamp`)
```js
export async function getLastReadTimestamp(userId, conversationId): Promise<string>
export function updateLastReadTimestamp(userId, conversationId, observedAt): boolean
export function subscribeToLastRead(userId, conversationId, callback): () => void
export async function flushPendingWrites(): Promise<void>
export function resetLastReadState(): void
export function getCachedTimestamp(userId, conversationId): string|undefined
export function clearCache(): void
```
Module state: `cache`, `remoteSeen`, `pending: Map<key, Entry>`, `stateGeneration`, `nextEntryId`. Entry: `{ entryId, userId, conversationId, observedAt, ownerUid, debounceTimer, retryTimer, inFlight, flushRequested, retries }`; `entryId` assigned at creation; `ownerUid = clientAuth?.currentUser?.uid ?? null` at creation. **One write per key is in flight at a time.**
- **`updateLastReadTimestamp`**: `false`, no effect, unless `observedAt` is a valid ISO string greater than the cache. Otherwise set cache; create the entry or raise its `observedAt`; arm the 2s debounce only when not in flight and no retry timer; return `true`.
- **`startWrite(entry)`** (never while `inFlight`): clear timers; if current uid (`?? null`) ≠ `ownerUid`, delete the entry and stop; capture `token = { key, entryId, generation, written: entry.observedAt }`; set `inFlight = true`, `flushRequested = false`; `setDoc(ref, { userId, conversationId, lastReadAt: Timestamp.fromDate(new Date(written)) })`.
- **`settle(token, outcome)`** (only place a result is applied):
  1. generation changed → return;
  2. entry missing or `entryId` differs → return;
  3. `inFlight = false`;
  4. `ok`/`superseded`: `retries = 0`; if `entry.observedAt > written` → `startWrite` now when `flushRequested`, else arm debounce; else delete the entry;
  5. `failed`: if `entry.observedAt > written` → reset `retries`, arm debounce; else `retries++`, arm `retryTimer` (5s, 15s, 60s); after the third failure delete with `console.error`.
- **Outcomes:** resolve → `ok`. `permission-denied` → `superseded` when `remoteSeen ≥ written`; otherwise one confirmation `getDoc` (entry stays in flight) → `superseded` if remote ≥ `written`, else `failed`. Other rejection → `failed`.
- **Offline:** the promise stays pending; later observations only raise `observedAt`.
- **`flushPendingWrites`**: in-flight entries get `flushRequested = true`; others `startWrite` now; resolves when the writes it started settle (no shutdown guarantee).
- **`resetLastReadState`**: `stateGeneration++`; clear timers, `pending`, `cache`, `remoteSeen`.
- **`subscribeToLastRead` / `getLastReadTimestamp`**: max-merge remote into `remoteSeen` and cache, never backwards; callbacks ignored after unsubscribe or generation change; an entry is deleted only when not in flight and `observedAt ≤ remote`.

### Consumers
- `RealtimeMessagesContext.js`: `updateLastReadTimestamp(userId, otherUserId, conversationId = null, observedAt = null)` notifies subscribers only when the client returned `true` and returns that boolean. New effect keyed on `userId`: `flushPendingWrites()` on `visibilitychange`→hidden and `pagehide`; cleanup `resetLastReadState()`.
- `Chat.js`: `latestObservedAt = getLatestMessageTimestamp(messages)`; the four mark-read call sites pass it as the fourth argument and skip when `null`; visibility gating unchanged.
- `PublicFeed.js` (state):
  - No `localStorage`; one mount effect removes legacy `publicFeedLastViewed` without reading it.
  - `markers` holds hydrated threads only (unread 0 until hydrated).
  - `markThreadRead(threadId)` sets the marker to the thread's latest message timestamp and calls `updateLastReadTimestamp(userId, 'publicFeed_' + threadId, boundary)`.
  - It runs on thread click, and while a thread is open whenever its latest timestamp changes or the document becomes visible — only while visible (#19).
  - Per-user isolation comes from the `key` remount (#18).

## Phase 6 — Push, worker, sound (#5 #10 #11 #20 #21, risk)
- `firebase-client.js`: `firebaseConfig` gains `messagingSenderId` and `appId` by conditional spread when the env vars are set.
- `worker/index.js`: remove the `onBackgroundMessage` import and callback; keep `getMessaging(app)` and `notificationclick`.

### `src/lib/push-server.js` (Admin)
```js
export function isPushDispatchEnabled(): boolean
export async function getPushRegistrationStatus({ decodedToken, token }): Promise<{ epoch, revision, mine, enabled }>
export async function registerPushToken({ decodedToken, token, expectedEpoch, expectedRevision, enabled = true, userAgent = null }): Promise<{ epoch, revision, enabled }>
export async function unregisterPushToken({ decodedToken, token, expectedEpoch, expectedRevision }): Promise<{ epoch, revision, changed }>
export async function sendIncomingMessagePush({ toUserId, conversationId = null, fromUserId = null }): Promise<{ totalTokens, successCount, failureCount, cleanedTokenCount, skipped? }>
export async function cleanupInvalidTokens({ epoch, sent, fcmResponse }): Promise<number>
// sent: Array<{ token: string, revision: string|null }>, index-aligned with the tokens given to FCM
```
- **`isPushDispatchEnabled()`**, in order: `PUSH_DISPATCH_ENABLED === 'false'` → `false` (hard override everywhere); `=== 'true'` → `true`; otherwise `NODE_ENV === 'production' && !FIRESTORE_EMULATOR_HOST && !FIREBASE_AUTH_EMULATOR_HOST`.
- **Mutations** run in `runFencedTransaction`, `current = doc?.revision ?? null`. `expectedEpoch !== ctx.epoch` or `expectedRevision !== current` → 409 `STALE_REGISTRATION`.
  - **Register** always writes: `{ userId, authUid, token, enabled, platform, userAgent, createdAt: doc?.createdAt ?? now, updatedAt, revision: uuidv4(), epoch }`. Ownership moves to the caller. The revision rotates even when owner and `enabled` are unchanged; a missing row is created (enabled or disabled as requested).
  - **Unregister** (sign-out only): row missing or `doc.userId !== user.id` → `{ changed: false }`; otherwise `enabled: false` and a new `revision`.
- **Status:** `resolveParticipant` + one doc read → `{ epoch, revision: current, mine: doc?.userId === user.id, enabled: doc?.enabled === true }`.
- **`sendIncomingMessagePush`:**
  1. Dispatch disabled → zero result + `skipped: 'disabled'` before any Firestore/FCM call.
  2. Read lifecycle; missing or not `active` → zero result + `skipped: 'inactive'`; else capture `epoch`.
  3. Query enabled rows; build `sent = [{ token, revision: row.revision ?? null }]`, de-duplicated.
  4. `sendEachForMulticast`; `webpush.notification = { tag, icon: '/icons/icon-192x192.png', badge: '/icons/icon-192x192.png' }`.
  5. `cleanedTokenCount = await cleanupInvalidTokens({ epoch, sent, fcmResponse })`.
- **`cleanupInvalidTokens`** (no actor, no re-admission):
  - Collect `sent[i]` whose response failed with an invalid-registration code; none → 0, no transaction.
  - One transaction `tx.getAll(lifecycleRef, ...tokenRefs)`; lifecycle missing, not `active`, or `epoch` differs → write nothing.
  - Per row, write only if it exists and `(row.revision ?? null) === sent[i].revision`: `tx.update(ref, { enabled: false, invalid: true, revision: uuidv4(), updatedAt })`. Never `set`/merge; returns rows updated.
- Token rows are removed only by reset (which changes the epoch), so a revision never recurs within an epoch.

### Push routes
- `register` body `{ token, expectedEpoch, expectedRevision, enabled? }` → 200 `{ success, epoch, revision, enabled }`.
- `unregister` body `{ token, expectedEpoch, expectedRevision }` → 200 `{ success, epoch, revision, changed }`.
- `status` body `{ token }` → 200 `{ success, epoch, revision, mine, enabled }`.
- Missing precondition key → 400 `PRECONDITION_REQUIRED`; `expectedEpoch` must be a positive integer and `expectedRevision` a string or `null`, else 400; 409 `STALE_REGISTRATION`; 503 `RESET_IN_PROGRESS`.
- Old clients send no preconditions and get 400 until reload; existing rows read `revision: null` until first mutated.

### `src/lib/push-client.js` (client)
```js
export const PUSH_INTENT_KEY = 'secret-santa-push-intent';                 // { id, authUid }
export function isPushSupported(): boolean
export function getPushPreference(authUid): 'enabled'|'disabled'|null      // key 'secret-santa-push-pref:' + authUid, plain string
export function subscribePushState(callback): () => void
export async function enablePushForCurrentUser({ authUid }): Promise<PushResult>
export async function disablePushForCurrentUser({ authUid }): Promise<PushResult>
export async function syncPushTokenIfGranted({ authUid }): Promise<PushResult>
export async function releasePushRegistration({ timeoutMs = 3000 } = {}): Promise<boolean>
export function cancelPushOperations(): void
export function attachForegroundListener(onIncomingMessage): () => void
// PushResult: 'registered' | 'disabled' | 'skipped' | 'aborted'
```
- **Preference (desired state):** written in exactly two places — the first synchronous statements of enable and disable, each one unconditional `setItem` before any `await`. No rollback, no adoption, no preference write after an await or a check.
- **Device intent** (who may start network work; not desired state, never treated as a storage CAS): a new `{ id: uuid, authUid }` is written unconditionally by exactly four events — a runtime sync whose stored intent names another account, enable, disable, sign-out release (`authUid: null`). A runtime sync for the already-named account adopts the stored id. Retries never write an intent.
- **`isCurrent(op)`**: realm `pushGeneration` unchanged, `clientAuth.currentUser?.uid === op.authUid`, stored intent `id === op.intentId`. Evaluated after every await and immediately before every request; failure ends the operation as `aborted` with no further request and no storage write.
- **Enable:**
  1. synchronously: throw if unsupported; `setItem(preference, 'enabled')`; `setItem(intent, { id: new, authUid })`;
  2. `await Notification.requestPermission()` if not granted;
  3. after it, no storage write: not current → `aborted`; permission not granted → throw (preference stays `enabled`, effective if permission is granted later);
  4. reconcile. Network failure throws; preference stays `enabled`; next startup retries.
- **Disable:** synchronously `setItem(preference, 'disabled')` then the intent; reconcile. Failure throws; preference stays `disabled`; next startup retries.
- **Reconcile — at most three rounds; no no-op outcome.** Each round:
  1. obtain the token (first round only);
  2. `isCurrent`, then POST status → `{ epoch, revision }`;
  3. `isCurrent`, then read the stored preference: `desired = (preference === 'enabled')`;
  4. POST `register { token, expectedEpoch: epoch, expectedRevision: revision, enabled: desired }` — **always**, including when status already shows the caller's row with the same `enabled` value;
  5. 200 → record realm `lastKnown = { authUid, token, epoch, revision }` and return `desired ? 'registered' : 'disabled'`;
  6. 409 → next round, repeating 2–4 with a fresh status and a freshly re-read preference; after a third 409 → `aborted`.
- **Why this fences without the older tab:** the newest action is acknowledged only after its own register has rotated the revision. Any request issued earlier against the previous revision — an older enable, disable or sign-out unregister, held anywhere before the server commit — is then rejected with 409, whether or not its tab still exists. If the older request commits first, the newer one either sees it in status or gets a 409 and retries; either way its own write lands last. There is no client convergence step.
- Fetches use the captured user's token and a 15s abort. `syncPushTokenIfGranted` returns `skipped` unless the uid matches, push is supported and permission is granted; it removes the legacy `secret-santa-push-token` key. A device with no preference ends `disabled` (opt-in is explicit).
- **Release** (sign-out): write intent `{ authUid: null }`; if the realm has no `lastKnown` for the current user, fetch status first; send one owner-checked `unregister` with those preconditions; abort everything at `timeoutMs`; clear `lastKnown`; preference untouched.
- `cancelPushOperations()` increments `pushGeneration` (realm-local).
- **Storage events** refresh subscribers only and never start a reconcile; a tab reconciles on its own mount/identity change and its own actions.

### Push and sound components
- `PushNotificationsControl.js`: props `{ compact, authUid }`.
  - Desired = `getPushPreference(authUid)` via `subscribePushState`; effective = desired `enabled` and permission `granted`; button reads "Disable notifications" when effective, else "Enable notifications".
  - Per-instance `registrationNote`, set only from this instance's toggle and cleared on its next toggle or any preference change:
    - enable threw (non-permission): "Notifications are on, but this device is not registered yet. It will retry the next time the app opens.";
    - disable threw: "Notifications are off. This device will finish unregistering the next time the app opens.";
    - `aborted`: no note, no toast.
  - Permission denied keeps the existing hint. The control never writes a preference except through the two toggles.
- `PushNotificationsRuntime.js`: props `{ currentUser, authUid }`; sync only with both; `attachForegroundListener` in try/catch; cleanup `cancelPushOperations()` + unsubscribe; deps `[currentUser?.id, authUid, showToast]`.
- `NotificationSoundRuntime.js`: `hydratedUserRef` replaces `previousLoadingRef`. Order: no user → reset; user changed → un-hydrate; loading → un-hydrate and return; not hydrated → silent baseline; else existing diff and gates.

## Phase 7 — Scripts and docs (#22)
- `scripts/lib/emulator-firestore.js` exports `EMULATOR_PROJECT_ID = 'xmasteak-app'`, `APP_COLLECTIONS` (same order as `src/lib/firestore.js`), `getEmulatorFirestore()`; sets `FIRESTORE_EMULATOR_HOST` to `127.0.0.1:8080` when unset; exits 1 unless the host is `127.0.0.1:*` or `localhost:*`.
- `wipe_db.js`: deletes every `APP_COLLECTIONS` entry in ≤ 400-op batches; sets `system/lifecycle` to `{ epoch: previous + 1, state: 'active', resetId: null, resetStartedAt: null }`.
- `check_messages.js`, `test_message_routing.js`: take `<santaUserId> <recipientUserId>` from argv (usage + exit 1 if missing); no hardcoded ids or names.
- All four print ids, counts and assignment linkage only.

### Documentation — exact text
**`CLAUDE.md`**
1. Replace the body of "### Authentication & User Management" with:
> User authentication is a server-mediated handshake:
> 1. Users sign in with Google OAuth via Firebase Auth.
> 2. `src/context/UserContext.js` is the single auth/profile owner (`useUser()` reads it). It POSTs the ID token to `/api/auth/bootstrap`.
> 3. `src/lib/participant-admission.js` checks the email against `src/lib/participants.js` (and `email_verified` outside development), then atomically resolves or creates the UUID profile and writes a server-only `authIdentities/{authUid}` record.
> 4. Firestore rules admit only callers whose admission record matches the current `system/lifecycle` epoch. Unauthorized emails get ACCESS_DENIED.
>
> Clients never create `users` documents. After an admin reset, open clients re-bootstrap automatically. To remove a participant mid-season, remove them from the list and delete their `authIdentities` document.

2. In "### Data Model", change the `lastRead` comment to `// lastReadAt = timestamp of the latest message the user has observed; monotonic` and append:
> **Server-only collections** (clients cannot read or write them): `authIdentities/{authUid}` `{ uid, email, userId, epoch, createdAt, updatedAt }`; `participantIndex/{email}` `{ email, userId, epoch, createdAt }`; `system/lifecycle` `{ epoch, state, resetId, resetStartedAt, updatedAt }`. `pushTokens` documents carry `authUid`, `revision` and `epoch`; push mutations must present the `epoch` and `revision` returned by `/api/push/status`.

3. In "### API Routes":
   - delete the `/api/admin/assign` bullet;
   - add `- **POST /api/auth/bootstrap**: Resolve or create the caller's profile and admission record. Requires a Bearer token.`;
   - add `- **POST /api/push/status**: Report this device token's registration state (epoch, revision, ownership). Requires a Bearer token.`;
   - replace the send bullet's second sentence with `Requires a Bearer token; validates the conversation against both users' assignments and commits replay check, validation and write in one transaction keyed on clientMessageId.`;
   - append to the reset bullet `Exclusive and fail-closed: if it does not complete, run it again.`;
   - append to both push bullets `Requires expectedEpoch and expectedRevision from /api/push/status.`
4. In "## Important Notes":
   - replace the "Message create verifies…" sub-bullet with `Clients cannot create users or messages; both are written only by the server. Recipient selection must update both users reciprocally in one transaction.`;
   - replace the "lastRead writes are owner-scoped…" sub-bullet with `lastRead doc ids must equal {userId}_{conversationId}; markers are monotonic; a user can read their own markers, and other users' DM markers for read receipts, but never another user's public-feed markers.`;
   - add `Push dispatch: PUSH_DISPATCH_ENABLED=false always disables it and =true always enables it; unset means production only, and never when an emulator host is configured. The emulators do not emulate FCM.`;
   - add `The message outbox stores one localStorage entry per queued message under secret-santa-message-outbox-v2:*; the v1 key is read-only legacy input. Tabs running an older build must reload before the outbox fixes apply.`
5. In "### Message Architecture", replace the `filterMessages` bullet's last sentence with `Routing is decided by resolveMessageConversation: explicit conversationId, then legacy isSantaMsg, then the known assignment, then a canonical fallback (santa = smaller id) only for genuinely ambiguous rows.`

**`README.md`** — replace the rules sentence under Deployment with:
> Firestore security rules live in `firestore.rules`. They admit only server-admitted participants and deny client creation of users and messages. Deploy the app before the rules, and ask participants to reload open tabs.

and add after the client variable list:
> `PUSH_DISPATCH_ENABLED` (server, optional): `false` always disables push dispatch, `true` always enables it. Leave it unset or `false` for local development.

**`plans/05-admin-assign-decision.md`** (only if D1 = A) — prepend `> Resolved by the bug-sweep PLAN.md: Option A (variant and endpoint removed).`

**`__tests__/integration/README.md`** — one bullet per new integration file, named as in the manifest, with a one-line description.

## Tests — required assertions

### New
- **`participant_admission.test.js`**:
  - outsider/unverified rejected with zero writes; `resetting` → 503;
  - linking keeps the UUID without writing the users doc;
  - two matches, noncanonical casing, id mismatch, index-to-missing-user → `PROFILE_CONFLICT`, zero writes;
  - identity `createdAt` preserved; epoch-mismatched identity triggers admission; fenced transaction retries once.
- **`auth_bootstrap_api`, `push_status_api`**: status-code mappings; 200 shapes.
- **`dev_assign_api`**: non-development 403; `RESET_IN_PROGRESS` 503; < 2 users 400; success 200 via `assignUsersInTransaction`.
- **`integration/participant-admission`**: five concurrent admissions for one synthetic token → one users doc + one index doc; concurrent seed + admission → one profile; concurrent `ensureAllParticipants` → participant count.
- **`integration/reset-fencing`** (barriers = hooks resolved by the test):
  1. A held at `afterBegin`, B completes, release A → `RESET_SUPERSEDED`; final `active`, B's epoch, one profile per participant.
  2. Same with A held at `afterDelete`.
  3. `afterDelete` throws → stays `resetting`; a second reset completes.
  4. Held at `afterReseed`: `assignUsersInTransaction` → `RESET_IN_PROGRESS`; afterwards no assignments.
  5. Delayed send with the old `senderUserId` → rejected; `messages` empty.
  6. Status, full reset, register with the old epoch → 409; `pushTokens` empty.
  7. Admission while held at `afterBegin` → 503.
- **`integration/firestore-rules-admission`**:
  - outsider: users get, messages list, users create, lastRead/typing/reactions writes all fail;
  - stale-epoch identity, and anyone while `resetting`: all reads/writes fail;
  - users create and messages create fail for everyone;
  - one-sided claim either way fails; reciprocal batch succeeds; batch + `name` change or + extra field fails; second claim and claim on an already-claimed user fail.
- **`integration/push-registration`** (emulator; `cleanupInvalidTokens` called with a crafted response, no FCM):
  1. Missing either precondition → 400.
  2. Two registers with the same revision → one success, one 409.
  3. Stale unregister after a newer register → 409, still enabled.
  4. Another user's unregister → `changed: false`.
  5. Every mutation changes `revision`.
  6. After a reset, the pre-reset epoch → 409 even with `expectedRevision: null`.
  7. **Matching-state reaffirmation, disable:** row disabled at R; `register(enabled: false, expectedRevision: R)` → 200 with R2 ≠ R; an earlier held `register(enabled: true, expectedRevision: R)` → 409; row stays disabled at R2.
  8. **Matching-state reaffirmation, enable:** row enabled (mine) at R; `register(enabled: true, R)` → R2; an earlier held `unregister(R)` and an earlier held `register(enabled: false, R)` → 409; row stays enabled at R2.
  9. Cleanup after reset with the old epoch → 0, `pushTokens` empty.
  10. Cleanup with a superseded revision → 0, the newer enabled row untouched.
  11. Cleanup with the current revision → 1; row `enabled: false`, `invalid: true`, new revision; old revision or `null` → 409.
  12. Cleanup for a token with no row → 0, nothing created.
- **`firebase_client_config`**: with `jest.unmock('@/lib/firebase-client')`, mocked `firebase/app`, env set → `initializeApp` receives `appId` and `messagingSenderId`; absent when unset.
- **`worker_push_display`**: `getMessaging` once; `onBackgroundMessage` not registered; `showNotification` never called; source has no `showNotification`.
- **`ChatTabs_draft_isolation`**: draft absent after switching tabs; Send enqueues nothing.
- **`PublicFeed_read_state`**: another `userId` shows its own state; legacy key removed and never read; new message while open and visible writes that timestamp and unread is 0 after Back; no write while hidden.
- **`useAdminReset`**: declined confirm → no fetch; success → POST with Bearer, toast, `onComplete`; failure → server text.
- **`emulator_scripts_config`**: project id matches `.firebaserc` and both Firebase lib files; `APP_COLLECTIONS` equal; non-loopback host exits.
- **`message_outbox_cross_realm`** (two module instances via `jest.isolateModules`, one `localStorage`):
  - A delivered in realm 1 while realm 2 gets a late 503 → not live, never re-sent;
  - B enqueued in realm 2 during realm 1's pending fetch survives and is delivered;
  - both realms import the same v1 array → one payload per id, v1 byte-identical, delivered ids not re-imported;
  - existing different v2 payload unchanged; duplicate v1 id imports once.

### Modified
- `__tests__/setup.js`: add `doc`, `getDoc`, `setDoc`, `deleteDoc`, `Timestamp: { fromDate }` to the global firestore mock.
- `helpers/firestore-rules-test-utils.js`: `seedUser` also seeds `system/lifecycle` `{ epoch: 1, state: 'active' }` and `authIdentities/{userId}` `{ uid, email, userId, epoch: 1 }` unless `{ admitted: false }`; add `seedIdentity(testEnv, authUid, userId, email, epoch = 1)`.
- `firestore-rules-lastRead`: owner reads a missing own `publicFeed_*` doc, another user denied; older update fails, newer succeeds; > 5 minutes ahead fails; id ≠ `userId + '_' + conversationId` fails; remapped identity cannot write the old path.
- `lib/firestore.test`: `resetDatabase` begins, deletes eight collections in order in owner-checked transactions ≤ 400, completes; on delete error `completeReset` not called; `assignUsersInTransaction` reads users in-transaction, rejects when not `active`, writes nothing for `null`; `batchUpdateUsers` case removed.
- `api/admin_reset_enhanced`: calls `resetAndReseedParticipants(PARTICIPANTS)` with no hooks; `RESET_SUPERSEDED` → 409; others → 500.
- `api/send_message_api` (mock `verifyRequestToken`, `runFencedTransaction` invoking `work` with a fake `tx`):
  - wrong pair 400; false role 400; `senderUserId` mismatch 403; missing conversation on a mutual pair 400;
  - replay with omitted `conversationId` → `replayed`; replay after assignments changed → `replayed`, no push;
  - differing content 409; `RESET_IN_PROGRESS` 503, no push; transient error retried.
- `api/push_register_api`, `api/push_unregister_api`: missing precondition → 400 `PRECONDITION_REQUIRED`; invalid types 400; 409 mapping; new argument shapes.
- `lib/push_server.test` (save/restore the four env vars; `runTransaction` mocked):
  - `'false'` with production → zero Firestore/FCM calls; unset with an emulator host and production → zero; unset in test env → zero; `'true'` → existing copy cases pass with icon and badge.
  - Lifecycle not `active` → `skipped: 'inactive'`, no FCM; cleanup receives the captured `epoch` and per-row `revision` (`null` for legacy).
  - Register on an unchanged owner/`enabled` still writes a new revision.
  - Cleanup: epoch differs / `resetting` / missing lifecycle / missing row / revision differs → zero writes and never `tx.set`; matching row → one `tx.update` with `enabled: false`, `invalid: true`, new revision; non-invalid code ignored; no invalid responses → no transaction.
- `context/RealtimeMessagesContext.test`: add `flushPendingWrites`, `resetLastReadState` to the mock; same-`id` `user` object change does not call `onSnapshot` again; retry timer does not fire after unmount.
- `unit/useUser_realtime` (rewritten):
  - two consumers → one bootstrap; stale response after sign-out or switch ignored;
  - assignment snapshot still updates `user` after `refreshUser()` and after a reset-driven re-bootstrap;
  - server-confirmed missing doc → re-bootstrap; cache-only miss ignored; snapshot after cleanup ignored;
  - 503 retries with notice; 403/409 → error state with `user: null`; refresh network failure keeps `ready`; auth change calls the three cancels.
- `unit/message_outbox`, `unit/outbox_retry_delivery`:
  - add `uid`/`ownerUid`;
  - B enqueued during A's pending fetch survives success, failure and 401-refresh and is delivered by the follow-up pass;
  - auth switch during the token await and during the fetch sends no request with another account's token and leaves the item pending with the same id;
  - body carries `senderUserId`; stale v2 payload collected; expired or malformed v1 entry not imported, v1 untouched.
- `unit/MessageOutboxRuntime`: `authUid` prop; `cancelOutboxDrains` in the mock and called on unmount.
- `unit/Chat_outbox`: `authUid` in enqueue and drain; no messages → mark-read not called.
- `unit/Chat_unread`: fourth argument equals the latest message timestamp.
- `unit/lastReadClient`, `unit/lastReadClient-normalization` (pass `observedAt`; written value equals it; deferred `setDoc`/`getDoc`):
  1. In flight + newer observation + flush → no second `setDoc` until the first settles, then immediate with the newest; entry removed after.
  2. In flight + reset + new entry for the same key → old resolve/reject leaves the new entry and timer intact.
  3. Entry removed by subscription (not in flight) then recreated → written; an in-flight entry is not removed.
  4. Rejection then newer observation during backoff → next write carries the newest.
  5. `permission-denied` with deferred confirmation read and a newer observation → newer value still written.
  6. `permission-denied` with no newer remote → retried, dropped after the third failure.
  7. Changed `ownerUid` at write start → no `setDoc`.
- `unit/unread_badge_clearing`, `unit/unread_logic`, `unit/realtime_hooks`: mocked client returns `true` on accepted updates and adds `subscribeToLastRead`, `flushPendingWrites`, `resetLastReadState`; waits use `subscribeToLastRead`; a rejected update does not notify; a remote callback clears the badge; a mutual pair's legacy row counts in one tab only.
- `unit/PublicFeed_lastViewed_sync`: retitled "hydrates from Firestore markers"; existing assertions kept; a seeded legacy key is removed and does not affect the badge.
- `unit/message_routing`: non-mutual pair with Santa id sorting after recipient id + viewer map → legacy row in the real conversation; mutual → canonical; endpoint-mismatched explicit id → `unroutable`; `matchesStoredMessage` cases.
- `unit/NotificationSoundRuntime`: already-loaded mount then new message → one chime; reload cycle → none; user change → none.
- `unit/push_client` (rewritten; two module instances share `localStorage`; a stateful fake server implements epoch/revision checks and can **hold a request before it is applied**; `setItem`/`getItem` spied; "close realm" = `cancelPushOperations()` on it and discard its response):
  1. **Held enable vs newer disable, old realm closed:** row disabled at R. Realm 1 enable(A) sends `register(true, R)`, held before commit. Realm 2 disable(A): status shows disabled, yet it sends `register(false, R)` → acknowledged R2, returns `disabled`. Close realm 1, release its request → server returns 409. Final: row disabled at R2, preference `disabled`, no further request from realm 1.
  2. **Held disable vs newer enable, old realm closed:** row enabled (mine) at R. Realm 1 disable(A) sends `register(false, R)`, held. Realm 2 enable(A): status shows mine and enabled, yet it sends `register(true, R)` → R2, returns `registered`. Close realm 1, release → 409. Final: enabled at R2, preference `enabled`.
  3. **Held sign-out unregister vs newer enable:** realm 1's release `unregister(R)` held; realm 2 enable acknowledged at R2; release → 409; row stays enabled.
  4. **Older request commits first:** realm 1's `register(true, R)` commits between realm 2's status and its register → realm 2 gets 409, re-reads status and the preference, registers `false` → final disabled.
  5. **Account switch:** realm 1 (A) register held; realm 2 (B) syncs and registers per B's preference; release → 409; realm 1 sends nothing further.
  6. **Every round registers:** startup sync with a matching row sends status + register; with no preference it registers `enabled: false` and writes no preference key.
  7. **Preference re-read on retry:** preference changed between a 409 and the next round → the next register uses the new value.
  8. **No rollback:** an enable whose register fails leaves the preference `enabled`; it throws; a later sync registers.
  9. **Write at the guard:** a `getItem` hook on the intent key runs realm 2's disable at the instant realm 1 checks before a register → realm 1 writes no preference; stored preference `disabled`; fake server ends disabled.
  10. **Delayed permission:** enable(A) with `requestPermission` held, then (a) realm 2 disable, (b) release, (c) in-realm cancel; on resolve `granted` → no storage write, no request; preference is whatever the last click left.
  11. **Write audit:** each account's preference key is written exactly once per enable/disable call, before its first await, never by sync, release or retries.
  12. Storage event → subscribers only, no request. Three 409s → `aborted`. Release aborts at the timeout, writes a no-account intent, sends at most one unregister, leaves the preference. Throwing `getMessaging` → no-op.
- `unit/PushNotificationsControl` (stateful mocks; permission per case): enabled + granted → "Disable notifications"; failed enable → same label + "not registered yet" note; failed disable → "Enable notifications" + "finish unregistering" note; `aborted` → no note, no toast; enabled without permission → "Enable notifications"; a preference change from another tab updates the label without calling a toggle.
- `unit/PushNotificationsRuntime`: new props and mocks; a throwing listener does not throw from render.
- `unit/admin_ui`: admin with a recipient sees compact Reset; clicking sidebar "Reset App Data" (confirm accepted) POSTs `/api/admin/reset`; stale comments removed.
- `unit/app_flows`: add `cancelOutboxDrains` to the outbox mock.
- `unit/RecipientSelector`: mock `@/lib/sign-out`.
- `unit/participants`: every list email lowercase with no `/` (if it fails, the implementer stops and reports).
- `e2e/mobile-layout`, `e2e/unread-badge`: `/api/admin/assign` → `/api/dev/assign`.

### New e2e (emulators only)
- `admission-and-reset.spec.ts`: outsider gets 403 from the Firestore REST `users` read and from `/api/auth/bootstrap`; a draft does not follow a tab switch; admin reset from the desktop sidebar → a second context reaches "Welcome" with a new `__e2eUserData__.id` without reload.
- `outbox-cross-tab.spec.ts` (two new-code pages, `page.route('**/api/messages/send')`):
  - (a) B enqueued while A is held is delivered after A;
  - (b) tab 1 delivers X, tab 2 then gets 503 for X → no bubble, no further request;
  - (c) a seeded v1 item with two pages → exactly one message doc, v1 unchanged;
  - (d) with all sends failing the item survives reload and is delivered once unblocked;
  - (e) after sign-out and sign-in as another user while a request is held, every request for that item decodes to the original uid.

Push has no browser-level test (needs a service worker and real FCM).

## Traceability

| ID | Change | Primary test |
|---|---|---|
| 1 | Admission, epoch-bound rules | rules-admission; e2e outsider |
| 2 | Immutable payload keys, follow-up pass | message_outbox; cross-realm; e2e (a) |
| 3 | Captured user, cancels, `senderUserId` | message_outbox auth switch; e2e (e) |
| 4 | `getAfter` + `affectedKeys` | rules-admission claims |
| 5 | Config keys, contained init | firebase_client_config; PushNotificationsRuntime |
| 6 | Index transaction, single provider | integration admission; useUser two consumers |
| 7 | Auth generation and request sequence | useUser stale response |
| 8 | Profile-loss recovery, reset protocol | useUser; reset-fencing; e2e reset |
| 9 | Transactional send, client creates denied | send API; rules-admission |
| 10 | Every reconcile round registers desired state with status epoch/revision; device intent; fenced cleanup | push_client 1–7; push-registration 1–12 |
| 11 | Preference written only by explicit clicks; newest action fences older requests | push_client 1–2, 8–11; PushNotificationsControl |
| 12 | Observed boundary, single-flight writes | lastReadClient schedules |
| 13 | Own-marker subscription | unread tests |
| 14 | Assignment-aware resolver in DMs | message_routing |
| 15 | Resolver in unread counts | unread mutual case |
| 16 | Keyed chats | ChatTabs_draft_isolation |
| 17 | `useAdminReset`; shuffle per D1 | admin_ui; useAdminReset |
| 18 | Keyed feed, no shared local key | PublicFeed_read_state |
| 19 | Open-thread marking | PublicFeed_read_state |
| 20 | Baseline on first loaded state | NotificationSoundRuntime |
| 21 | Worker display removed | worker_push_display |
| 22 | Emulator helper | emulator_scripts_config |
| Risk | Dispatch gate with hard-off override | push_server env cases |

## Read and write budget

| Operation | Reads | Writes |
|---|---|---|
| Rules evaluation | identity + lifecycle (2), plus the user doc for owner-checked writes as today | — |
| Send | 5 (lifecycle, identity, sender, recipient, message); today 2 | 1 |
| Bootstrap, warm | 4 (lifecycle, identity, user, index) | 0 |
| First admission per participant per epoch | 3 + the `users` collection (≤ participant count) | ≤ 4 |
| Push status | 4 | 0 |
| Push register / unregister | 4 | 1 |
| **Push reconcile round** | 8 (status + register) | 1 |
| **Startup, permission granted** | 8 (one round) | 1 — always, even when nothing changed |
| Startup, permission not granted | 0 | 0 |
| Enable / disable click | 8 per round, at most 3 rounds | 1 per successful round (normally 1) |
| Sign-out release | 4 (+4 if status is needed) | ≤ 1 |
| Push dispatch (only when enabled) | 1 lifecycle + the existing token query | 0 |
| Invalid-token cleanup (only on invalid responses) | 1 lifecycle + 1 per invalid token | 1 per matching row |
| Dev assign | lifecycle + `users` collection | 1 per user |

Listeners: one all-messages and one reactions listener, unchanged; two own-marker doc listeners replace two one-shot reads.

## Rollout and cutover (not authorized by this plan)
- No automatic data migration; lifecycle, index and identity docs are created lazily; existing profiles are linked with their UUIDs. Conflicts fail closed with `PROFILE_CONFLICT`; repair is a separately authorized manual action.
- Deploy order: app first (compatible with the old rules), then an admin `/api/init` backfill, then rules.
- **Required cutover step:** every open tab reloads onto the new build. Until then an old tab is denied by the new rules, gets 400 from push mutation routes, and still runs the legacy outbox code. Its v1 queue is imported by the first new-code load.
- Old clients' markers satisfy the new marker rules.
- Push: opt-in is explicit per device. On its first new-code load with notification permission granted, a device with no local preference is registered as disabled, and the user enables notifications again.

## Limits and unverified items
- A message stamped earlier than a marker but delivered later counts as read (accepted ordering limit). Marker flush on hide/unload is best-effort.
- A removed participant keeps rule-level read access until their identity doc is deleted.
- Unparseable `conversationId` rows now use legacy resolution and may newly appear in DMs.
- Push:
  - The newest acknowledged action always commits a fresh revision, so earlier requests are rejected whenever they reach the server.
  - The one remaining gap is a tab that passes its intent check on a lagging localStorage view after another account took the device; that is corrected at the device's next sync.
  - If no one signs in after a sign-out that bypassed the helper, the previous account's generic notifications continue on that device.
- Notifications dispatched before a reset cannot be retracted.
- Not verified by the planner; the primary must confirm: emulator behaviour of the rules syntax (`duration.value`, `getAfter`, `affectedKeys`) and of Admin transactions under contention; `email_verified` for every participant and the enabled production providers; SDK auto-display and click after the worker change; selectors in the new e2e specs.
- **Real FCM delivery is not verified by any step in this plan.**

## Primary-executed steps
1. Before approval, in the real tree:
   - `git diff --check`;
   - every Modify/Delete path exists and every Create path does not;
   - `for n in $(seq 1 22); do grep -Eq "^\| ${n} \|" PLAN.md || echo "missing ${n}"; done; grep -q "^| Risk |" PLAN.md || echo "missing Risk"` prints nothing;
   - `grep -nE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}" PLAN.md` prints nothing.
2. Record `shasum` of `public/sw.js`, `public/workbox-f1770938.js`, `public/worker-2a484529a5551160.js`, `.claude/settings.local.json`; re-check after every gate; they stay unchanged and unstaged.
3. After implementation, if D1 = A: delete `src/app/api/admin/assign/route.js`; `grep -rn "admin/assign\|handleAssign\|variant=\|batchUpdateUsers" src e2e __tests__` prints nothing.
4. `git status --porcelain` lists only manifest paths plus pre-existing items; `git diff --check` passes.

## Verification (primary; all in a disposable copy)
```
export PATH=/usr/local/bin:$PATH && node -v        # expect v22.15.0
VERIFY_DIR="$(mktemp -d)/verify"
rsync -a --exclude node_modules --exclude .next --exclude .git --exclude '.env*' \
  --exclude playwright-report --exclude test-results \
  --exclude 'public/sw.js' --exclude 'public/workbox-*.js' --exclude 'public/worker-*.js' \
  ./ "$VERIFY_DIR"/
cp -R node_modules "$VERIFY_DIR"/ && cd "$VERIFY_DIR"
unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY
export PUSH_DISPATCH_ENABLED=false
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```
`PUSH_DISPATCH_ENABLED=false` forces dispatch off for every command, whatever credentials the machine holds; no command calls FCM. Check ports 8080, 9099, 4000, 3000 first, then:
1. `npm run lint`
2. `npm run test:unit -- --runInBand` (includes `PublicFeed_grouping`, `message_routing`)
3. `npx firebase emulators:exec --project=xmasteak-app "npm run test:integration"`
4. `NEXT_PUBLIC_FIREBASE_API_KEY=fake NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-verify NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000 NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0000000000000000 NEXT_PUBLIC_FIREBASE_VAPID_KEY=fake npm run build`, then:
   ```
   ls public/worker-*.js >/dev/null 2>&1 || { echo "FAIL: generated worker missing"; exit 1; }
   if grep -lE "secret-santa-message[\"']" public/worker-*.js; then
     echo "FAIL: old custom notification tag present"; exit 1
   else
     echo "OK: old custom notification tag absent"
   fi
   ```
5. `npx firebase emulators:exec --project=xmasteak-app "npm run test:e2e"`
6. Manual against emulators in the copy:
   - two tabs at first sign-in → one profile;
   - reset with a second browser open → recovers;
   - forced mid-reset failure → loading screen with admin Reset → re-run recovers;
   - a read on one browser clears the badge on another;
   - `window.__firestoreDebug.printListenerSummary()` shows one all-messages listener before and after an assignment change.

Passing = exit 0 for 1–5 with the listed assertions present, the worker check printing OK, and the recorded hashes unchanged. Push is verified against mocks and the Firestore emulator only.

## Open decisions (user)

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Admin shuffle (`plans/05`). **A:** remove the full variant and `/api/admin/assign`. **B:** expose behind an overwrite guard (needs a planner revision). **C:** leave unreachable, fix reset only. | **A.** Plan is written for A. No option exposes an unguarded shuffle. |
| D2 | Require `email_verified` outside development. | **Yes**, after confirming every participant signs in with Google. |
| D3 | Deny all client-side message creates. | **Yes.** |
| D4 | Drafts clear when leaving a chat tab. | **Clear.** |
| D5 | Push desired state changes only by an explicit Enable/Disable click on that device. After rollout each device opts in again (a device with no local preference is registered as disabled). Sign-out stops this device's notifications; the preference is remembered per account. | **Accept.** |
| D6 | Discard the unowned `publicFeedLastViewed` key. | **Yes.** |
| D7 | Non-production push stays off unless `PUSH_DISPATCH_ENABLED=true`; `false` is a hard off everywhere. | **Yes.** |