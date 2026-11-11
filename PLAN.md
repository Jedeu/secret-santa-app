# PLAN.md — Annual close, read-only archives and new-year start

## Status

**Status: APPROVED — revision 4; adversarial review complete (2026-11-10), no blocking objections.** The user approved this reviewed plan with “Yes” on 2026-11-10 in response to the explicit request for Opus implementation approval. Approval covers the exact code/docs/tests manifest and primary-owned deletions, including the unsafe seed script. It does not authorize any read, write, deploy, credential change or live Close/Start action against a real Firebase or hosting project. Fable drafted and revised this plan; the primary reviewed revision 3 in full and every change in revision 4. Implementation is complete locally; primary-executed verification results are recorded below. No deployment, production data access or live Close/Start action has occurred.

## Implementation and verification checkpoint (2026-11-11)

- Opus implemented all **20 creates and 64 modifications**; primary completed the **4 approved deletions**. Model/tool/scope audit passed. No unlisted implementation files or owner changes were modified.
- Verification ran from a disposable copy with **Node 22.15.0**, isolated credentials/configuration, explicit local emulator addresses and push dispatch disabled. Existing installed direct dependency versions match the lockfile. Original generated service-worker assets and user-owned settings remain byte-identical to baseline.
- **Passed:** lint; production build; **699 unit/API tests** (57 suites); **56 real-emulator rules tests** (5 suites); **127 integration tests** (10 suites, two consecutive full passing runs); **48 Chromium E2E tests**; diff/new-file whitespace, manifest/reference, SDK-boundary and approved-rules equality checks.
- **Initial integration attempt failed:** 126 passed, one concurrent seed/admission test returned `INVALID_ARGUMENT: Transaction is invalid or closed`, with credential-metadata discovery warnings. After disabling metadata discovery in the isolated verification environment (`METADATA_SERVER_DETECTION=none`), the focused 5-test suite and both complete integration reruns passed. No application source change was made to hide or mask this attempt; it remains recorded as a failed run.
- **Supplemental browser verification passed:** server-acknowledged messages and UI reactions in both years; three already-open sessions become read-only; preserved static archived message/reaction; fresh UUIDs without reload; the excluded already-open session loses access; archive access before current-year recipient selection; new-year delivery reaches the recipient through the correct scoped namespace; 2025 users/messages/reactions remain deeply equal; Reset returns 410. Zero external browser requests, uncaught page errors or unexpected console errors. Three expected first-admission listener warnings and one expected admission-denial response were recorded.
- Two earlier supplemental probe attempts failed (a first-row reaction-picker/header pointer overlap in unchanged components, then initial dev-login setup navigation). The final probe used lower synthetic fixture rows and pre-created emulator accounts/server-admission setup, with normal physical UI clicks. The unlisted Chat/ReactionPicker/dev-login files were not changed. Existing multi-tab persistence fallback warnings also remain visible in E2E logs.
- All owned verification processes were stopped; ports **8080, 9099, 4000 and 3000** were clear at this checkpoint. No staging, commit, push, production access, credential change, deployment or live year transition had been performed. Google production sign-in and real push notifications were not verified.

## Git publication authorization (2026-11-11)

The owner requested a draft pull request for review. This authorizes the primary to commit the task's explicit manifest plus PLAN.md/RESEARCH.md on a feature branch, push that branch and open a **draft** PR against main. Keep pre-existing user-owned settings and generated assets out. It does not authorize a direct push to main, deployment, production data access, credential changes or live Close/Start actions. Publication-ready research omits private local/session operational metadata; application code remains identical to the verified snapshot.

## Goal

Add two reusable admin actions, **Close year** and **Start new year**, so that 2025 becomes a read-only browsable archive and 2026 starts clean with the 2026 roster, with no bulk reset of year data and no way to mutate a closed year through the new app.

## Confirmed scope (not open)

- Existing data is 2025; the next year is 2026. Close and Start are separate, explicit admin actions.
- Archive in place: root collections stay as 2025; later years live under `years/{year}/…`.
- Profile UUIDs are new every year. Close and Start are each one atomic transaction.
- Pairings of a year are revealed in its archive from the moment it is closed.
- The 2026 roster is the 2025 registry minus Jana. She loses app access when 2026 starts; there is no archive-only role. Her 2025 records stay visible to admitted participants.
- Manual recipient selection is kept. Automatic assignment is deferred. Archive browsing never depends on `recipientId`.
- The destructive Reset is retired. Old installed clients must reload once 2026 starts. There is no Reopen action.

**What is and is not guaranteed.** The new app has no bulk reset or deletion of year data, and it never writes to a closed year: the server refuses and the rules deny. The open year keeps its normal writes, including pairing claims, read markers, and adding or removing typing and reaction documents. None of this protects against Admin SDK or console operations, or against older deployments that still hold valid Admin credentials; the rollout makes neutralizing those a precondition for Close. Emulator wipe helpers stay destructive by design and are only for emulators the primary started.

## Architecture

| | Copy → verify → delete | **Archive in place (chosen)** |
|---|---|---|
| Close | multi-batch copy, verify, publish | one transaction on `system/lifecycle` |
| Start | multi-batch delete, reseed | one transaction: lifecycle plus roster profiles into an empty namespace |
| Partial-failure states | several | none |
| Bulk year deletion in production | yes, yearly | none |
| Cost | job framework and integrity checks | year-aware paths and rules for two locations |

The year number is the idempotency and staleness token. The epoch bumps only on Start.

## Storage and lifecycle

| Scope | Location |
|---|---|
| 2025 (legacy) | root `users`, `messages`, `reactions`, `lastRead`, `typing` |
| Year Y ≥ 2026 | `years/{Y}/users`, `…/messages`, `…/reactions`, `…/lastRead`, `…/typing` (no parent document) |
| Global, server-written | `system/lifecycle`, `authIdentities`, `participantIndex`, `pushTokens` |

Document shapes are unchanged. Rows from an earlier epoch in the global collections are inert and are overwritten on next use.

**`system/lifecycle`** — the only shape the new app writes (always a whole-document `tx.set`):

```js
{ epoch: number, state: 'active'|'closed', year: number, closedYears: number[],
  startedAt: string|null, closedAt: string|null, updatedAt: string }
```

**Server and client interpretation** — one pure function, `interpretLifecycle(data)`. Each field is validated independently; a missing `year` never changes how `state` is read.

| # | Document | Result |
|---|---|---|
| 1 | does not exist | `exists:false`, valid, year 2025, `active`, `epoch:null`, `closedYears:[]` (first admission or Close creates it at epoch 1) |
| 2 | `state` not exactly `'active'` or `'closed'` (missing, `'resetting'`, other) | **unavailable** |
| 3 | `epoch` missing, not an integer, or < 1 | **unavailable** |
| 4 | `year` key absent | year 2025 |
| 5 | `year` present but not an integer in 2025…9999 | **unavailable** |
| 6 | `closedYears` key absent | `[]` |
| 7 | `closedYears` present but not an array of strictly ascending integers in 2025…9999 | **unavailable** |
| 8 | `closed` with `year ∉ closedYears`; `active` with `year ∈ closedYears`; any listed year > `year` | **unavailable** |
| 9 | `year > 2025` with no listed year below it | **unavailable** |
| 10 | otherwise | as stored; absent `startedAt`/`closedAt` → `null` (informational) |

Unavailable on the server means every fenced operation returns 503 `SERVICE_UNAVAILABLE` and performs **zero writes**; Close, Start and admission all refuse. No path overwrites an unavailable document, so a legacy `resetting` state cannot be revived.

**Rules subset.** Rules cannot iterate a list, so they enforce less than the table.

- *Enforced by rules (any failure denies every read and write):* state not `active`/`closed`; `epoch` not an integer ≥ 1; `year` present but not an integer in range; `closedYears` present but not a list; `closed` without the year listed; `active` with the year listed; `year > 2025` with an empty list.
- *Server-only (not detected by rules):* non-integer or out-of-range list elements, duplicates, non-ascending order, and listed years above `year`.
- *Hard bounds that hold even for a server-only-malformed document:* a year is readable only if `2025 ≤ requested ≤ year` **and** it is the current year or listed; only the current year is ever writable.

So a document with a server-only list defect can leave already-admitted callers with rules access to the current year and to listed years at or below it, while the server refuses everything. It can never expose a future or unlisted year or make a non-current year writable. This narrow residual is accepted: valid metadata is written only by the server, and rollout stops on invalid existing metadata.

## Transition and error contracts

Both routes first require an admin and `assertYearTransitionsEnabled()`.

**Close(Y)** — one transaction; L is the interpreted lifecycle.

| Condition | Result |
|---|---|
| L unavailable | 503 `SERVICE_UNAVAILABLE`, no write |
| Y > L.year | 409 `YEAR_MISMATCH` |
| Y < L.year and Y ∈ L.closedYears | 200 `changed:false` |
| Y < L.year and Y ∉ L.closedYears | 409 `YEAR_MISMATCH` |
| Y = L.year, closed | 200 `changed:false` |
| Y = L.year, active | set `{epoch: L.epoch ?? 1, state:'closed', year:Y, closedYears: L.closedYears ∪ {Y} ascending, startedAt: L.startedAt, closedAt: now, updatedAt: now}` → 200 `changed:true` |

**Start(F → T)** — validation, then one transaction.

| Condition | Result |
|---|---|
| F or T not a valid year, or T ≤ F | 400 `INVALID_YEAR` |
| roster(T) missing; < 2 or > 200 entries; non-canonical or duplicate emails; duplicate names | 409 `ROSTER_NOT_CONFIGURED` |
| L unavailable | 503 `SERVICE_UNAVAILABLE` |
| L.year = T | 200 `changed:false` |
| L.year > T | 409 `STALE_REQUEST` |
| L.year ≠ F | 409 `YEAR_MISMATCH` |
| L.year = F, active | 409 `YEAR_NOT_CLOSED` |
| any of the five `years/T/{users,messages,reactions,lastRead,typing}` non-empty (`limit(1)` read in the transaction, each one) | 409 `YEAR_NOT_EMPTY` |
| otherwise | `tx.create` one profile per roster entry in `years/T/users`; `tx.set` each `participantIndex/{email}` to `{email, userId, epoch: L.epoch+1, createdAt}`; `tx.set` lifecycle `{epoch: L.epoch+1, state:'active', year:T, closedYears: L.closedYears, startedAt: now, closedAt: null, updatedAt: now}` → 200 `changed:true` |

**`AdmissionError` codes**

| Code | Status | Note |
|---|---|---|
| `UNAUTHENTICATED` | 401 | unchanged |
| `ACCESS_DENIED` | 403 | unknown email; not on the active year's roster; roster member with no profile in a closed year |
| `EMAIL_NOT_VERIFIED` | 403 | unchanged |
| `ADMIN_REQUIRED` | 403 | new |
| `PROFILE_CONFLICT` | 409 | unchanged |
| `YEAR_CLOSED` | 409 | new: "This year's exchange is closed and read-only." |
| `CLIENT_UPDATE_REQUIRED` | 409 | new: "A new version of the app is available. Reload the page (or close and reopen the app) to continue." |
| `TRANSITIONS_DISABLED` | 409 | new: "Year transitions are not enabled on this deployment." |
| `YEAR_NOT_CLOSED`, `YEAR_MISMATCH`, `STALE_REQUEST`, `ROSTER_NOT_CONFIGURED`, `YEAR_NOT_EMPTY` | 409 | new |
| `INVALID_YEAR` | 400 | new |
| `SERVICE_UNAVAILABLE` | 503 | includes an unavailable lifecycle |

Removed: `RESET_IN_PROGRESS`, `RESET_SUPERSEDED`. `/api/admin/reset` returns route-level 410 `RESET_RETIRED`. The client adds one local error code, `LIFECYCLE_MISMATCH` (see UserContext).

**Writer fence matrix**

| Writer | Open year | Closed year | Stale after Start |
|---|---|---|---|
| `/api/messages/send` | writes L.year `messages` | 409 `YEAR_CLOSED`, no admission write | re-admitted; old `senderUserId` → 403 `SENDER_MISMATCH`; old `toId` → 400 |
| recipient claim, lastRead, typing, reactions (rules) | L.year only | denied | denied; root and other years always denied |
| bootstrap / admission | links or creates a profile in L.year | identity/index only, never a `users` doc; no profile → `ACCESS_DENIED` | roster(L.year) decides |
| `/api/init`, `/api/dev/seed` | seeds roster(L.year) | `YEAR_CLOSED` | `YEAR_MISMATCH` if the year flips mid-run |
| `/api/dev/assign`, `/api/dev/inject-message` | L.year paths | `YEAR_CLOSED` | — |
| push register / unregister | allowed | allowed (device control; nothing is dispatched) | old epoch → 409 `STALE_REGISTRATION` |
| push dispatch / token cleanup | active and matching epoch | skipped | skipped |
| `/api/admin/reset` | 410 | 410 | 410 |

**Old installed clients.** After Close: reads continue, direct writes are denied, sends get 409 (already permanent in the outbox), Reset gets 410. After Start: a bootstrap without the header `x-secret-santa-client: 2` returns 409 `CLIENT_UPDATE_REQUIRED`, a terminal error card. Without this gate an old client would receive a 2026 profile, watch a root document that does not exist, and re-bootstrap in an unbounded loop.

## Proposed Changes

### Manifest

**Create — source (8)**

| File | SDK |
|---|---|
| `src/lib/year-paths.js` | none (pure) |
| `src/lib/year-client.js` | Client |
| `src/lib/archive-threads.js` | none (pure) |
| `src/hooks/useYearArchive.js` | Client |
| `src/hooks/useAdminYearActions.js` | Client (auth token only) |
| `src/components/ArchiveViewer.js` | Client component |
| `src/app/api/admin/year/close/route.js` | Admin |
| `src/app/api/admin/year/start/route.js` | Admin |

**Create — tests (12)**

- `__tests__/integration/helpers/emulator-admin.js`
- `__tests__/integration/firestore-rules-years.test.js`
- `__tests__/integration/year-lifecycle.test.js`
- `__tests__/unit/year_paths.test.js`
- `__tests__/unit/year_client.test.js`
- `__tests__/unit/archive_threads.test.js`
- `__tests__/unit/useYearArchive.test.js`
- `__tests__/unit/ArchiveViewer.test.js`
- `__tests__/unit/useAdminYearActions.test.js`
- `__tests__/unit/useTypingIndicator_scope.test.js`
- `__tests__/api/admin_year_api.test.js`
- `e2e/year-rollover.spec.ts`

**Modify — source and docs (31)**

- `firestore.rules`
- `src/lib/participants.js`
- `src/lib/participant-admission.js`
- `src/lib/firestore.js`
- `src/lib/push-server.js`
- `src/lib/lastReadClient.js`
- `src/lib/typing-client.js`
- `src/lib/reactions-client.js`
- `src/hooks/useTypingIndicator.js`
- `src/hooks/useUser.js`
- `src/context/UserContext.js`
- `src/context/RealtimeMessagesContext.js`
- `src/app/page.js`
- `src/components/AdminPanel.js`
- `src/components/AuthGuard.js`
- `src/components/RecipientSelector.js`
- `src/components/Sidebar.js`
- `src/components/TabNavigation.js`
- `src/components/ChatTabs.js`
- `src/app/api/admin/reset/route.js`
- `src/app/api/auth/bootstrap/route.js`
- `src/app/api/init/route.js`
- `src/app/api/dev/seed/route.js`
- `src/app/api/dev/inject-message/route.js`
- `src/app/api/messages/send/route.js`
- `scripts/lib/emulator-firestore.js`
- `scripts/wipe_db.js`
- `scripts/check_all_data.js`
- `CLAUDE.md`
- `AGENTS.md`
- `__tests__/integration/README.md`

**Modify — tests (33)**

- `__tests__/helpers/useUser-mock.js`
- `__tests__/context/RealtimeMessagesContext.test.js`
- `__tests__/unit/admin_ui.test.js`
- `__tests__/unit/app_flows.test.js`
- `__tests__/unit/auth_timing.test.js`
- `__tests__/unit/realtime_hooks.test.js`
- `__tests__/unit/unread_badge_clearing.test.js`
- `__tests__/unit/unread_logic.test.js`
- `__tests__/unit/lastReadClient.test.js`
- `__tests__/unit/lastReadClient-normalization.test.js`
- `__tests__/unit/typing-client.test.js`
- `__tests__/unit/reactions-client.test.js`
- `__tests__/unit/participants.test.js`
- `__tests__/unit/useUser_realtime.test.js`
- `__tests__/unit/Sidebar.test.js`
- `__tests__/unit/RecipientSelector.test.js`
- `__tests__/unit/emulator_scripts_config.test.js`
- `__tests__/lib/participant_admission.test.js`
- `__tests__/lib/firestore.test.js`
- `__tests__/lib/push_server.test.js`
- `__tests__/api/admin_reset_enhanced.test.js`
- `__tests__/api/auth_bootstrap_api.test.js`
- `__tests__/api/dev_assign_api.test.js`
- `__tests__/api/send_message_api.test.js`
- `__tests__/api/push_register_api.test.js`
- `__tests__/api/push_unregister_api.test.js`
- `__tests__/api/push_status_api.test.js`
- `__tests__/integration/participant-admission.test.js`
- `__tests__/integration/push-registration.test.js`
- `__tests__/integration/firestore_participants.test.js`
- `__tests__/integration/init.test.js`
- `__tests__/integration/firestore-rules-admission.test.js`
- `e2e/admission-and-reset.spec.ts`

**Delete (4, primary, ordinary file deletion)**

- `src/hooks/useAdminReset.js`
- `__tests__/unit/useAdminReset.test.js`
- `__tests__/integration/reset-fencing.test.js`
- `scripts/seed_users.js`

**Deliberately unchanged:** `src/lib/message-utils.js`, `src/lib/message-outbox.js`, `src/components/Chat.js`, `src/components/PublicFeed.js`, `src/lib/push-client.js`, `src/lib/sign-out.js`, the three push routes, `src/components/MessageOutboxRuntime.js`, `src/app/api/dev/assign/route.js`, `src/app/dev/login/page.js`.

**Removed exports and every caller**

| Removed | Callers to update |
|---|---|
| `getParticipantName` | `participant-admission.js`, `UserContext.js`; tests `participants`, `participant_admission` (mock), `useUser_realtime` (mock) |
| `getParticipantEmail`, `getParticipantNames` | `RecipientSelector.js`, `page.js`; test `participants` |
| `resetDatabase`, `resetAndReseedParticipants`, `APP_COLLECTIONS` (server) | `admin/reset/route.js`; tests `lib/firestore`, `admin_reset_enhanced`, `emulator_scripts_config`, integration `participant-admission`, `push-registration`, `firestore_participants`, `init`, `reset-fencing` (deleted) |
| `getUserByEmail`, `getAllUsers`, `createUser`, `updateUser` | `dev/seed/route.js`; tests `lib/firestore`, integration `init`, `firestore_participants` |
| `beginReset`, `assertResetOwner`, `completeReset`, `assertLifecycleActive` | `firestore.js`, `dev/inject-message/route.js`; test `lib/firestore` (mocks) |
| `ensureAllParticipants(list)`, `ensureParticipantProfiles(list, {resetId})` → no-argument forms | `init/route.js`, `dev/seed/route.js`, `firestore.js`; tests `participant_admission`, `lib/firestore`, integration `participant-admission`, `firestore_participants` |
| `useAdminReset` | `page.js`, `AdminPanel.js`, `RecipientSelector.js`; test `admin_ui` |
| context `notice`; `AuthGuard` prop `notice`; `AdminPanel` prop `onResetComplete`; `Sidebar` prop `onReset`; `RecipientSelector` prop `onReset` | `page.js`, `AuthGuard.js`, `useUser.js`; tests `useUser_realtime`, `Sidebar`, `admin_ui` |

### Server contracts

**`src/lib/year-paths.js`**

```js
export const LEGACY_YEAR = 2025;
export const YEAR_COLLECTIONS = ['users', 'messages', 'lastRead', 'typing', 'reactions'];
export const GLOBAL_COLLECTIONS = ['authIdentities', 'participantIndex', 'pushTokens'];
export function isValidYear(year)              // Number.isInteger && 2025 <= year <= 9999
export function yearCollectionPath(year, name) // 2025 -> [name]; else ['years', String(year), name]; throws on invalid year or name
export function yearDocPath(year, name, id)
export function interpretLifecycle(data)       // -> { exists, valid, state:'active'|'closed'|'unavailable', year, epoch, closedYears, startedAt, closedAt } per the table
export function lifecycleKey(value)            // value.valid === false -> 'invalid'; else `${year}:${state}:${epoch}`
```

**`src/lib/participants.js`** — keep `PARTICIPANTS` unchanged; add:

```js
export const YEAR_ROSTERS = {
    2025: PARTICIPANTS,
    2026: PARTICIPANTS.filter((participant) => participant.name !== 'Jana'),
};
export function getRoster(year)                // array, or null when not configured
export function getRosterName(year, email)     // case-insensitive; null if absent
export function getRosterEmail(year, name)
export function getRosterNames(year)           // [] when not configured
export function isKnownParticipantEmail(email) // on any roster
export function getNextRosterYear(year)        // smallest configured year > year, or null
```

Remove the three legacy helpers. A later year is added by a reviewed edit plus deploy; Start refuses an unconfigured year.

**`src/lib/participant-admission.js`** (Admin SDK). Add imports of `isAdmin` (`@/lib/config`), the roster helpers, and `LEGACY_YEAR`, `isValidYear`, `interpretLifecycle`, `yearCollectionPath`.

- `userRef(db, year, id)` / `yearUsers(db, year)` use `db.collection(yearCollectionPath(year, 'users').join('/'))`.
- `assertAdmissibleToken(decoded) → { uid, email }`: uid; canonical email without `/`; `isKnownParticipantEmail` else `ACCESS_DENIED`; verified email outside development. No Firestore read.
- Internal `resolveLifecycle(snap)`: interpretation plus `createLifecycle` (true only for a missing document); `!valid` → `SERVICE_UNAVAILABLE`.
- `resolveProfileInTransaction(tx, db, { year, state, email, name, epoch, indexSnap, oauthId, image })`:
  - An index row is current only if `index.epoch === epoch` with a non-empty `userId`; a stale-epoch row is treated as absent.
  - Current → read `userRef(db, year, userId)`; missing or email mismatch → `PROFILE_CONFLICT`.
  - Otherwise scan `yearUsers(db, year)` by email: none and closed → `ACCESS_DENIED`; none and open → `created`; one canonical match → `linked`; else `PROFILE_CONFLICT`.
- `applyProfileWrites`: lifecycle create writes `{epoch:1, state:'active', year:2025, closedYears:[], startedAt:null, closedAt:null, updatedAt}`; user create is `tx.create`; index write is `tx.set`.
- `admitParticipant(decoded, { requireLegacyYear = false } = {}) → { user, created, epoch, year, state, closedYears }`. In the transaction: `resolveLifecycle`; `requireLegacyYear && year !== 2025` → `CLIENT_UPDATE_REQUIRED` before any write; roster check; then as today.
- `resolveParticipant(decoded, { verifyIndex = false, requireLegacyYear = false } = {}) → { uid, email, user, epoch, year, state, closedYears }` with the same checks after its lifecycle read.
- `runFencedTransaction(decoded, work, { allowClosed = false } = {})`. Order: unavailable → 503; roster check; closed and `!allowClosed` → `YEAR_CLOSED`; identity/profile validity → admit once and retry as today; `work(tx, { uid, email, epoch, year, state, user })`.
- `ensureParticipantProfiles() → { year, created, linked, existing }`: one lifecycle read to fix `year` and roster (unavailable → 503; closed → `YEAR_CLOSED`; no roster → `ROSTER_NOT_CONFIGURED`); then one transaction per roster entry that re-reads the lifecycle (`year` changed → `YEAR_MISMATCH`; not active → `YEAR_CLOSED`).
- `assertYearOpen(tx) → { epoch, year }`: missing or unavailable → 503; closed → `YEAR_CLOSED`.
- `verifyAdminRequest(request) → decoded`: token; verified email outside development; `isAdmin` else `ADMIN_REQUIRED`.
- `assertYearTransitionsEnabled()`: passes when `process.env.YEAR_TRANSITIONS_ENABLED === 'true'` or `NODE_ENV === 'development'`; else `TRANSITIONS_DISABLED`.
- `closeYear({ year })`, `startNewYear({ fromYear, targetYear })` exactly per the tables. Start builds profiles `{ id: uuidv4(), name: toTitleCase(name), email, oauthId:null, image:null, recipientId:null, gifterId:null }` before the transaction. Neither takes hook parameters.
- Remove the reset protocol functions and `assertLifecycleActive`.

**`src/lib/firestore.js`** — reduced to:

```js
export async function assignUsersInTransaction(buildUpdates) // { year } = await assertYearOpen(tx); users at that year's path
export async function ensureAllParticipants()                // ensureParticipantProfiles()
```

**`src/lib/push-server.js`** — `registerPushToken` and `unregisterPushToken` call `runFencedTransaction(decodedToken, work, { allowClosed: true })`. Nothing else changes.

**Routes**

- `admin/reset/route.js`: `POST` returns 410 `{ error: 'Reset has been retired. Use Close year and Start new year.', code: 'RESET_RETIRED' }` unconditionally; only `NextResponse` is imported.
- `admin/year/close/route.js`, `admin/year/start/route.js`: `verifyAdminRequest` → `assertYearTransitionsEnabled` → parse JSON (failure → 400 `INVALID_YEAR`) → `isValidYear` checks → call. 200 `{ success:true, year, state, epoch, closedYears, changed }`; start adds `participants` (roster size when changed, else `null`). Other errors → 500 `{ error: 'The action did not complete. Check the current state and try again.', code: 'INTERNAL' }`, logging `error?.message` only.
- `auth/bootstrap/route.js`: `yearAware = request.headers.get('x-secret-santa-client') === '2'`; `resolveParticipant(decoded, { verifyIndex: true, requireLegacyYear: !yearAware })`; respond `{ success, user, year, yearState: state, epoch, closedYears }`.
- `init/route.js`: `ensureAllParticipants()`; drop the `PARTICIPANTS` import; add `year` to the JSON.
- `dev/seed/route.js`: `ensureAllParticipants()`; remove the `PARTICIPANTS` import and the read-back block; return `{ success, message, ...result }`.
- `dev/inject-message/route.js`: `{ year } = await assertYearOpen(tx)`; all refs through `yearCollectionPath`.
- `messages/send/route.js`: `work(tx, { user: sender, year })`; `recipientRef` and `messageRef` built from `yearCollectionPath(year, …).join('/')`.

### `firestore.rules` (full replacement)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function identityPath() { return /databases/$(database)/documents/authIdentities/$(request.auth.uid); }
    function lifecyclePath() { return /databases/$(database)/documents/system/lifecycle; }
    function lifecycle() { return get(lifecyclePath()).data; }
    // Absent `year` = the legacy 2025 exchange in the root collections. Absent closedYears = none.
    function lifecycleYear() { return lifecycle().get('year', 2025); }
    function lifecycleClosedYears() { return lifecycle().get('closedYears', []); }
    // Rules subset of the server validation: scalar fields, list type and state/membership
    // consistency. List element types and ordering are validated by the server only.
    function lifecycleValid() {
      return lifecycle().state in ['active', 'closed']
        && lifecycle().epoch is int && lifecycle().epoch >= 1
        && lifecycleYear() is int && lifecycleYear() >= 2025 && lifecycleYear() <= 9999
        && lifecycleClosedYears() is list
        && (lifecycle().state == 'closed') == (lifecycleYear() in lifecycleClosedYears())
        && (lifecycleYear() == 2025 || lifecycleClosedYears().size() >= 1);
    }
    function isAdmitted() {
      return request.auth != null
        && exists(identityPath())
        && lifecycleValid()
        && get(identityPath()).data.epoch == lifecycle().epoch;
    }
    // ys = year as a string: '2025' for the root collections, the {year} segment otherwise.
    function isScopedYear(ys) { return ys.matches('^[0-9]{4}$') && int(ys) > 2025; }
    function isCurrentYear(ys) { return isAdmitted() && int(ys) == lifecycleYear(); }
    // Never a future year, never an unlisted past year.
    function canReadYear(ys) {
      return isAdmitted()
        && int(ys) >= 2025 && int(ys) <= lifecycleYear()
        && (int(ys) == lifecycleYear() || int(ys) in lifecycleClosedYears());
    }
    function canWriteYear(ys) { return isCurrentYear(ys) && lifecycle().state == 'active'; }
    function myUserId() { return get(identityPath()).data.userId; }
    function userExists(ys, userId) {
      return (ys == '2025' && exists(/databases/$(database)/documents/users/$(userId)))
        || (ys != '2025' && exists(/databases/$(database)/documents/years/$(ys)/users/$(userId)));
    }
    function messageExists(ys, messageId) {
      return (ys == '2025' && exists(/databases/$(database)/documents/messages/$(messageId)))
        || (ys != '2025' && exists(/databases/$(database)/documents/years/$(ys)/messages/$(messageId)));
    }
    function userAfterHasGifter(ys, targetId, gifterId) {
      return (ys == '2025' && getAfter(/databases/$(database)/documents/users/$(targetId)).data.gifterId == gifterId)
        || (ys != '2025' && getAfter(/databases/$(database)/documents/years/$(ys)/users/$(targetId)).data.gifterId == gifterId);
    }
    function userAfterHasRecipient(ys, targetId, recipientId) {
      return (ys == '2025' && getAfter(/databases/$(database)/documents/users/$(targetId)).data.recipientId == recipientId)
        || (ys != '2025' && getAfter(/databases/$(database)/documents/years/$(ys)/users/$(targetId)).data.recipientId == recipientId);
    }
    function authMatchesUser(ys, userId) {
      return canWriteYear(ys) && myUserId() == userId && userExists(ys, userId);
    }
    function onlyChanges(fields) {
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(fields);
    }
    function isAllowedSelfRecipientSelection(ys, userId) {
      return authMatchesUser(ys, userId) && onlyChanges(['recipientId'])
        && resource.data.recipientId == null
        && request.resource.data.recipientId is string
        && request.resource.data.recipientId != userId
        && userAfterHasGifter(ys, request.resource.data.recipientId, userId);
    }
    function isAllowedRecipientClaimUpdate(ys, recipientUserId) {
      return onlyChanges(['gifterId'])
        && resource.data.gifterId == null
        && request.resource.data.gifterId is string
        && request.resource.data.gifterId != recipientUserId
        && authMatchesUser(ys, request.resource.data.gifterId)
        && userAfterHasRecipient(ys, request.resource.data.gifterId, recipientUserId);
    }
    function canReadLastRead(ys, lastReadId) {
      return isCurrentYear(ys)
        && (lastReadId.matches('^' + myUserId() + '_.+$')
          || (lastReadId.matches('^[^_]+_.+$') && !lastReadId.matches('^[^_]+_publicFeed_.*$')));
    }
    function isAllowedLastReadWrite(ys, lastReadId) {
      return request.resource.data.keys().hasOnly(['userId','conversationId','lastReadAt'])
        && request.resource.data.userId is string
        && request.resource.data.conversationId is string
        && request.resource.data.lastReadAt is timestamp
        && lastReadId == request.resource.data.userId + '_' + request.resource.data.conversationId
        && request.resource.data.lastReadAt <= request.time + duration.value(5, 'm')
        && authMatchesUser(ys, request.resource.data.userId);
    }
    function isMonotonicLastRead() {
      return !(resource.data.lastReadAt is timestamp)
        || request.resource.data.lastReadAt >= resource.data.lastReadAt;
    }
    function isAllowedTypingWrite(ys, typingId) {
      return request.resource.data.keys().hasOnly(['userId', 'conversationId', 'typingAt'])
        && request.resource.data.userId is string
        && request.resource.data.conversationId is string
        && request.resource.data.typingAt is string
        && authMatchesUser(ys, request.resource.data.userId)
        && typingId == (request.resource.data.conversationId + '_' + request.resource.data.userId);
    }
    // resource == null: deleting a nonexistent doc is a no-op.
    function isAllowedTypingDelete(ys) {
      return canWriteYear(ys)
        && (resource == null || (resource.data.userId is string && authMatchesUser(ys, resource.data.userId)));
    }
    function isAllowedReactionCreate(ys, reactionId) {
      return request.resource.data.keys().hasOnly(['messageId', 'userId', 'emoji', 'createdAt'])
        && request.resource.data.messageId is string
        && request.resource.data.userId is string
        && request.resource.data.emoji is string
        && request.resource.data.emoji.size() <= 4
        && request.resource.data.createdAt is string
        && authMatchesUser(ys, request.resource.data.userId)
        && reactionId == (request.resource.data.messageId + '_' + request.resource.data.userId + '_' + request.resource.data.emoji)
        && messageExists(ys, request.resource.data.messageId);
    }
    function isAllowedReactionDelete(ys) {
      return resource.data.userId is string && authMatchesUser(ys, resource.data.userId);
    }

    // Season metadata only (no participant data); server-written. Readable by any account that
    // has ever been admitted, so a tab whose admission just went stale still learns of a Start.
    match /system/lifecycle {
      allow get: if request.auth != null && exists(identityPath());
      allow list, write: if false;
    }

    // Root collections = the legacy 2025 exchange.
    match /users/{userId} {
      allow read: if canReadYear('2025');
      allow create, delete: if false;
      allow update: if isAllowedSelfRecipientSelection('2025', userId) || isAllowedRecipientClaimUpdate('2025', userId);
    }
    match /messages/{messageId} {
      allow read: if canReadYear('2025');
      allow create, update, delete: if false;
    }
    match /reactions/{reactionId} {
      allow read: if canReadYear('2025');
      allow create: if isAllowedReactionCreate('2025', reactionId);
      allow delete: if isAllowedReactionDelete('2025');
      allow update: if false;
    }
    match /lastRead/{lastReadId} {
      allow read: if canReadLastRead('2025', lastReadId);
      allow create: if isAllowedLastReadWrite('2025', lastReadId);
      allow update: if isAllowedLastReadWrite('2025', lastReadId) && isMonotonicLastRead();
      allow delete: if false;
    }
    match /typing/{typingId} {
      allow read: if isCurrentYear('2025');
      allow create, update: if isAllowedTypingWrite('2025', typingId);
      allow delete: if isAllowedTypingDelete('2025');
    }

    // 2026 onwards: one namespace per year.
    match /years/{year} {
      match /users/{userId} {
        allow read: if isScopedYear(year) && canReadYear(year);
        allow create, delete: if false;
        allow update: if isScopedYear(year)
          && (isAllowedSelfRecipientSelection(year, userId) || isAllowedRecipientClaimUpdate(year, userId));
      }
      match /messages/{messageId} {
        allow read: if isScopedYear(year) && canReadYear(year);
        allow create, update, delete: if false;
      }
      match /reactions/{reactionId} {
        allow read: if isScopedYear(year) && canReadYear(year);
        allow create: if isScopedYear(year) && isAllowedReactionCreate(year, reactionId);
        allow delete: if isScopedYear(year) && isAllowedReactionDelete(year);
        allow update: if false;
      }
      match /lastRead/{lastReadId} {
        allow read: if isScopedYear(year) && canReadLastRead(year, lastReadId);
        allow create: if isScopedYear(year) && isAllowedLastReadWrite(year, lastReadId);
        allow update: if isScopedYear(year) && isAllowedLastReadWrite(year, lastReadId) && isMonotonicLastRead();
        allow delete: if false;
      }
      match /typing/{typingId} {
        allow read: if isScopedYear(year) && isCurrentYear(year);
        allow create, update: if isScopedYear(year) && isAllowedTypingWrite(year, typingId);
        allow delete: if isScopedYear(year) && isAllowedTypingDelete(year);
      }
    }

    // Deny any other collections by default.
    match /{document=**} { allow read, write: if false; }
  }
}
```

### Client contracts

**`src/lib/year-client.js` — writable scope**

```js
export function setWritableScope(next)        // next: { key, year } | null. Same key keeps the existing object; otherwise stores Object.freeze({ key, year }).
export function getWritableScope()            // { key, year } | null; identity is stable per key
export function scopedDocRef(scope, name, id) // doc(firestore, ...yearDocPath(scope.year, name, id))
export function yearCollectionRef(year, name)
export function yearDocRef(year, name, id)
```

Rule for every direct writer: **capture the scope object when the action is requested, build refs only from the captured scope, and act only while `getWritableScope() === capturedScope`.** No writer resolves "the current year" at execution time.

**`src/context/UserContext.js`**

*Publication contract*

1. `stateRef.current` is the authoritative session state. React state is a mirror.
2. `applyState(updater)` is synchronous and uses no React functional updater:
   ```js
   const prev = stateRef.current;
   const next = typeof updater === 'function' ? updater(prev) : updater;   // pure; called exactly once
   if (next === prev) return;
   stateRef.current = next;
   setWritableScope(scopeFor(next));
   if (mountedRef.current) setState(next);
   ```
3. `scopeFor(state)` is `` { key: `${authUid}|${user.id}|${season.year}|${season.epoch}`, year: season.year } `` when `status === 'ready'` and `season.state === 'active'`; otherwise `null`.
4. `cancelSessionWork()` runs, in order: `setWritableScope(null)`, `cancelOutboxDrains()`, `cancelPushOperations()`, `resetLastReadState()`, `resetTypingState()`, `clearYearArchiveCache()`.
5. Every loss path calls `cancelSessionWork()` before publishing: the auth callback on uid change or sign-out, `handleProfileLoss`, a lifecycle reconciliation, and a fenced-out bootstrap response.
6. The auth effect's first statement is `setWritableScope(scopeFor(stateRef.current))` (restores the scope after a StrictMode remount). Its cleanup calls `setWritableScope(null)`.

*Lifecycle subscription, fence and reconciliation.* Four refs:

- `lifecycleSubRef = { id, unsubscribe, ended, attachedAtSeq }` — `id` is the subscription generation; `ended` is set by any listener error (the listener is dead after an error, permission-denied included); `attachedAtSeq` is the admission sequence at attach time.
- `admissionSeqRef` — number of accepted 2xx bootstrap responses in this auth session. Each one proves the caller's identity record now exists.
- `confirmedKeyRef` — key of the latest **server-confirmed** lifecycle snapshot in this auth session; `'invalid'` for an unavailable document; `null` when none has arrived or the document does not exist.
- `mismatchCountRef` — consecutive fenced-out bootstrap responses.

`unsubscribeLifecycle()` increments `id`, calls the stored unsubscribe and clears it.

`subscribeLifecycle()` calls `unsubscribeLifecycle()`, captures `id`, sets `ended = false` and `attachedAtSeq = admissionSeqRef.current`, and attaches `onSnapshot(doc(firestore, 'system', 'lifecycle'), { includeMetadataChanges: true }, next, error)`:

- `next(snapshot)`:
  1. `id !== lifecycleSubRef.current.id` → return (captured-generation guard).
  2. `snapshot.metadata.fromCache !== false` → return (cached data never moves the fence).
  3. `liveKey = snapshot.exists() ? lifecycleKey(interpretLifecycle(snapshot.data())) : null`.
  4. `liveKey === confirmedKeyRef.current` → return.
  5. `confirmedKeyRef.current = liveKey; mismatchCountRef.current = 0;` The fence follows the server in either direction, so a real environment reset moves it too.
  6. If `stateRef.current.status === 'ready'` and the published season's key differs from `liveKey` → `handleProfileLoss()`. In any other status nothing more happens; the next bootstrap response is fenced.
- `error(err)`:
  1. `id !== lifecycleSubRef.current.id` → return.
  2. `lifecycleSubRef.current.ended = true;` log the error.
  3. `maybeReattachLifecycle()`.

**Bounded reattach** — one rule, evaluated from both sides:

```js
function maybeReattachLifecycle() {
    const sub = lifecycleSubRef.current;
    if (firebaseUserRef.current && sub.ended && admissionSeqRef.current > sub.attachedAtSeq) {
        subscribeLifecycle();
    }
}
```

It is called from the listener's `error` callback (above) and from the 2xx bootstrap branch (below). Consequences:

- **Error first, then success:** the error sets `ended` with no newer admission, so nothing happens; the 2xx increments the sequence and reattaches.
- **Success first, then error:** the 2xx finds `ended` false and does nothing; the late error finds a newer admission than the one it was attached at, and reattaches.
- **Repeated denial:** the reattached listener records the current sequence. If it ends too, the sequence is not newer, so it stays stopped and logged until a genuinely later 2xx bootstrap.
- At most one reattach per accepted 2xx. This path never issues a bootstrap request and never retries on a timer.

Subscription lifetime (the listener lives for the whole signed-in auth session, not only while ready):

- auth callback, uid change or sign-out: `unsubscribeLifecycle()`, `confirmedKeyRef.current = null`, `mismatchCountRef.current = 0`, `admissionSeqRef.current = 0`; then `subscribeLifecycle()` if a user is present;
- auth effect mount with `firebaseUserRef.current` already set (StrictMode remount): `subscribeLifecycle()`;
- auth effect cleanup: `unsubscribeLifecycle()`.

*Bootstrap 2xx branch* — after the existing latest-request check and after validating the response fields and building `season`:

```js
admissionSeqRef.current += 1;
maybeReattachLifecycle();

const confirmed = confirmedKeyRef.current;
if (confirmed !== null && lifecycleKey(season) !== confirmed) {
    cancelSessionWork();                                   // scope is null from here on
    mismatchCountRef.current += 1;
    if (mismatchCountRef.current >= 3) {
        mismatchCountRef.current = 0;
        applyState((prev) => ({ ...prev, status: 'error', user: null, authUid: null, season: null,
            error: { code: 'LIFECYCLE_MISMATCH', message: 'The exchange changed while loading. Please try again.' } }));
        return;
    }
    applyState((prev) => ({ ...prev, status: 'loading', user: null, authUid: null, season: null, error: null }));
    scheduleRetry(generation, sequence, 'initial', mismatchCountRef.current - 1);   // 1 s, then 2 s
    return;
}
mismatchCountRef.current = 0;
// publish ready with user, authUid and season
```

Resulting guarantees:

- A ready, writable state is published only when the response equals the latest server-confirmed lifecycle, or when nothing has been confirmed yet. In the second case the first confirmed snapshot re-checks it through step 6.
- After a server-confirmed Close or Start the session is either ready with exactly that season, or loading or in error with the scope `null`. An active composer cannot survive a confirmed Close.
- Healthy case: one re-bootstrap. If the response is ahead of a lagging listener, the listener catches up while the 1 s retry waits, and the retry matches.
- Persistent disagreement: exactly three bootstrap requests, then the `LIFECYCLE_MISMATCH` error card with **Try again**, which starts one new bounded cycle. There is no automatic loop.

*Other changes*

- Imports: `isKnownParticipantEmail` replaces `getParticipantName`; add `interpretLifecycle`, `lifecycleKey`, `setWritableScope`, `yearDocRef`, `resetTypingState`, `clearYearArchiveCache`.
- State gains `season: null | { year, state, epoch, closedYears }`; `notice` is removed. Every transition that sets `user: null` sets `season: null`.
- Bootstrap sends `'X-Secret-Santa-Client': '2'`. A 2xx also needs an integer `data.year`, an integer `data.epoch` and `yearState` of `active`/`closed`; otherwise it is a transient failure and does not count as an admission. The 503 reset-notice branch is removed.
- Profile subscription uses `yearDocRef(season.year, 'users', userId)`, keyed on `[authUid, userId, season.year]`.
- Context value: `{ user, authUid, authEmail, season, loading, error, refreshUser }`.

**`src/lib/lastReadClient.js`**

- **Single liveness guard**, used by every result path:
  ```js
  function isTokenLive(token) {
      if (token.generation !== stateGeneration) return false;
      if (getWritableScope() !== token.scope) return false;
      const entry = pending.get(token.key);
      return !!entry && entry.entryId === token.entryId && entry.inFlight === true;
  }
  ```
- `settle(token, outcome)` begins with `if (!isTokenLive(token)) return undefined;`, replacing its two current checks. A result that is not live changes nothing: no cache, `remoteSeen` or `pending` mutation, no timer, no log.
- `handleRejection(token, error)` keeps `isTokenLive` as its first statement, before any logging. The confirmation read is `getDoc(scopedDocRef(token.scope, 'lastRead', token.key))`; it is reached only while the token's scope is still current, and the existing post-await and catch-path `isTokenLive` checks stay.
- `updateLastReadTimestamp`: capture `scope = getWritableScope()`; no scope → `false` before touching the cache. A new entry stores `scope`. An existing entry whose scope differs is deleted and replaced.
- `startWrite(entry)`: `getWritableScope() !== entry.scope` → delete the entry and return `null`. The token stores `scope: entry.scope`. The write goes to `scopedDocRef(entry.scope, 'lastRead', entry.key)`.
- `flushPendingWrites`: an entry whose scope is not current is deleted, neither started nor flagged.
- `getLastReadTimestamp`: capture scope; none → cached value or epoch; after the await, discard if the generation or the scope changed.
- `subscribeToLastRead`: capture scope; none → no-op unsubscribe; the callback ignores snapshots once the scope changed.
- `resetLastReadState` is unchanged.

**`src/lib/typing-client.js`**

- `setTyping`: capture scope; none → return. The immediate write and the trailing-timer closure hold the captured scope; `writeTyping` returns without writing if `getWritableScope() !== scope`.
- `clearTyping`: capture scope; always clear local timers; send `deleteDoc(scopedDocRef(scope, 'typing', key))` only when a scope exists.
- New `export function resetTypingState()`: clears all trailing timers and both maps.

**`src/lib/reactions-client.js`** — capture scope first; none → `throw new Error('Reactions are unavailable right now')`. After the `getDoc` await, re-check identity and throw the same error instead of writing if it changed.

**`src/hooks/useTypingIndicator.js`** — capture scope in the effect; none → no subscription; ignore snapshots after a scope change.

**`src/context/RealtimeMessagesContext.js`** — read `season`; `year = season?.year ?? null`, `yearOpen = season?.state === 'active'`. Both listener effects produce empty arrays and loading false unless `userId && yearOpen`; otherwise they listen on `yearCollectionRef(year, 'messages'|'reactions')` with the existing ordering. Dependencies: `[userId, authLoading, year, yearOpen, retry]`.

**`src/hooks/useYearArchive.js`**

```js
export function clearYearArchiveCache()                    // archiveGeneration += 1; cache.clear()
export function useYearArchive({ authUid, year, immutable })
// -> { status: 'idle'|'loading'|'ready'|'error', data: { users, messages, reactions } | null, reload }
```

- No `authUid` or invalid year → `idle`.
- Cache key `` `${authUid}:${year}` ``. A hit → `ready` with no reads.
- A miss → `loading`, capture `archiveGeneration`, then `Promise.all` of three `getDocsFromServer(yearCollectionRef(year, name))` calls for `users`, `messages`, `reactions`. No `orderBy`, no limit, no cache fallback, no listeners.
- On completion, in this order:
  1. effect no longer active → do nothing;
  2. generation changed → `error`, nothing cached;
  3. any snapshot with `metadata.fromCache === true` or `metadata.hasPendingWrites === true` → `error`, nothing cached, nothing displayed;
  4. otherwise map rows to `{ ...data, id: data.id ?? doc.id }`, cache **only if `immutable`**, report `ready`.
- Any rejection, offline included → `error`, nothing cached, no partial data. No automatic retry.
- `reload()` deletes the key's cache entry and reruns all three reads.
- Returned data is tagged with its key; a result for a different uid or year reads as `loading`.

**`src/lib/archive-threads.js`** — `buildArchiveView({ users, messages }) → { pairings, threads }`, `UNSORTED_THREAD_ID = '__unsorted__'`.

- Names come from that year's `users`; `'Unknown'` for a missing profile.
- Pairings from `buildAssignmentMap(users)`; one `pair` thread seeded per pairing, titled `` `🎁 ${recipientName}'s gift exchange · Santa: ${santaName}` ``.
- Per message, by `resolveMessageConversation(msg, assignments)`:
  - `unroutable` → the single `unsorted` thread (`Other messages`), label `` `${from} → ${to}` ``;
  - ambiguous → thread `` `ambiguous:${getLegacyConversationId(fromId, toId)}` ``, title `` `${A} & ${B} · direction unknown` ``, label is the sender's name; never merged into a pair thread, never labelled Santa;
  - otherwise → the thread for `resolved.conversationId`; label `` `🎅 ${santaName} (Santa)` `` when `isSantaMsg`, else the sender's name.
- Messages ascending by parsed timestamp, invalid or missing last, ties by id. Threads with messages by latest descending, then empty pair threads by title, `unsorted` last.
- Invariant: messages across all threads equal the input count.

**`src/components/ArchiveViewer.js`** — props `{ authUid, years, initialYear, closedYears, onBack = null, banner = null }`. Imports only React, `useYearArchive`, `buildArchiveView`, `ReactionChips`.

- Header row, always visible:
  - when `onBack` is provided, a button with text `← Back to current year` and `aria-label="Back to current year"` that calls `onBack()`;
  - heading `` `📚 ${year} Archive` ``;
  - `<select aria-label="Archive year">` when `years.length > 1`.
- Optional banner, then the note `Read-only. Pairings are shown because this exchange is over.`
- **Pairings** rows `🎅 {santa} → 🎁 {recipient}`, or `No pairings were recorded.`
- **Conversations** rows with title and last-message preview or `No messages`.
- Thread view: a separate button `← Back` with `aria-label="Back to conversations"` that returns to the conversation list only. Each message shows label, plain-text content (`whiteSpace: 'pre-wrap'`), absolute date or `Unknown date`, and `<ReactionChips messageId={message.id} allReactions={data.reactions} currentUserId={null} onToggle={null} />`.
- States: `Loading {year}…`; `Could not load {year}. Check your connection and try again.` with a `Try again` button calling `reload`.
- Test ids: `archive-viewer`, `archive-pairing`, `archive-thread`, `archive-message`.
- It calls `useYearArchive({ authUid, year, immutable: closedYears.includes(year) })`.

**`src/hooks/useAdminYearActions.js`** — `useAdminYearActions({ onComplete }) → { closeYear(year), startYear(fromYear, targetYear, rosterNames), busy }`.

- Close prompt (`window.prompt`): `` `Close the ${year} exchange?\n\nAll ${year} chats become read-only for everyone, and the ${year} pairings become visible to all participants in the archive. This cannot be reopened from the app.\n\nType ${year} to confirm.` ``
- Start prompt: `` `Start the ${targetYear} exchange?\n\n${rosterNames.length} participants: ${rosterNames.join(', ')}.\nAnyone not on this list loses access to the app. Everyone picks a new recipient. ${fromYear} stays in Archives.\n\nType ${targetYear} to confirm.` ``
- Proceed only when the trimmed input equals the year string. POST JSON `{ year }` or `{ fromYear, targetYear }` with `Authorization` and `Content-Type` headers.
- Toasts: `` `${year} is now closed (read-only).` `` / `` `Failed to close ${year}: ${message}` `` / `` `${targetYear} has started.` `` / `` `Failed to start ${targetYear}: ${message}` ``.
- Call `onComplete` on success; ignore re-entry while busy.

**UI components**

- `AdminPanel.js`: props `{ userEmail, season, onComplete }`; `null` unless admin and season set. Active → button `` `Close ${year}` `` (title `` `Close the ${year} exchange (read-only)` ``). Closed → `next = getNextRosterYear(year)`; button `` `Start ${next}` `` (title `` `Start the ${next} exchange` ``) calling `startYear(year, next, getRosterNames(next))`, or the muted text `No next-year roster`. Disabled while busy.
- `AuthGuard.js`: remove the `notice` prop, its block and the `AdminPanel` import.
- `RecipientSelector.js`: add props `year`, `adminControl = null`, `onBrowseArchive = null`; remove `onReset`, `useAdminReset`, `isAdmin` and the red button. Use `getRosterNames(year)`, `getRosterEmail(year, name)`, `yearCollectionRef(year, 'users')`, `yearDocRef(year, 'users', currentUser.id)`. Render `{adminControl}`, a `Browse past years` button when `onBrowseArchive` is set, and the line `` `${year} exchange` ``. The reciprocal transaction is otherwise unchanged.
- `Sidebar.js`: remove `onReset` and the `isAdmin` import; add `adminControl = null` (rendered where the reset button was) and `showArchive = false` (item `📚 Archives`, `onTabChange('archive')`).
- `TabNavigation.js`: add `showArchive = false` and a `📚 Archives` tab calling `onTabChange('archive')`.
- `ChatTabs.js`: add props `archiveYears = []`, `closedYears = []`, and the branch:
  ```jsx
  if (activeTab === 'archive') {
      return (
          <ArchiveViewer
              key="archive"
              authUid={authUid}
              years={archiveYears}
              initialYear={archiveYears[0]}
              closedYears={closedYears}
          />
      );
  }
  ```
- `useUser.js`: doc comment only.

**`src/app/page.js`**

- Read `season` from `useUser()`. Derive `yearOpen = season?.state === 'active'`, `seasonYear = season?.year ?? null`, `closedYears = season?.closedYears ?? []`, `archiveYears = [...closedYears].sort((a, b) => b - a)`. Remove `useAdminReset`, `getParticipantNames`, `notice`. Add `const [showArchive, setShowArchive] = useState(false);`.
- `const adminControl = <AdminPanel userEmail={currentUser?.email} season={season} onComplete={refreshUser} />;`
- Render `MessageOutboxRuntime` only when `yearOpen`. The push and sound runtimes are unchanged.

*Users fetch — scoped, guarded, derived.* The two state variables `allUsers` and `availableRecipients` are removed and replaced by one key-tagged result plus derivation:

```js
const EMPTY_USERS = [];   // module scope

const usersScopeKey = currentUser && yearOpen
    ? `${authUid}|${currentUser.id}|${seasonYear}|${season.epoch}`
    : null;
const [usersResult, setUsersResult] = useState({ key: null, users: EMPTY_USERS });

useEffect(() => {
    if (!usersScopeKey) return undefined;
    let active = true;
    getDocs(yearCollectionRef(seasonYear, 'users'))
        .then((snapshot) => {
            if (!active) return;
            setUsersResult({ key: usersScopeKey, users: snapshot.docs.map((d) => d.data()) });
        })
        .catch((error) => {
            if (active) console.error('Failed to fetch users:', error);
        });
    return () => { active = false; };
}, [currentUser, usersScopeKey, seasonYear]);

const usersLoaded = usersScopeKey !== null && usersResult.key === usersScopeKey;
const allUsers = usersLoaded ? usersResult.users : EMPTY_USERS;
const currentUserName = currentUser?.name ?? '';
const availableRecipients = useMemo(() => {
    if (!usersLoaded) return [];
    const mine = currentUserName.toLowerCase();
    return getRosterNames(seasonYear).filter((name) => {
        if (name.toLowerCase() === mine) return false;
        const row = allUsers.find((u) => u?.name?.toLowerCase() === name.toLowerCase());
        return !(row && row.gifterId);
    });
}, [usersLoaded, allUsers, currentUserName, seasonYear]);
```

What this guarantees:

- Every effect run has its own `active` flag, so a response from an earlier run (earlier year, earlier account, or an earlier refetch in the same scope) is dropped when it arrives.
- A stored result is used only when its key equals the current key. On the first render after an account or year change, before the new fetch finishes, `allUsers` is the empty constant and `availableRecipients` is `[]`; no previous-scope row or candidate is rendered.
- The effect still reruns when the `currentUser` object changes, so a same-scope assignment change refetches as today, and the previous same-scope rows stay visible until the new result lands.
- State is set only inside promise callbacks, never synchronously in the effect body.
- The selection rules are the existing ones (roster names minus self minus names whose row has a `gifterId`). The rules-fenced reciprocal claim in `RecipientSelector` is unchanged and nothing is assigned automatically.

*Body, in this order.* Branches 1 and 2 use a standalone layout: `<main className="container" style={{ flexDirection: 'column' }}>` with a top row of greeting, `{adminControl}` and Sign out.

1. Year not open:
   ```jsx
   <ArchiveViewer
       authUid={authUid}
       years={archiveYears}
       initialYear={season.year}
       closedYears={closedYears}
       banner={`The ${season.year} exchange is closed. You can browse it below; chats reopen when the next year starts.`}
   />
   ```
2. `needsRecipient && showArchive && archiveYears.length > 0`:
   ```jsx
   <ArchiveViewer
       authUid={authUid}
       years={archiveYears}
       initialYear={archiveYears[0]}
       closedYears={closedYears}
       onBack={() => setShowArchive(false)}
   />
   ```
3. `needsRecipient`:
   ```jsx
   <RecipientSelector
       currentUser={currentUser}
       availableRecipients={availableRecipients}
       year={season.year}
       onComplete={refreshUser}
       adminControl={adminControl}
       onBrowseArchive={archiveYears.length > 0 ? () => setShowArchive(true) : null}
   />
   ```
4. Otherwise the existing layout, with these changes: `Sidebar` loses `onReset` and gains `adminControl={adminControl}` and `showArchive={archiveYears.length > 0}`; the mobile header renders `{adminControl}` where `AdminPanel` was; `TabNavigation` gains `showArchive={archiveYears.length > 0}`; `ChatTabs` keeps its existing props (with `allUsers={allUsers}` now the derived value) and gains `archiveYears={archiveYears}` and `closedYears={closedYears}`.

`AuthGuard` no longer receives `notice`.

### Scripts and documentation

- `scripts/lib/emulator-firestore.js`: add `clearEmulatorFirestore()` — `ensureEmulatorHost()`, then `fetch('http://' + host + '/emulator/v1/projects/' + EMULATOR_PROJECT_ID + '/databases/(default)/documents', { method: 'DELETE' })`, throwing on a non-OK response. Keep `APP_COLLECTIONS`; its comment becomes `// Root (legacy 2025) and global collection names, for diagnostics.`
- `scripts/wipe_db.js`: replace the deletion loop and lifecycle write with `await clearEmulatorFirestore()` and print `emulator database cleared`.
- `scripts/check_all_data.js`: also print lifecycle `year` and `closedYears`; when `year > 2025`, print counts for the five `years/{year}/…` collections.

**`AGENTS.md`** — replace this Safety bullet:

> - Local development and checks use the Firebase emulators by default. `.firebaserc` defaults to `xmasteak-app`, which is not a `demo-` project, and `scripts/seed_users.js` connects to production when `FIRESTORE_EMULATOR_HOST` is unset and production credentials are in the environment. Target the emulator explicitly.

with:

> - Local development and checks use the Firebase emulators by default. `.firebaserc` defaults to `xmasteak-app`, which is not a `demo-` project. Target the emulator explicitly. The integration and end-to-end suites and `scripts/wipe_db.js` clear the whole emulator database; run them only against emulators the primary started.

**`__tests__/integration/README.md`** — replace the `reset-fencing.test.js` line with:

> - **year-lifecycle.test.js**: Close/Start transitions, idempotency, atomic failure, held-transaction races, roster exclusion, old-client and delayed-send fences, and a second rollover
> - **firestore-rules-years.test.js**: Year-scoped read/write rules, closed-year immutability, skipped- and future-year denial, and malformed lifecycle metadata

**`CLAUDE.md`** — exact replacements:

1. In *Authentication & User Management*, replace items 3–4 and the paragraph after them with:

   > 3. `src/lib/participant-admission.js` reads `system/lifecycle`, checks the email against that year's roster in `src/lib/participants.js` (and `email_verified` outside development), then atomically resolves or creates the UUID profile in that year's `users` collection and writes a server-only `authIdentities/{authUid}` record. In a closed year it links an existing profile but never creates one.
   > 4. Firestore rules admit only callers whose admission record matches the current `system/lifecycle` epoch. Emails not on the active year's roster get ACCESS_DENIED.
   >
   > Clients never create `users` documents. Profile UUIDs are new every year. Open clients watch `system/lifecycle` and re-bootstrap after a server-confirmed Close or Start. To remove a participant mid-season, remove them from that year's roster and delete their `authIdentities` document.

2. Replace the body of *Participant Management* with:

   > `src/lib/participants.js` is the source of truth:
   > - `PARTICIPANTS`: registry of every known `{ name, email }`
   > - `YEAR_ROSTERS`: who takes part in each year; a year with no roster cannot be started and admits nobody
   > - Helpers: `getRoster()`, `getRosterName()`, `getRosterEmail()`, `getRosterNames()`, `isKnownParticipantEmail()`, `getNextRosterYear()`
   > - Used for authorization, recipient selection, and seeding each new year

3. In *Data Model*, insert before `**users collection:**`:

   > **Year storage:** the 2025 exchange lives in the root collections `users`, `messages`, `reactions`, `lastRead`, `typing`. Every later year lives in `years/{year}/…` with the same five collection names and document shapes. Build paths only with `src/lib/year-paths.js`. The app never writes to a closed year.

4. Replace the sentence beginning `**Server-only collections**` through `…{ epoch, state, resetId, resetStartedAt, updatedAt }`. with:

   > **Server-written collections**: `authIdentities/{authUid}` `{ uid, email, userId, epoch, createdAt, updatedAt }`; `participantIndex/{email}` `{ email, userId, epoch, createdAt }` (clients cannot read either); `system/lifecycle` `{ epoch, state: 'active'|'closed', year, closedYears, startedAt, closedAt, updatedAt }` (readable by accounts that have been admitted, never writable by clients; a missing `year` means 2025; the server treats any other shape as unavailable and writes nothing).

5. In *API Routes*, replace the bootstrap, init and admin/reset bullets with:

   > - **POST /api/auth/bootstrap**: Resolve or create the caller's profile and admission record; returns the user plus `year`, `yearState`, `epoch`, `closedYears`. Requires a Bearer token. Clients send `X-Secret-Santa-Client: 2`; without it the route answers only while the active year is 2025.
   > - **POST /api/init**: Seed the active year's roster. No auth in development; requires an admin Bearer token in production. Refused in a closed year.
   > - **POST /api/admin/reset**: Retired. Always returns 410 `RESET_RETIRED`.
   > - **POST /api/admin/year/close**: Body `{ year }`. Makes that year read-only in one transaction. Admin only; idempotent.
   > - **POST /api/admin/year/start**: Body `{ fromYear, targetYear }`. Requires `fromYear` closed and a roster for `targetYear`; creates the new year's profiles and bumps the epoch in one transaction. Admin only; idempotent.

6. In *Key Files*, replace the `src/lib/firestore.js` line with:

   > - `src/lib/firestore.js`: Server helpers (`ensureAllParticipants`, `assignUsersInTransaction`)
   > - `src/lib/year-paths.js`: Year storage layout and lifecycle interpretation (pure; shared by client and server)
   > - `src/components/ArchiveViewer.js`: Read-only view of closed years

7. In *Important Notes*, add:

   > - Year lifecycle: `Close year` and `Start new year` are the only season transitions. The app has no bulk reset or deletion of year data and never writes to a closed year; the open year keeps its normal writes (messages, pairing claims, read markers, and adding or removing typing and reaction documents). Both admin routes require `YEAR_TRANSITIONS_ENABLED=true` outside development.
   > - Firestore rules allow reads of the current year and of earlier years listed in `closedYears`, never a later year, and writes only in the single open year.

   and replace the anonymity bullet's first two sentences with:

   > - **Anonymity is a trust model, not a hard guarantee.** The Public Feed and Santa/Recipient split hide identities in the UI for the open year, but `messages` are readable by any admitted participant, so identities are technically discoverable by inspecting raw data. Closing a year reveals its pairings to all admitted participants in the archive.

### Tests

All synthetic. No test file may contain a participant email literal; the two existing ones noted below are removed.

**`__tests__/integration/helpers/emulator-admin.js`**

- `clearEmulatorFirestore()` — loopback guard, then the REST DELETE for project `xmasteak-app`.
- `snapshotCollections(firestore, paths)` → sorted `{ path, id, data }` for deep equality.
- `syntheticParticipantsModule()` → a full replacement for `@/lib/participants` with rosters 2025 = a, b, c, d; 2026 = a, b, c; 2027 = a, b, e (all `@example.test`), used as `jest.mock('@/lib/participants', () => require('./helpers/emulator-admin').syntheticParticipantsModule())`.
- `interceptNextTransaction(firestore, { afterWork, failAfterWork })` — a test-only wrapper: spies `firestore.runTransaction` once and delegates to the real method with a decorated callback that runs the original, awaits `afterWork()`, then throws `failAfterWork` if given. No production hook is added.

**Held-transaction pattern** (every race below): start A through `interceptNextTransaction` with `afterWork` signalling "reached" and awaiting a gate; await "reached"; start B without awaiting it; open the gate; `await Promise.allSettled([A, B])`; assert invariants that hold under either serialization. No sleeps.

**`__tests__/integration/year-lifecycle.test.js`** (Admin SDK, synthetic rosters). `H` = deep snapshot of root `users`, `messages`, `reactions`, seeded with pairings, messages and reactions.

- Server interpretation, zero writes: `closeYear`, `startNewYear`, `admitParticipant`, `ensureParticipantProfiles` and the send route against each of `{state:'resetting'}` without a year, a null year, a missing epoch, out-of-order `closedYears`, duplicate entries, a string element, and a listed year above `year` → 503, and a snapshot of the lifecycle, `participantIndex`, `authIdentities` and `H` is deep-equal afterwards.
- Missing lifecycle: `closeYear(2025)` creates the closed document at epoch 1; Start before Close → `YEAR_NOT_CLOSED`.
- Close: `changed:true` then `changed:false`; epoch unchanged; `H` unchanged.
- After Close: send → 409 with no document and no identity write; dev assign/inject and seeding → `YEAR_CLOSED`; push status, register and unregister succeed; bootstrap returns `yearState:'closed'`; a roster member whose profile was removed → `ACCESS_DENIED` and no `users` write.
- **Atomic failure:** Start with `failAfterWork` → rejects; lifecycle, `participantIndex` and `H` deep-equal to before; all five `years/2026/*` collections empty. The same for Close. A plain retry then succeeds with exactly roster-size profiles.
- Start: profiles equal the 2026 roster with null pairings; index rows at the new epoch each pointing at an existing 2026 profile; `H` unchanged; the excluded member's bootstrap → `ACCESS_DENIED` while their 2025 rows remain.
- `YEAR_NOT_EMPTY`: five cases, one pre-seeded document in each target collection → refused, nothing else written.
- Transition tables: every row, including `STALE_REQUEST`, `YEAR_MISMATCH` (gap year and never-closed year), `ROSTER_NOT_CONFIGURED`, `INVALID_YEAR`.
- Held races:
  - Start vs Start and Close vs Close: exactly one `changed:true`; exact profile count; every index row resolves.
  - Close vs send: `status === 200` exactly when the message exists; lifecycle closed at the end.
  - Admission vs Start: one 2026 profile per roster email; the held identity is either stale or points at a 2026 profile; none for the excluded email.
  - Seeding one missing profile vs Close: the profile exists exactly when seeding did not throw `YEAR_CLOSED`.
- Old clients: bootstrap without the header is 200 in 2025 and 409 `CLIENT_UPDATE_REQUIRED` with no identity write in 2026; delayed send with a 2025 `senderUserId` → 403, without it → 400; `years/2026/messages` empty; push status before Start then register after → `STALE_REGISTRATION`.
- Transitions gate: with `NODE_ENV` forced to `production` and the flag unset, both routes → 409 `TRANSITIONS_DISABLED`, nothing written.
- Reset route → 410; `H` unchanged.
- **Second rollover:** activity in 2026, Close 2026, Start 2027. `H` and the snapshot of `years/2026/{users,messages,reactions}` are deep-equal afterwards. Sends carrying 2025 ids and 2026 ids are both rejected in 2027. A participant returning in 2027 gets a new UUID.

**`__tests__/integration/firestore-rules-years.test.js`** (real rules)

- Legacy active with no `year`: existing behaviour.
- **Rules-enforced malformed lifecycle**, each denying every read and write: `resetting` without a year; null year; string year; missing epoch; `closedYears` not a list; `closed` without membership; `active` with the year listed; year 2026 with an empty list.
- **Future-listed year:** lifecycle `{epoch:1, state:'active', year:2026, closedYears:[2027]}` with documents seeded in `years/2027/*` → every read of 2027 denied. With `closedYears:[2025, 2027]` → 2025 readable, 2027 still denied.
- **Server-only list defects** (a duplicate entry; descending order; a string element): the test asserts only the hard bounds — no year above `year` and no unlisted year becomes readable, and no non-current year becomes writable. It does not assert a blanket denial.
- Closed 2025: root reads allowed; the claim transaction, lastRead create/update, typing set/delete and reaction create/delete all fail; `years/2026/*` reads and writes fail.
- Active 2026 with `closedYears:[2025]` and a matching identity: own-profile writes in `years/2026` succeed; root reads succeed; every root write fails; `years/2025`, `years/02026`, `years/2027`, `years/abc` denied; a 2026 reaction needs a 2026 message.
- **Skipped year:** lifecycle `{year:2028, closedYears:[2025,2026]}` with documents seeded in `years/2027/*` → every read denied.
- Second-rollover state `{year:2027, closedYears:[2025,2026]}`: reads of 2025 and 2026 allowed; every writer type denied against root and `years/2026`.
- Stale-epoch identity: everything denied, root included.
- lastRead and typing of non-current years unreadable.
- Lifecycle `get` allowed for an identity holder, denied for an outsider; list and write denied.

**New unit and API tests**

- `__tests__/unit/year_paths.test.js`: path table; every row of the interpretation table; `lifecycleKey`.
- `__tests__/unit/year_client.test.js`: same key keeps object identity; a new key replaces it; `null` clears; refs use the scope's year.
- `__tests__/unit/useYearArchive.test.js`:
  - only `getDocsFromServer` is called;
  - `immutable` results are cached and a second mount reads nothing;
  - non-immutable results are never cached;
  - one of three rejecting → `error`, no cache, no data;
  - a snapshot with `fromCache: true` → `error`, not cached;
  - a snapshot with `hasPendingWrites: true` → `error`, not cached, nothing displayed; a following `reload` with clean metadata → `ready` and cached;
  - `reload` refetches all three and bypasses the cache;
  - a held load followed by `clearYearArchiveCache()` is neither cached nor shown;
  - uid A's entry is not served to uid B;
  - a year switch mid-load discards the late result.
- `__tests__/unit/archive_threads.test.js`: mutual pairs stay two threads; ambiguous rows never labelled Santa; unroutable rows kept; a pairing with no messages listed; missing participant → `Unknown`; count invariant.
- `__tests__/unit/ArchiveViewer.test.js`:
  - renders pairings, threads and static reaction chips (no buttons);
  - with `onBack`, a `Back to current year` button is present in both the list and the thread view and clicking it calls `onBack` once; without `onBack` it is absent;
  - `Back to conversations` returns to the list and does not call `onBack`;
  - `Try again` calls reload;
  - no `setDoc`, `deleteDoc`, `onSnapshot`, outbox or typing call occurs.
- `__tests__/unit/useAdminYearActions.test.js`: exact request bodies and headers; a mistyped or cancelled prompt sends nothing; toasts; `onComplete`; busy guard.
- `__tests__/unit/useTypingIndicator_scope.test.js`: no subscription without a scope; subscribes at the captured year's path; ignores snapshots after a scope change.
- `__tests__/api/admin_year_api.test.js`: 401, 403 `ADMIN_REQUIRED`, `TRANSITIONS_DISABLED`, `INVALID_YEAR`, each mapped code, success shapes.

**Updated tests**

- **Season pattern.** `__tests__/helpers/useUser-mock.js` exports `LEGACY_ACTIVE_SEASON = { year: 2025, state: 'active', epoch: 1, closedYears: [] }`. Every mocked `useUser()` value with a user gains it, in `__tests__/context/RealtimeMessagesContext.test.js`, `__tests__/unit/admin_ui.test.js`, `__tests__/unit/app_flows.test.js`, `__tests__/unit/auth_timing.test.js`, `__tests__/unit/realtime_hooks.test.js`, `__tests__/unit/unread_badge_clearing.test.js` and `__tests__/unit/unread_logic.test.js`.
- **Scope pattern.** `__tests__/unit/lastReadClient.test.js`, `__tests__/unit/lastReadClient-normalization.test.js`, `__tests__/unit/typing-client.test.js` and `__tests__/unit/reactions-client.test.js` call `setWritableScope({ key: 'a', year: 2025 })` in `beforeEach` and `setWritableScope(null)` in `afterEach`. These are the only four tests that reach the real writers.
- `__tests__/unit/lastReadClient.test.js` added cases. Each changes the scope with `setWritableScope({ key: 'b', year: 2026 })` and does **not** call `resetLastReadState()`:
  - no scope → `updateLastReadTimestamp` returns `false` and the cache is untouched;
  - an entry enqueued under A whose debounce fires under B → no `setDoc`, entry removed;
  - a write under a 2026 scope goes to `('years', '2026', 'lastRead', key)`;
  - **late resolve:** `setDoc` held under A, scope becomes B, promise resolves → `remoteSeen` and cache unchanged, a B entry enqueued meanwhile keeps its own state and timers, no further `setDoc` for A after advancing timers;
  - **late reject, permission-denied:** held under A, scope becomes B, promise rejects → no `getDoc` confirmation read, no retry after advancing 60 s, no `console.error`;
  - **late reject, other error:** same expectations;
  - **confirmation in flight:** rejection under A starts the confirmation `getDoc` (at A's ref), scope becomes B, `getDoc` resolves → nothing applied, no retry, no log;
  - control: with A still current, the confirmation read uses A's ref and settles as today;
  - `flushPendingWrites` deletes an entry whose scope is not current.
- `__tests__/unit/typing-client.test.js`: a trailing write is dropped after a scope change; `clearTyping` without a scope sends no delete; `resetTypingState` cancels timers.
- `__tests__/unit/reactions-client.test.js`: a held `getDoc` across a scope change throws and writes nothing.
- `__tests__/context/RealtimeMessagesContext.test.js`: closed season → no listeners and empty data; 2026 active → `collection(firestore, 'years', '2026', 'messages')`.
- `__tests__/unit/useUser_realtime.test.js`:
  - participants mock becomes `isKnownParticipantEmail`; `doc` mock becomes `(db, ...segments)`;
  - bootstrap sends the header and publishes `season`;
  - the cancel test asserts all six steps with the scope cleared first;
  - **StrictMode** render: updaters run once; the scope and the lifecycle subscription are restored after remount;
  - a cache-only differing lifecycle snapshot does not move the fence and causes no bootstrap;
  - **healthy convergence:** ready at A, a server-confirmed B arrives → scope is `null` synchronously, exactly one bootstrap, a B response publishes ready with B;
  - **lagging listener:** a refresh response B while the fence is A → loading with scope `null`; the listener then confirms B and the 1 s retry publishes ready;
  - **persistent mismatch:** the fence stays at K1 while every response carries K0 → exactly three bootstrap requests, then `error.code === 'LIFECYCLE_MISMATCH'` with `user`, `season` and the scope all `null`; advancing timers causes no further request; `refreshUser` starts one new bounded cycle;
  - a held stale bootstrap response released after a reconciliation is ignored;
  - a snapshot or error delivered to a callback from a previous subscription generation (after an account switch) is ignored, causes no reattach, and the fence is `null` for the new uid;
  - **environment reset:** a server-confirmed missing document while ready → one re-bootstrap, fence `null`, the response is accepted;
  - **first admission, error then success:** the first lifecycle listener errors with `permission-denied` while the bootstrap is held; the 2xx then arrives → exactly one new lifecycle `onSnapshot` attach, bootstrap request count still 1, and a server-confirmed advance on the new listener triggers reconciliation;
  - **first admission, success then error:** the 2xx arrives first; the first listener's `permission-denied` is delivered afterwards → exactly one new attach, no extra bootstrap, and the new listener is live;
  - **repeated denial:** the reattached listener also errors → no further attach and no bootstrap, including after advancing timers; a later `refreshUser` 2xx → exactly one more attach;
  - a 2xx response without `year` is transient and causes no reattach;
  - remove the reset-notice test.
- `__tests__/unit/admin_ui.test.js` (mocks `ArchiveViewer`):
  - an admin with an active season sees `Close 2025` on the Welcome screen, and in both sidebar and mobile header once assigned;
  - a non-admin sees no Close or Start button;
  - a closed season shows `Start 2026`, the banner and the archive, with no chat;
  - Close with prompt `2025` POSTs `/api/admin/year/close` with `{"year":2025}` and refreshes;
  - Start with prompt `2026` POSTs `{"fromYear":2025,"targetYear":2026}`, and its prompt lists `getRosterNames(2026)` without the excluded name;
  - a wrong or cancelled prompt sends nothing;
  - `/api/admin/reset` is never called and no "Reset" text exists.
  - **Users-fetch scope** (new `describe` in this file, because it already renders the real Welcome screen with a controllable `getDocs`). Setup: `collection.mockImplementation((db, ...segments) => ({ path: segments.join('/') }))`; `getDocs.mockImplementation((ref) => held[ref.path].promise)` with one deferred per path; rows are built from roster names as `{ id, name, gifterId }`.
    - *Late older year:* render as an unassigned user named `getRosterNames(2026)[0]` in season 2025 (fetch for `users` held); rerender with a new profile id and season `{ year: 2026, state: 'active', epoch: 2, closedYears: [2025] }` (fetch for `years/2026/users`); resolve 2026 with nobody paired → the select lists exactly `getRosterNames(2026).slice(1)`; then resolve the 2025 fetch with every row paired → the options are unchanged and not empty.
    - *Account switch:* render as account A (unassigned) and resolve its fetch so that only one name N is unpaired → the select lists `[N]`; rerender as account B (different `authUid` and profile id, same year) with its fetch held → the select has only the placeholder option, not `[N]`; resolve B with nobody paired → the select lists the roster minus B's own name.
- `__tests__/unit/Sidebar.test.js` (this file already covers `TabNavigation`):
  - drop `onReset` and the `isAdmin` mock;
  - `Sidebar` renders a supplied `adminControl` node and nothing admin-related without one;
  - `Sidebar` with `showArchive` false has no Archives item; with true, clicking it calls `onTabChange('archive')` and `activeTab="archive"` gives it active styling;
  - `TabNavigation` with `showArchive` false has no Archives tab; with true, clicking it calls `onTabChange('archive')`.
- `__tests__/unit/RecipientSelector.test.js`: mock `@/lib/participants` with synthetic `getRosterNames`/`getRosterEmail`; replace the real name and email in the fixture with synthetic values; `doc` mock becomes `(firestore, ...segments)`. With `year={2025}`, `collection(firestore, 'users')`; with `year={2026}`, `collection(firestore, 'years', '2026', 'users')` and the matching `doc`. `adminControl` renders; `Browse past years` appears only with `onBrowseArchive` and calls it; no reset button. The three transaction tests stay.
- `__tests__/unit/participants.test.js`: remove the legacy-helper tests and their email literals. Assert: the 2025 roster equals the registry; the 2026 roster is the registry without the entry named `Jana`; round-trip lookups using roster entries; an unconfigured year gives `null` and `[]`; `isKnownParticipantEmail`; `getNextRosterYear`.
- `__tests__/unit/emulator_scripts_config.test.js`: compare the script list with `GLOBAL_COLLECTIONS ∪ YEAR_COLLECTIONS` as sets.
- `__tests__/lib/participant_admission.test.js`: participants mock exposes the new helpers; the fake database supports collection names containing `/` and `limit()`; remove the reset-protocol cases; add stale-index, closed-year, roster, `requireLegacyYear`, interpretation, `closeYear`, `startNewYear` cases.
- `__tests__/lib/firestore.test.js`: remove the reset and user-helper suites; mock `assertYearOpen`.
- `__tests__/lib/push_server.test.js`: register and unregister call `runFencedTransaction` with third argument `{ allowClosed: true }`.
- `__tests__/api/send_message_api.test.js`:
  - `useStore({ users, messages, sender, year = 2025 })` keys its store by the joined collection path and passes `year` and `state: 'active'` in the fake context;
  - with `year: 2026` the message is created under `years/2026/messages`, the recipient is read from `years/2026/users`, and the root store is untouched;
  - a recipient that exists only at root while the year is 2026 → 400;
  - `YEAR_CLOSED` → 409 without push, replacing the reset case;
  - the route calls `runFencedTransaction` without `allowClosed`.
- `__tests__/api/auth_bootstrap_api.test.js`: new response fields; `{ verifyIndex: true, requireLegacyYear: true }` without the header and `false` with it; mapping table with `YEAR_CLOSED`, `CLIENT_UPDATE_REQUIRED`, without `RESET_IN_PROGRESS`.
- `__tests__/api/dev_assign_api.test.js`, `__tests__/api/push_register_api.test.js`, `__tests__/api/push_unregister_api.test.js`, `__tests__/api/push_status_api.test.js`: replace the `RESET_IN_PROGRESS` → 503 case with `SERVICE_UNAVAILABLE` → 503; `dev_assign_api.test.js` also gains `YEAR_CLOSED` → 409.
- `__tests__/api/admin_reset_enhanced.test.js`: 410 with and without a token; no Firestore call.
- `__tests__/integration/participant-admission.test.js`, `__tests__/integration/push-registration.test.js`, `__tests__/integration/firestore_participants.test.js`, `__tests__/integration/init.test.js`: `clearEmulatorFirestore()` replaces `resetDatabase()`; reads go through the Admin SDK; `ensureAllParticipants()` takes no argument; drop the empty-list case; rewrite "re-admits after a reset" as "re-admits after Start with a new profile"; `init.test.js` takes names from `getRoster(2025)` and loses its email literal.
- `__tests__/integration/firestore-rules-admission.test.js`: lifecycle `get` succeeds for an admitted user; the reset case becomes an unknown-state case.
- `e2e/admission-and-reset.spec.ts`: remove the admin-reset test.

**`e2e/year-rollover.spec.ts`** — clears the emulator in `beforeAll` and `afterAll`.

- Seed and assign 2025; exchange a message and a reaction.
- Admin closes (dialog accepted with `2025`): a second open browser shows the banner and the 2025 archive with pairings and no composer, without a reload; `/api/messages/send` → 409.
- Admin starts 2026: the second browser reaches `Welcome, …` with a new profile id, without a reload.
- From Welcome: `Browse past years` shows 2025 before a recipient is chosen; `Back to current year` returns to the Welcome screen without a reload.
- The excluded participant (registry minus `getRoster(2026)`) sees Access Denied; a 2026 message sends; `/api/admin/reset` → 410.

## Primary-executed steps

1. Delete the four files in the manifest with ordinary file deletion. Do not stage.
2. Search `src`, `__tests__`, `e2e`, `scripts` for every removed export and prop in the table above; expect no match outside this plan's intended lines. Check `docs/runtime-verification.md` (primary-only; not read by the planner) for Reset or `seed_users` references.
3. Establish how production app and rules deploys happen and where Admin credentials exist. The repository shows neither.

## Verification (primary; executed results recorded in checkpoint above)

Preconditions:
- `node --version` satisfies `>=22.13.0 <23` (`.nvmrc` 22.15.0).
- Before any emulator-backed step, check what is listening on 8080, 9099, 4000 and 3000. Do not stop or reuse anything the primary did not start. The integration and e2e suites clear the entire emulator database, so they run only against an emulator the primary started.
- Protect owner files: either run the build in a disposable copy of the working tree, or record checksums of `public/sw.js`, `public/workbox-f1770938.js`, `public/worker-2a484529a5551160.js` and `.claude/settings.local.json` beforehand and confirm they are byte-identical afterwards.

Checks, each passing with zero failures:
1. `git diff --check`; changed and untracked paths are exactly the manifest plus the pre-existing owner changes.
2. The reference search from primary step 2 is clean.
3. Rules compile gate inside `npx firebase emulators:exec --project=xmasteak-app`: the five `firestore-rules-*` integration files.
4. `npm run lint`
5. `npm test`, including `__tests__/unit/PublicFeed_grouping.test.js` and `__tests__/unit/message_routing.test.js`.
6. `npx firebase emulators:exec --project=xmasteak-app "npm run test:integration"`
7. `npx firebase emulators:exec --project=xmasteak-app "npm run test:e2e"`
8. `npm run build`

## Owner-authorized rollout

Each step that touches a real project needs its own explicit authorization. A step that cannot be verified is a stop.

1. **Topology inventory.** List every place server code can run with Admin credentials: the current and previous production deployments, preview or branch deployments, aliases and domains, CI secrets, and local credential files. **If this cannot be established, stop; Close is not executed.**
2. **Read-only pre-checks.** The lifecycle is missing or valid active per the interpretation table; anything else, including `resetting` or any malformed field, is a stop that needs separate planning. Root `users` has one profile per 2025 roster member, by count. No `years` collection. Record root counts. A managed export or confirmed point-in-time recovery is recommended.
3. **Deploy the rules, then the new app with `YEAR_TRANSITIONS_ENABLED` unset.** The rules behave as today while the lifecycle is legacy-active. Close and Start return `TRANSITIONS_DISABLED`.
4. **Verify normal operation** and that `/api/admin/reset` on the production domain returns 410.
5. **Neutralize old writers before anything is closed.** Using the method the owner chooses (open decision 2), make sure no older deployment or credential holder can run the old Reset or any old writer, then wait out the platform's maximum request duration so in-flight old requests have ended. Verify that a superseded deployment, if any is still reachable, can no longer write. Unverified → stop.
6. **Enable transitions:** set `YEAR_TRANSITIONS_ENABLED=true` on the new deployment.
7. **Owner presses Close 2025.** Verify lifecycle `{state:'closed', year:2025, closedYears:[2025]}`, unchanged counts, archive visible.
8. **Owner presses Start 2026** after reading the roster in the prompt. Verify `year:2026`, epoch +1, `years/2026/users` equals the roster size, root counts unchanged.

Rollback: before step 5, redeploying the previous app and rules is possible. From step 5 on, roll forward only. Restoring or reopening a closed year is not provided and needs separate planning and authorization.

## Risk-area flags (CLAUDE.md)

- **Message routing:** `message-utils.js` untouched; the archive assembler consumes it and is stricter about ambiguity than the live feed.
- **SDK separation:** `year-paths.js` and `archive-threads.js` are pure; `year-client.js` and the hooks are Client SDK only; admission and routes are Admin SDK only.
- **Listener reads:** one extra single-document listener, held for the signed-in session and reattached at most once per successful bootstrap. Live listeners stay at two, zero in a closed year. Opening an archive year costs users + messages + reactions server reads once per page session.
- **Security rules:** fully rewritten. Lifecycle metadata becomes readable by accounts that were ever admitted, a deliberate minimum needed to tell a just-stale tab about Start. Rules validate a documented subset of the lifecycle schema.
- **Anonymity:** unchanged for the open year; closed years show pairings to all admitted participants.

## Not verified (needs execution or access)

- Rules constructs: `Map.get(key, default)`, `in` on a list, `int()` on a path segment, comparing two booleans with `==`, the literal `match /system/lifecycle`, split `get`/`list`. Check 3 is the gate.
- The emulator REST clear endpoint; `tx.get(query.limit(1))` in an Admin transaction; that a thrown callback rolls back without retry; emulator lock behaviour (the held-transaction assertions hold under either serialization).
- Actual runtime behaviour of `getDocsFromServer` when offline. Unit tests exercise it only through mocks.
- Whether Firestore ends already-open listeners when an admission goes stale. The design does not depend on it; an excluded participant's old tab may keep showing 2025 data it already had until reload.
- Production data, deployment topology, PWA update timing, and `docs/runtime-verification.md`.

## Deferred

Automatic assignment and matching; archive-only access; Reopen or restoration; cleanup of inert stale `participantIndex`, `authIdentities` and `pushTokens` rows; year awareness in `scripts/check_messages.js` and `scripts/test_message_routing.js`; markdown in the archive.

## Open decisions (owner)

1. **Resolved with implementation approval:** the approved manifest deletes `scripts/seed_users.js`, because it can write production root collections outside every fence. Primary completed that deletion. No emulator-only replacement was added.
2. **How old writers are neutralized in rollout step 5.** Recommended: rotate the Admin service-account key so every older deployment and stray credential copy loses access at once. Alternative: remove every superseded deployment and alias individually. Either needs explicit authorization; neither is authorized by approving this plan.

## Resolutions to review points

Points A–F were accepted in revision 3 and are carried over unchanged. The manifest is unchanged.

**G. Lifecycle listener lost-attach race.** The subscription now records the admission sequence it was attached at, and a single rule, `maybeReattachLifecycle()`, runs from both the listener's error callback and the 2xx bootstrap branch: reattach only if the listener has ended and a newer accepted bootstrap exists. Whichever of the two events arrives second performs the reattach, so both orderings converge. A reattached listener that ends again stays stopped until a later successful bootstrap, giving at most one reattach per accepted 2xx. The path issues no bootstrap requests and uses no timers, and its callbacks keep the captured subscription-generation guard; the sequence resets on uid change. `ended` is set on any listener error, permission-denied included, since the listener is dead either way. Tests for both orderings, repeated denial and stale generations are added to `__tests__/unit/useUser_realtime.test.js`. The fence and reconciliation design is otherwise as in revision 3.

**H. `page.js` users-fetch stale scope.** The effect gets an effect-local `active` flag, and its result is stored tagged with a scope key (`authUid`, profile id, year, epoch). `allUsers` and `availableRecipients` are no longer state; they are derived, and only from a result whose key equals the current key. A late response from an earlier year, account or refetch is dropped, and the first render after a scope change shows no previous-scope rows or candidates. State is set only in promise callbacks. The claim transaction and manual selection are untouched. Two held-result tests are added to `__tests__/unit/admin_ui.test.js`, which already renders the real Welcome screen with a controllable `getDocs`: a late 2025 result after a 2026 success, and an account switch.
