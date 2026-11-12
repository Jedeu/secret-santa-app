# PLAN.md: Automatic annual recipient draw and one-time recipient reveal

## Status

**Status: APPROVED, revision 2 — user approval recorded 2026-11-11 MST. Primary adversarial review COMPLETE, no blocking objections.** Planner: Claude Fable 5.2 (xhigh). The owner approved with: “That looks good. I approve so please proceed” after reviewing the planned reveal UX. Approval covers this plan's 25 implementation files, recommended defaults in Open decisions 1–8, and primary local verification. Production access and deployment remain unauthorized. The owner separately authorized committing, pushing and opening a draft PR with “Commit and push a draft PR” on 2026-11-11 MST.

**Primary review evidence:** reviewed both complete drafts against the existing admission, lifecycle, user-context, Home, rules and test contracts. Revision 2 resolves all seven review points below. Operation settlement is synchronous and fences late work; acknowledgment is monotonic for an unchanged scope; mode-only changes and archive scope are covered. The owner approved the recommended defaults in Open decisions 1–8. Verification commands below are the approved check plan; actual results are recorded in the execution evidence immediately below. The owner separately answered “Yes” on 2026-11-11 MST to stopping the existing local emulators/dev server and running checks on a fresh test stack. Primary gracefully stopped the identified old emulator CLI and dev-server parent, then confirmed 8080/9099/4000/3000 were free. Emulator-backed verification is now complete; actual results are recorded below. All approved local checks passed.

**Primary implementation and verification evidence (2026-11-11 MST):**

- The owner approved after reviewing the dedicated centered-card UX: recipient name shown directly, explicit Continue, persisted acknowledgment, retry on failure and normal chats afterward. No extra draw button or reveal animation was added.
- Opus implementation ran in fresh visible Herdr tab `w5:t5` (`Opus · annual draw implementation`). A correction ran in another fresh tab `w5:t8` (`Opus · reveal test correction`). Both CLI init events confirmed `claude-opus-5-5`, tools exactly Edit/Glob/Grep/Read/Write, no MCP servers and dontAsk permission mode; both launches explicitly selected xhigh. Tool-call audits confirmed repository-only relevant reads and only approved file writes. Opus ran no commands or checks.
- All 25 numbered files were implemented. Primary reviewed source, tests and documentation against the approved contracts; no blocking code-review defect remains. No dependency, lifecycle-schema, routing or unlisted source change occurred. The five protected routing/server/legacy-selector files named in Verification are byte-identical to the baseline.
- Pre-change baseline on Node 22.15.0: **767 tests / 57 suites passed**. First updated run: **958 passed, 6 failed / 964 tests**; all six failures were O11's strict zero-timer assertion counting React's queued fake microtasks. Opus corrected only that new test block by draining fake microtasks with `jest.runAllTicks()`, asserting the clock did not advance and retaining `expect(jest.getTimerCount()).toBe(0)`. No timer was blindly cleared and no application code was changed for this correction.
- Final `npm test -- --runInBand`: **964 tests / 62 suites passed (+197 tests)**. The eight focused files passed **342 tests** on each of **three consecutive runs**. The nine unmodified-regression files passed **131 tests**. No unhandled-rejection diagnostic appeared.
- `npm run lint` passed before and after the test correction. `npm run build` passed, including the new dynamic acknowledgment route. Both ran in a disposable copy without `.env*` or local settings; Firebase credentials were absent/explicitly unset for the build and push dispatch was disabled. Build-generated public assets were confined to that copy.
- `npx playwright test --list` successfully collected **48 tests in 10 files**, including updated year rollover. This was enumeration only, not browser execution.
- `git diff --check`, approved-file/reference checks, model/tool/file-scope audits and pre-existing-owner-file hash checks passed. `.claude/settings.local.json` and all three pre-existing untracked public worker files remain unchanged.
- **Follow-up authorization and emulator-backed results (2026-11-11 MST):** the owner answered “Yes” to stopping the pre-existing local servers and starting a fresh disposable test stack. Primary gracefully stopped the old emulator CLI/dev-server parent, verified the fixed ports were free, and then ran both approved emulator-backed commands under Node 22.15.0 in the tested disposable source copy. Each invocation started its own Firestore/Auth emulators; no previous emulator data was reused. The CLI used a clean HOME/config and no Firebase login or production credentials.
- `npx --no-install firebase emulators:exec --project=xmasteak-app "npm run test:integration"` passed: **147 tests / 11 suites**, including the new draw/reveal integration suite and all rules suites.
- `npx --no-install firebase emulators:exec --project=xmasteak-app "npm run test:e2e"` passed: **48 browser tests**, with no failures, skips or retries reported. Updated year rollover verified the correct recipient name, archive access, refresh before Continue, second-device synchronization, no repeat after Continue/reload/new context, admin controls and messaging.
- **Warning investigation:** E2E emitted Firestore IndexedDB-exclusive-access fallback and initial lifecycle-listener permission warnings. Primary reran the entire pre-change browser suite on a separate fresh stack: **48 baseline browser tests passed**, reproducing the same warning classes (baseline: 6 cache/7 lifecycle; updated: 6 cache/8 lifecycle with additional browser contexts). The lifecycle listener subscribes before admission and reattaches after bootstrap, and IndexedDB falls back to memory when tabs contend; those mechanisms predate this change. No unhandled-rejection diagnostic appeared. Console output is not claimed to be warning/error-free. Firebase CLI also warned about no login (intentional credential isolation) and future Java <21 support removal; the installed Java 16 runtime completed these local emulator checks. No runtime/dependency upgrade was made.
- Every primary-started test stack and the Playwright-managed dev server shut down after its suite. Ports 8080/9099/4000/3000 were checked free afterward. All 25 implementation files remain byte-identical to the passing test snapshot, and the four pre-existing owner files still match their saved hashes. No additional application correction was needed after emulator/browser verification.
- **Not run/authorized:** manual browser/device verification, real Google sign-in or push delivery, production operations and deploys. Installation of app code/rules in production is not authorized by this approval.
- **Publication authorization (2026-11-11 MST):** the owner requested a commit, push and draft PR. Primary fetched origin, confirmed the previous branch's HEAD tree exactly matches `origin/main` (`54f5f77`), and created `feat/annual-recipient-reveal` from that main tip without rewriting history or disturbing owner changes. Publication includes the 25 numbered implementation files plus PLAN.md and RESEARCH.md only; `.claude/settings.local.json` and the three pre-existing generated public workers remain excluded. Source remains byte-identical to the passing test snapshot; only publication evidence was added to planning artifacts.

Revision 2 answers the primary's seven review points (see "Review resolutions" at the end). It changes the acknowledgment operation fence, the acknowledgment monotonicity policy, profile change detection, archive-browsing scope, and several statements of guarantee. The file list is still 25 files.

The planner read `AGENTS.md`, `CLAUDE.md`, `RESEARCH.md`, the saved `PLAN.md`, and the implementation and tests named below. Nothing was executed, so no check is claimed to pass. `docs/runtime-verification.md` and `.env*` were not read.

## Goal

When an admin starts a new year, the server draws every participant's recipient in the same transaction, and each participant sees a reveal screen naming their recipient until they press Continue, after which it is not shown again for that year.

## Behaviour contract (testable semantics)

**Draw**

1. `Start new year` writes a complete pairing for the whole target roster in the same transaction that creates the profiles and activates the year. Either every profile exists with a recipient and a Santa, or nothing is written.
2. Every participant has exactly one recipient and one Santa, and nobody draws themselves. Login order plays no part.
3. The draw is computed once per `startNewYear` call, before the transaction, so a retried transaction callback writes the same ids and pairs.
4. A repeated Start for the current year returns `changed: false`, writes nothing, and never redraws. Of two concurrent Starts, exactly one draw is persisted.
5. Start's response and logs carry no pairing data (the response is counts and lifecycle fields only). The acknowledge response echoes only the ids the caller sent. This is not a new security boundary: as today, bootstrap returns the caller's own profile including their own `recipientId` and `gifterId`, an admin who participates sees their own recipient, and `users` documents stay readable by every admitted participant.
6. No sign-in, bootstrap, page load, deploy or background task draws or redraws. There is no production reroll.

**Which years are automatic**

7. A profile is automatic only if it carries `drawMode: 'auto'`, which only Start writes. Profiles without `drawMode` (2025, and any year started before this ships) keep manual selection exactly as today and are never redrawn.
8. While at least one profile carrying `drawMode` remains in the active year's `users` collection, admission and seeding never create a new `users` document in that year. The missing member's own transaction fails with `PROFILE_CONFLICT` and commits nothing, and no reveal field is touched. Admission records and index rows for members whose profiles exist may still be written or repaired, as they are today.
9. Item 8 covers application-created data only. It does not cover every mode-bearing profile being removed outside the app (the year then looks manual), nor a profile inserted outside the app without `drawMode` (it is treated as a manual profile). No recovery protection is claimed for those.
10. A profile whose `drawMode` is present but whose value or pairing is unusable is `invalid`: the client shows an "unavailable" card, never the manual selector and never the chats.

**Reveal and acknowledgment**

11. The reveal is pending when an automatic profile's `revealAckRecipientId` differs from its `recipientId`. It is shown on the next app entry in the open year, including in a browser that was already open when Start happened.
12. Only pressing Continue acknowledges it. Bootstrap, render, the snapshot listener and archive browsing never do.
13. Continue is offered only while the recipient's name is displayed, and the name comes only from the row whose `id` equals the caller's `recipientId` in the users result for the current account, profile, year and epoch.
14. The acknowledgment is written by the server only, to the caller's own profile, and only if the request's year, epoch, profile id and recipient id all match the server's current state in the same transaction. Any mismatch returns 409 and writes nothing.
15. Retries and concurrent requests are idempotent: one write, and replays return the stored timestamp.
16. A failed or timed-out acknowledgment leaves the reveal on screen with a retry. Nothing is dismissed locally.
17. A client acknowledgment operation that has ended (result delivered, deadline reached, or cancelled by a scope change or unmount) is inert: it starts no token request, no fetch and no bootstrap, and publishes nothing, whatever resolves later.
18. Within one page session, once the client has published an acknowledgment for one (account, profile, year, epoch, recipient), no later profile snapshot or bootstrap response for that same tuple can show it as pending again, whether or not it is flagged as cached. A different recipient or any other change of tuple is judged on its own.
19. After a confirmed acknowledgment, the reveal does not reappear on reload, sign-out and sign-in, or another device.
20. A closed year is never written, and the reveal is never shown in one.
21. "Browse past years" before choosing or confirming a recipient applies only to the account, profile, year and epoch in which it was pressed. A new year or another account starts on its own reveal or selector.

**Limits of "once" (to state plainly at approval)**

- Reloading before pressing Continue shows the reveal again.
- Two tabs or devices opened before Continue both show it. When one confirms, the other switches to the chats when its listener delivers the change.
- If Continue is pressed and the response is lost or late, the screen stays with a retry until the listener delivers the change or the retry confirms it.
- The reveal is a UI gate, not secrecy. The recipient's name stays visible in the Recipient tab, and `users` documents remain readable by every admitted participant, as today.
- A browser tab still running the previous build goes straight to the chats with no reveal, then shows the reveal once after it loads the new build.

**Distribution of the draw**

- The draw is a uniformly shuffled single ring: shuffle the participants, then each gives to the next and the last gives to the first.
- With an unbiased shuffle, each of the (n−1)! rings is equally likely, and each participant is equally likely to draw each of the other n−1 people.
- It is not uniform over all valid assignments: assignments made of several smaller rings (for example two people who draw each other, when n ≥ 4) never occur. For n = 3 every valid assignment is a ring; for n = 2 the only outcome is the mutual pair.
- Consequence: for n ≥ 3 your recipient is never also your Santa, so each participant can rule one person out as their Santa.
- No prior-year, household or couple exclusions.

## Scope

**Unchanged:** message routing and `src/lib/message-utils.js`, directional conversation ids, `/api/messages/send`, `/api/auth/bootstrap`, `/api/dev/assign`, `src/lib/firestore.js`, `src/components/RecipientSelector.js`, push, outbox, archive viewer, the lifecycle document shape, `src/lib/year-paths.js`, the client version header, and all listeners. No new dependency and no new listener.

**Not included:** converting an already-started year, rerolls, exclusion rules, inserting a late participant into an existing draw, a year-level draw marker, and requiring acknowledgment before sending messages.

## Proposed changes

### Data shape

Profiles created by `startNewYear` gain three fields. No other writer sets `drawMode`.

```js
{
  id, name, email, oauthId: null, image: null,
  recipientId: string,                  // drawn at Start
  gifterId: string,                     // drawn at Start
  drawMode: 'auto',                     // written once; absent or null = manual profile
  revealAckRecipientId: string | null,  // null at Start; the recipientId the participant confirmed
  revealAckAt: string | null            // null at Start; ISO 8601 time of that confirmation
}
```

`revealAckRecipientId` and `revealAckAt` are written only by `POST /api/reveal/acknowledge`, only from "not this recipient" to "this recipient". No application writer clears them, and in production no code path changes an automatic profile's `recipientId`.

### A. New source files

#### 1. `src/lib/recipient-reveal.js` — pure, no Firebase SDK, shared by client and server

Must not import `recipient-draw.js` (that file uses `node:crypto`).

```js
export const DRAW_MODE_AUTO = 'auto';

/** True when the profile carries any draw mode (drawMode neither undefined nor null). */
export function hasDrawMode(user)        // boolean

/** @returns {'manual'|'invalid'|'pending'|'acknowledged'} */
export function getRevealState(user)
```

`getRevealState` rules, in order:

| Condition | Result |
|---|---|
| `user` is null/undefined, or `user.drawMode` is `undefined` or `null` | `'manual'` |
| `user.drawMode !== 'auto'` | `'invalid'` |
| `id`, `recipientId` or `gifterId` is not a non-empty string, or `recipientId === id`, or `gifterId === id` | `'invalid'` |
| `user.revealAckRecipientId === user.recipientId` | `'acknowledged'` |
| otherwise | `'pending'` |

#### 2. `src/lib/recipient-draw.js` — server-only, no Firebase SDK

Import: `import { randomInt } from 'node:crypto';` (the same style as `src/lib/push-server.js`).

```js
/**
 * @param {string[]} ids  at least two distinct non-empty strings
 * @param {(maxExclusive: number) => number} [pickIndex]  uniform integer in [0, maxExclusive);
 *        defaults to (n) => randomInt(n)
 * @returns {Map<string, { recipientId: string, gifterId: string }>}
 */
export function drawRecipientCycle(ids, pickIndex)

/** True when profiles ({ id, recipientId, gifterId }) form one complete valid pairing. */
export function isCompletePairing(profiles)   // boolean
```

`drawRecipientCycle`:
1. Throw `new Error('Recipient draw needs at least two distinct ids')` unless `ids` is an array of at least two non-empty strings with no duplicates.
2. Copy to `order`. Fisher–Yates: for `i` from `order.length - 1` down to `1`, `j = pickIndex(i + 1)`; throw `new Error('Recipient draw received an invalid random index')` unless `j` is an integer with `0 <= j <= i`; swap `order[i]` and `order[j]`.
3. For each position `k` (with `n = order.length`): map `order[k]` to `{ recipientId: order[(k + 1) % n], gifterId: order[(k - 1 + n) % n] }`.

`isCompletePairing` returns true only if all hold: an array of at least two; ids are distinct non-empty strings; every `recipientId` is the id of another profile in the list; the recipient ids are all distinct; and for every profile `p`, the profile whose id is `p.recipientId` has `gifterId === p.id`. It does not require a single ring.

#### 3. `src/app/api/reveal/acknowledge/route.js` — Admin SDK

Imports:

```js
import { NextResponse } from 'next/server';
import { firestore } from '@/lib/firebase';
import { verifyRequestToken, runFencedTransaction, admissionErrorResponse } from '@/lib/participant-admission';
import { getRevealState } from '@/lib/recipient-reveal';
import { isValidYear, yearCollectionPath } from '@/lib/year-paths';
```

`export async function POST(request)`:

1. `decoded = await verifyRequestToken(request)`.
2. Parse the JSON body `{ year, epoch, userId, recipientId }`. Reject with 400 `INVALID_REQUEST` if the body is not JSON, `!isValidYear(year)`, `epoch` is not an integer ≥ 1, or `userId`/`recipientId` is not a string of 1–128 characters without `/`.
3. `result = await runFencedTransaction(decoded, work)` with the default `allowClosed = false`, so a closed year fails with `YEAR_CLOSED` before any write.
4. `work(tx, { user, profileId, year: activeYear, epoch: activeEpoch })`, checked in this order. It performs no additional reads:
   - `activeYear !== year`, `activeEpoch !== epoch`, `profileId !== userId` or `user.id !== profileId` → 409 `REVEAL_STALE`.
   - `getRevealState(user) === 'manual'` → 409 `REVEAL_NOT_APPLICABLE`.
   - `getRevealState(user) === 'invalid'` → 409 `REVEAL_UNAVAILABLE`.
   - `user.recipientId !== recipientId` → 409 `REVEAL_STALE`.
   - `'acknowledged'` → return `{ changed: false, acknowledgedAt: typeof user.revealAckAt === 'string' ? user.revealAckAt : null }` with no write.
   - `'pending'` → `acknowledgedAt = new Date().toISOString()`; `tx.update(firestore.collection(yearCollectionPath(activeYear, 'users').join('/')).doc(profileId), { revealAckRecipientId: recipientId, revealAckAt: acknowledgedAt })`; return `{ changed: true, acknowledgedAt }`.
5. 200 body: `{ success: true, changed, year, epoch, userId, recipientId, acknowledgedAt }`.

Errors:
- A local `RevealRouteError(status, code, message)` class, thrown inside `work` and for step 2, is returned as `{ error, code }`.
- Messages: `INVALID_REQUEST` 'Invalid acknowledgment request.'; `REVEAL_STALE` 'Your recipient information changed. Reloading it now.'; `REVEAL_NOT_APPLICABLE` 'There is no recipient reveal to acknowledge.'; `REVEAL_UNAVAILABLE` 'Your recipient is not available. Ask an admin for help.'
- Admission errors go through `admissionErrorResponse`.
- Anything else: `console.error('Reveal acknowledgment failed:', error?.message)` and 500 `{ error: 'Could not save. Try again.', code: 'INTERNAL' }`. Never log the body or ids.

The only `users` document this route can write is the caller's own profile, identified by the admission record read in the same transaction. `runFencedTransaction` may refresh the caller's admission record, exactly as the send route does; that never touches reveal fields.

#### 4. `src/components/RecipientReveal.js` — client component, no Firestore SDK

Imports: `useEffect`, `useRef`, `useState` from `react`; `signOutCurrentUser` from `@/lib/sign-out`.

```js
/**
 * @param {Object} props
 * @param {{ id: string, name: string }} props.currentUser
 * @param {number} props.year
 * @param {'loading'|'ready'|'error'|'invalid'} props.status
 * @param {string|null} props.recipientName        non-empty when status is 'ready'
 * @param {() => Promise<{ status: 'acknowledged'|'stale'|'failed' }>} props.onAcknowledge
 * @param {() => void} props.onRetry
 * @param {React.ReactNode} [props.adminControl]
 * @param {Function|null} [props.onBrowseArchive]
 */
export default function RecipientReveal(props)
```

Layout: the same shell as `RecipientSelector` (`<main className="container">` centred, `<div className="card login-card" data-testid="recipient-reveal">`), heading `Welcome, {currentUser.name}!`.

Copy is defined as module string constants and rendered through JS expressions, so no raw apostrophes sit in JSX text.

| `status` | Content |
|---|---|
| `'ready'` (with a non-empty `recipientName`) | `Your {year} Secret Santa recipient is`; the name in `<p data-testid="recipient-reveal-name">`; note `Tap Continue when you're ready — this screen won't be shown again. Your recipient is always in the 🎁 Recipient tab.`; button `Continue` |
| `'loading'` | `<p role="status">Finding out who you're buying a gift for…</p>`; no Continue |
| `'error'`, or `'ready'` without a name | `We couldn't load your recipient's name. Check your connection and try again.`; button `Try again` → `onRetry()`; no Continue |
| `'invalid'` | `Your {year} recipient isn't available. Ask the admin for help.`; button `Try again` → `onRetry()`; no Continue |

Below, in every state and in this order, exactly as `RecipientSelector` renders them: `adminControl` (if any), `Browse past years` (if `onBrowseArchive`), `{year} exchange`, `Sign out`.

Continue handler:
1. Return if `status !== 'ready'`, there is no name, or `lockRef.current` is set.
2. Set the lock, `saving = true`, `failed = false`.
3. `result = await onAcknowledge()`; a thrown error counts as `{ status: 'failed' }`.
4. Release the lock. If still mounted: `saving = false`, and `failed = true` only when `result.status === 'failed'`.
5. `'acknowledged'` and `'stale'` change nothing locally; the page re-renders from context state.

While saving, the button is disabled and reads `Saving…`. When `failed`, show `<p role="alert">That didn't save. Check your connection and try again.</p>` and keep Continue enabled. Track mount with a ref set in an effect and cleared in its cleanup. `onAcknowledge` always settles within the context's deadline (file 6), so `Saving…` cannot persist.

### B. Modified source files

#### 5. `src/lib/participant-admission.js` — Admin SDK

Add imports:

```js
import { DRAW_MODE_AUTO, hasDrawMode } from '@/lib/recipient-reveal';
import { drawRecipientCycle, isCompletePairing } from '@/lib/recipient-draw';
```

**`startNewYear`.** Replace the `profiles` construction (still before `requireFirestore()` and the transaction):

```js
// Built before the transaction so a retried callback reuses the same ids and the same draw.
const base = roster.map((participant) => ({
    id: uuidv4(),
    name: toTitleCase(participant.name),
    email: participant.email,
    oauthId: null,
    image: null,
}));
const draw = drawRecipientCycle(base.map((profile) => profile.id));
const profiles = base.map((profile) => ({
    ...profile,
    recipientId: draw.get(profile.id).recipientId,
    gifterId: draw.get(profile.id).gifterId,
    drawMode: DRAW_MODE_AUTO,
    revealAckRecipientId: null,
    revealAckAt: null,
}));
if (!isCompletePairing(profiles)) {
    throw new Error('Recipient draw failed validation');
}
```

The transaction body, the write count and the return shape are unchanged. Update the function's JSDoc to say the pairs are drawn here.

**`resolveProfileInTransaction`.** In the `matches.length === 0` branch, after the closed-year check and before building the new user:

```js
if (usersSnap.docs.some((doc) => hasDrawMode(doc.data()))) {
    // Recipients for this year were drawn at Start: a profile added now would have no
    // place in the draw and must never reach manual selection.
    throw new AdmissionError('PROFILE_CONFLICT');
}
```

- This uses the collection read the function already performs; there is no extra read.
- It covers `admitParticipant` (one transaction, which then commits nothing) and each per-member transaction of `ensureParticipantProfiles`.
- Seeding still processes the other roster entries, so index rows for members whose profiles exist may be written, as today.
- The guard depends on at least one mode-bearing profile being present (contract items 8–9).

**`runFencedTransaction`.** Add `profileId: userId` to the context object passed to `work` — the document id from the admission record read in this transaction. Update the JSDoc signature to `work(tx, { uid, email, epoch, year, state, user, profileId })`. Nothing else changes.

Update the header comment's profile description to mention the three new fields.

#### 6. `src/context/UserContext.js` — Client SDK

Add import: `import { getRevealState } from '@/lib/recipient-reveal';`

Add constants: `REVEAL_ACK_URL = '/api/reveal/acknowledge'`, `REVEAL_ACK_TIMEOUT_MS = 15000`.

**6.1 Module helpers (pure, no hooks)**

```js
// Scope of a pending reveal for a published state, or null.
function revealScopeOf(state)
// -> { authUid, userId, year, epoch, recipientId } when status is 'ready', the season is
//    active and getRevealState(state.user) === 'pending'; otherwise null

// True when state is 'ready' in an active season with the same authUid, user.id,
// season.year, season.epoch and user.recipientId as scope (pending or already acknowledged).
function matchesRevealScope(state, scope)

// Acknowledgment is monotonic for one profile and recipient (see 6.2).
function keepAcknowledgment(heldUser, incomingUser)

// Ends an acknowledgment operation. Synchronous and idempotent; awaits nothing.
function settleRevealAck(holder, op, result) {
    if (op.settled) return;
    op.settled = true;                       // the abandonment fence
    clearTimeout(op.timer);
    try { op.controller?.abort(); } catch { /* ignore */ }
    if (holder.current === op) holder.current = null;
    op.resolve(result);
}
```

`keepAcknowledgment` returns `incomingUser` unless all of these hold, in which case it returns `{ ...incomingUser, revealAckRecipientId: heldUser.revealAckRecipientId, revealAckAt: heldUser.revealAckAt ?? null }`:
- `heldUser` is not null, and `heldUser.id === incomingUser.id` and `heldUser.recipientId === incomingUser.recipientId`;
- `getRevealState(heldUser) === 'acknowledged'`;
- `getRevealState(incomingUser) === 'pending'`.

An incoming `'invalid'` or `'manual'` profile is never overridden, so a mode change always shows through.

**6.2 Authoritative-source policy for the acknowledgment**

- **Inputs.** The published user is fed by bootstrap responses, profile snapshots (cached or server-flagged), and the acknowledge route's 2xx for a live operation. Their arrival order is not guaranteed.
- **Pairing and mode fields.** The latest applied input wins, as today.
- **Acknowledgment.** For one tuple (account, profile id, year, epoch, recipient id) it is a logical OR over every input this page session has applied. Once the published user is acknowledged for the tuple, a later input for the same profile and recipient that reads as pending keeps the held acknowledgment. `fromCache` plays no part.
- **Why "acknowledged" may be trusted from any input.** The client never writes these fields (rules deny it and the app never attempts it), so an acknowledged value in a snapshot or response was delivered by the server at some point. The server value for a tuple is write-once: only the acknowledge route sets it and no application writer clears it. A cached acknowledged value is therefore previously delivered and still true, not newly confirmed.
- **Why "pending" after "acknowledged" is never trusted for the same tuple.** Given write-once server state it can only be an older snapshot or a response read before the acknowledgment.
- **Scope.** The latch lives in the published `user` object. A different recipient id, profile id, year, epoch or account is a different tuple and is not latched; `getRevealState` computes it from its own fields.
- **Not covered.** If the server fields were reset outside the app for the same recipient, an open page keeps showing acknowledged until it is reloaded.

**6.3 `applyState` — reconcile the operation in flight**

Declare `const revealAckRef = useRef(null);` before `applyState`. Inside `applyState`, after `setWritableScope(scopeFor(next))` and before `setState`:

```js
const op = revealAckRef.current;
if (op) {
    if (!matchesRevealScope(next, op.scope)) {
        settleRevealAck(revealAckRef, op, { status: 'stale' });
    } else if (getRevealState(next.user) === 'acknowledged') {
        settleRevealAck(revealAckRef, op, { status: 'acknowledged' });
    }
}
```

Every publication goes through `applyState`. Sign-out, an account switch, profile loss, a lifecycle change, an error state, or a changed recipient therefore abandons the operation in the same tick, without waiting for its deadline.

**6.4 Bootstrap accept branch**

In the final `applyState` of the accepted 2xx path, replace `user: data.user` with a latched value. Nothing else in `runBootstrap` changes.

```js
applyState((prev) => {
    const held = prev.status === 'ready' && prev.authUid === firebaseUser.uid
        && prev.season?.year === season.year && prev.season?.epoch === season.epoch
        ? prev.user
        : null;
    return {
        ...prev,
        status: 'ready',
        user: keepAcknowledgment(held, data.user),
        authUid: firebaseUser.uid,
        season,
        error: null,
    };
});
```

**6.5 Profile snapshot handler**

Replace the existing-document branch. The missing-document branch, the subscription, its options and its dependency list are unchanged.

```js
const updatedUser = docSnapshot.data() || {};
applyState((prev) => {
    if (!active || !prev.user || prev.user.id !== userId) return prev;
    const next = keepAcknowledgment(prev.user, { ...updatedUser, id: updatedUser.id ?? userId });
    const pairingChanged = prev.user.recipientId !== next.recipientId
        || prev.user.gifterId !== next.gifterId;
    const modeChanged = (prev.user.drawMode ?? null) !== (next.drawMode ?? null);
    const ackChanged = (prev.user.revealAckRecipientId ?? null) !== (next.revealAckRecipientId ?? null);
    if (!pairingChanged && !modeChanged && !ackChanged) return prev;
    return { ...prev, user: next };
});
```

- A `drawMode`-only change (absent to `'auto'`, or `'auto'` to any other value) now replaces the user, so gating follows it.
- A `revealAckAt`-only difference is deliberately ignored: nothing displays it, and the application never changes it without `revealAckRecipientId`.
- Manual profiles behave as before: with no `drawMode` and no ack fields on either side, only a pairing change replaces the user.
- A profile id is new every year, so "same profile id" already implies the same year and epoch here.

**6.6 `acknowledgeReveal`**

`useCallback`, exposed in the context value. It returns `Promise<{ status: 'acknowledged'|'stale'|'failed', code?: string }>` and never rejects.

*Operation object:* `{ key, scope, generation, settled: false, retried: false, controller, timer, resolve, promise }`, held in `revealAckRef.current` while in flight.

*Liveness:* `isLive(op) = !op.settled && mountedRef.current && op.generation === authGenerationRef.current && matchesRevealScope(stateRef.current, op.scope)`.

*Start:*
1. `scope = revealScopeOf(stateRef.current)`, `firebaseUser = firebaseUserRef.current`. If there is no scope, no user, or `firebaseUser.uid !== scope.authUid`, resolve `{ status: 'stale' }` with no request.
2. `key = [authUid, userId, year, epoch, recipientId].join('|')`. If `revealAckRef.current?.key === key`, return its promise. If another operation is held, `settleRevealAck(revealAckRef, it, { status: 'stale' })` first.
3. Build the operation: `generation = authGenerationRef.current`; `controller = typeof AbortController === 'function' ? new AbortController() : null`; `promise` with its `resolve`; `timer = setTimeout(() => settleRevealAck(revealAckRef, op, { status: 'failed', code: 'TIMEOUT' }), REVEAL_ACK_TIMEOUT_MS)`. Store it in `revealAckRef.current`.
4. Start the work detached, with a final `catch` that calls `settleRevealAck(revealAckRef, op, { status: 'failed', code: 'NETWORK' })`. Return `op.promise`.

The returned promise is the operation's own promise, not a race with the work. It settles when `settleRevealAck` runs, never later, regardless of what the SDK or network does.

*Work.* One deadline and one controller cover everything, including the retry. At each checkpoint: if `op.settled`, return; else if `!isLive(op)`, settle `{ status: 'stale' }` and return.

1. `token = await firebaseUser.getIdToken(forceRefresh)` (`forceRefresh` is false on the first pass). On rejection: if `op.settled` return; else settle `failed` / `NETWORK`.
2. **Checkpoint A** (after the token resolves, immediately before `fetch`). If the token is not a non-empty string, settle `failed` / `AUTH`.
3. `response = await fetch(REVEAL_ACK_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ year, epoch, userId, recipientId }), signal })`. On rejection: if `op.settled` return; else settle `failed` / `NETWORK`.
4. **Checkpoint B** (after the headers arrive).
5. `data = await response.json()`, with a parse failure giving `null`.
6. **Checkpoint C** (after the body is parsed). Then classify synchronously, in this order:
   - **401:** if `op.retried`, settle `failed` / `UNAUTHENTICATED`. Otherwise set `op.retried = true` and go to step 1 with `forceRefresh = true`. At most one retry, under the same deadline.
   - **2xx** with `data.success === true` and `data.year`, `data.epoch`, `data.userId`, `data.recipientId` equal to the scope: publish with
     ```js
     applyState((prev) => (
         matchesRevealScope(prev, op.scope) && getRevealState(prev.user) === 'pending'
             ? { ...prev, user: { ...prev.user, revealAckRecipientId: op.scope.recipientId,
                 revealAckAt: typeof data.acknowledgedAt === 'string' ? data.acknowledgedAt : null } }
             : prev
     ));
     ```
     then settle `{ status: 'acknowledged' }`.
   - **403 or 409:** call `startBootstrapNow('refresh')` once, then settle `failed` with `data?.code ?? 'CONFLICT'`.
   - **Anything else** (400, 5xx, malformed or mismatched 2xx): settle `failed` with `data?.code ?? 'REQUEST_FAILED'`.

*Guarantees that follow:*
- Every `getIdToken`, `fetch` and `startBootstrapNow` in this path runs in the same synchronous block as a passed checkpoint, so none can start after the operation is settled.
- **Late results are discarded.** After the deadline or a cancellation, a late token, 200, 401, 403 or 409 does nothing. If the server did commit, the existing profile listener publishes it, or the next Continue replays it idempotently.
- A newer operation is never affected by an older one: settlement clears the ref only if it still holds that operation, and the older timer is already cleared.

*Unmount:* the auth-lifecycle effect cleanup calls `settleRevealAck(revealAckRef, revealAckRef.current, { status: 'stale' })` when an operation is held.

Add `acknowledgeReveal` to the `useMemo` value and its dependency list. Update the file's header comment with a short "Reveal acknowledgment" entry.

#### 7. `src/hooks/useUser.js` — comment only

Add `acknowledgeReveal` to the `@returns` JSDoc: "confirm the one-time recipient reveal on the server; resolves `{ status }` and never rejects".

#### 8. `src/app/page.js` — Client SDK (existing imports)

Add imports: `getRevealState` from `@/lib/recipient-reveal`; `RecipientReveal` from `@/components/RecipientReveal`. Take `acknowledgeReveal` from `useUser()`.

**Users fetch.** Same `getDocs` call and the same scope key. Add `const USERS_FETCH_TIMEOUT_MS = 10000;`.

- State becomes `{ key, users, failed }`, plus a `usersReload` counter added to the effect's dependency list (`[currentUser, usersScopeKey, seasonYear, usersReload]`).
- On success: `setUsersResult({ key: usersScopeKey, users, failed: false })`.
- On rejection, or when a `setTimeout(USERS_FETCH_TIMEOUT_MS)` started in the effect fires first: keep the existing `console.error` for rejections, then
  `setUsersResult((prev) => (prev.key === usersScopeKey && !prev.failed ? prev : { key: usersScopeKey, users: EMPTY_USERS, failed: true }))`.
  A failed refetch therefore never discards a list that already loaded for this scope.
- Clear the timer when the fetch settles and in the effect cleanup. A success arriving after the timeout still replaces the failed result while the effect is active.
- Derived values: `usersSettled = usersScopeKey !== null && usersResult.key === usersScopeKey`; `usersLoaded = usersSettled && !usersResult.failed` (the same meaning as today for every existing consumer); `usersFailed = usersSettled && usersResult.failed`.
- `retryUsers` (`useCallback`): `setUsersResult((prev) => (prev.failed ? { key: null, users: EMPTY_USERS, failed: false } : prev)); setUsersReload((n) => n + 1);`

**Archive browsing scope.** Replace the `showArchive` boolean state with a scope-keyed value. No effect and no reset are involved.

```js
const [archiveScopeKey, setArchiveScopeKey] = useState(null);
// after usersScopeKey is computed:
const showArchive = usersScopeKey !== null && archiveScopeKey === usersScopeKey;
```

- Browse handlers call `setArchiveScopeKey(usersScopeKey)`; the archive's `onBack` calls `setArchiveScopeKey(null)`.
- `usersScopeKey` already encodes account, profile, year and epoch, and is null in a closed year.
- A new year or another account therefore opens on its reveal or selector, while browsing within the same scope still works.
- `activeTab` and the sound preference are untouched.
- This also applies to the manual pre-selection screen; that is the only behaviour change for manual years.

**Gating**

```js
const revealState = getRevealState(currentUser);
const revealGate = !!currentUser && (revealState === 'pending' || revealState === 'invalid');
const needsRecipient = currentUser && revealState === 'manual' && !currentUser.recipientId;

const revealRow = revealState === 'pending' && usersLoaded
    ? allUsers.find((u) => u?.id === currentUser.recipientId)
    : null;
const revealRecipientName = typeof revealRow?.name === 'string' && revealRow.name.trim() ? revealRow.name : null;
const revealStatus = revealState === 'invalid' ? 'invalid'
    : usersFailed ? 'error'
    : !usersLoaded ? 'loading'
    : revealRecipientName ? 'ready' : 'error';
```

**Body branches, in order**

1. `!yearOpen` → closed-year archive (unchanged).
2. `(needsRecipient || revealGate) && showArchive && archiveYears.length > 0` → `ArchiveViewer` with `onBack` (the existing branch with a wider condition).
3. `revealGate` → the reveal:
   ```jsx
   <RecipientReveal
       key={`${usersScopeKey}|${currentUser.recipientId ?? ''}`}
       currentUser={currentUser}
       year={seasonYear}
       status={revealStatus}
       recipientName={revealRecipientName}
       onAcknowledge={acknowledgeReveal}
       onRetry={revealState === 'invalid' ? refreshUser : retryUsers}
       adminControl={adminControl}
       onBrowseArchive={archiveYears.length > 0 ? () => setArchiveScopeKey(usersScopeKey) : null}
   />
   ```
4. `needsRecipient` → `RecipientSelector` (unchanged props except that its `onBrowseArchive` uses the same scoped setter).
5. Otherwise → chats (unchanged).

The runtime components under `AuthGuard`, the message hooks and the conversation memos are unchanged.

#### 9. `src/hooks/useAdminYearActions.js` — Client SDK (unchanged imports)

In the `startYear` prompt replace the sentence `Everyone picks a new recipient.` with `Recipients are drawn automatically, and each participant sees theirs once when they next open the app.` Nothing else changes.

#### 10. `src/components/AdminPanel.js` — comment only

Replace "Pair assignment is user self-selection (RecipientSelector); nothing is assigned automatically." with "Start draws every participant's recipient on the server; years started before the automatic draw keep self-selection (RecipientSelector)."

#### 11. `firestore.rules`

Add one function and use it in the two claim functions. No other rule changes, and no extra `get()` calls.

```
// Profiles created by the automatic draw are never client-writable.
function isManualProfile() { return resource.data.get('drawMode', null) == null; }
```

- `isAllowedSelfRecipientSelection`: add `&& isManualProfile()` after `onlyChanges(['recipientId'])`.
- `isAllowedRecipientClaimUpdate`: add `&& isManualProfile()` after `onlyChanges(['gifterId'])`.

A reciprocal claim touches two documents and each must pass its own rule, so both must be manual. The existing `onlyChanges([...])` checks already deny client writes to `drawMode`, `revealAckRecipientId` and `revealAckAt`.

### C. Documentation

#### 12. `CLAUDE.md`

- **Authentication & User Management, step 3:** append "In a year that holds profiles drawn at Start it also never creates one (`PROFILE_CONFLICT`)."
- **Data Model, users collection:** after `gifterId`, add:
  ```javascript
    drawMode?: 'auto',                    // only on profiles created by Start new year; absent = manual selection
    revealAckRecipientId?: string | null, // recipientId confirmed on the one-time reveal screen (server-written)
    revealAckAt?: string | null           // ISO 8601 time of that confirmation
  ```
- **API Routes:**
  - Replace the Start bullet's second sentence with: "Requires `fromYear` closed and a roster for `targetYear`; creates the new year's profiles, draws every participant's recipient (one random ring), and bumps the epoch in one transaction."
  - Add: "**POST /api/reveal/acknowledge**: Body `{ year, epoch, userId, recipientId }`. Records that the caller saw their recipient. Requires a Bearer token; writes only the caller's own profile, only when all four values match the server's state; idempotent; refused in a closed year."
- **Key Files:** add `src/components/RecipientReveal.js` (one-time recipient reveal), `src/lib/recipient-reveal.js` (pure reveal-state rules, shared), `src/lib/recipient-draw.js` (server-only draw).
- **Important Notes:**
  - In the rules list, after "Recipient selection must update both users reciprocally in one transaction." add "Profiles with `drawMode` are never client-writable."
  - Add a bullet: "Automatic draw and reveal: `Start new year` is the only thing that draws recipients; there is no reroll. A profile with `drawMode: 'auto'` shows the reveal until `revealAckRecipientId` equals `recipientId`. Only `POST /api/reveal/acknowledge` writes that; bootstrap never does. The reveal is a UI step, not secrecy. Profiles without `drawMode` use manual selection."

### D. Tests

All fixtures are synthetic (`example.test` addresses; names such as Alpha, Bravo, Charlie). Existing test bodies stay unchanged except where a line is named below.

#### 13. `__tests__/unit/recipient_draw.test.js` (new, node environment)

- For n = 2, 3, 5 and 200 with the default RNG: `isCompletePairing` is true; following `recipientId` from any id visits all n ids before returning; nobody is their own recipient.
- Injected `pickIndex`: a fixed sequence yields the expected ring, and it is called with `i + 1` for `i = n−1 … 1`.
- Uniformity under a uniform RNG: for n = 4, enumerate all 24 Fisher–Yates choice sequences; each of the 6 rings appears exactly 4 times.
- Throws for a non-array, one id, an empty-string id, and duplicate ids. Throws when `pickIndex` returns a non-integer, a negative number, or a value above `i`.
- `isCompletePairing` is false for: a self-pair, a duplicate recipient, a recipient outside the list, a `gifterId` that is not the inverse, and fewer than two profiles. It is true for a two-ring assignment (validity is not ring-ness).

#### 14. `__tests__/unit/recipient_reveal.test.js` (new)

Table test of `getRevealState` covering every row of the rules table: a profile without `drawMode`; `drawMode: null`; `drawMode: 'other'`; an auto profile with a null recipient; with a null Santa; with a self recipient; pending with `revealAckRecipientId: null`; pending with a different acknowledged id; acknowledged. Also `hasDrawMode` for absent, null, `'auto'` and `'other'`.

#### 15. `__tests__/api/reveal_acknowledge_api.test.js` (new)

Mock `@/lib/participant-admission` keeping the actual module but replacing `verifyRequestToken` and `runFencedTransaction` (the pattern in `auth_bootstrap_api.test.js`). The `runFencedTransaction` mock calls `work(tx, ctx)` with `tx = { update: jest.fn() }`. Give the mocked `firestore` a `collection(path)` returning `{ doc: (id) => ({ path: path + '/' + id }) }`.

- 401 without a token; `runFencedTransaction` is not called.
- 400 `INVALID_REQUEST` for: non-JSON body, missing fields, string year, epoch 0, an empty `userId`, a `userId` containing `/`, a 129-character id. `runFencedTransaction` is not called.
- Pending profile: 200 `{ success: true, changed: true, … }`; `tx.update` is called once on `years/2026/users/{profileId}` with exactly `{ revealAckRecipientId, revealAckAt }`; `acknowledgedAt` equals the written value. `runFencedTransaction` is called without `allowClosed: true`.
- Acknowledged profile: 200 `changed: false`, the stored `revealAckAt` returned, no `tx.update`.
- 409 `REVEAL_STALE` with no `tx.update` for each of: wrong year; wrong epoch; `userId` not equal to `profileId`; `user.id` not equal to `profileId`; wrong `recipientId`.
- 409 `REVEAL_NOT_APPLICABLE` for a manual profile; 409 `REVEAL_UNAVAILABLE` for an invalid one; no `tx.update`.
- Admission errors from `runFencedTransaction` map as usual: `YEAR_CLOSED` 409, `ACCESS_DENIED` 403, `SERVICE_UNAVAILABLE` 503.
- An unexpected error gives 500 `INTERNAL`, and the log call receives only the message.
- The 200 body has exactly the documented keys (no profile, no other participant's data).

#### 16. `__tests__/unit/RecipientReveal.test.js` (new, jsdom)

Mock `@/lib/sign-out`.

- `ready`: shows the heading, the year line, the name in `recipient-reveal-name`, and Continue.
- Continue calls `onAcknowledge` once; while pending the button is disabled and reads `Saving…`; a double click sends one call.
- Result `failed`: the alert text appears, Continue is enabled again, and a second click calls `onAcknowledge` again.
- Results `acknowledged` and `stale`: no alert, and the component is still rendered (no local dismissal).
- `onAcknowledge` rejecting is treated as failed.
- `loading`: the status text, no Continue, no name.
- `error`: the error text; Try again calls `onRetry`; no Continue.
- `ready` with a null or blank name behaves as `error`.
- `invalid`: the unavailable text with the year; Try again calls `onRetry`; no Continue.
- `adminControl` is rendered in every state; `Browse past years` appears only with `onBrowseArchive` and calls it; Sign out calls `signOutCurrentUser`.
- Unmounting while the acknowledgment is pending, then resolving it, causes no error.

#### 17. `__tests__/unit/home_reveal.test.js` (new, jsdom)

Renders `Home` with the mocking approach of `admin_ui.test.js` (mock `useUser`, `Chat`, `PublicFeed`, `ArchiveViewer`, the realtime hooks, `firebase/firestore`, `@/lib/sign-out`).

*Reveal gating*
- Pending profile with users loaded: the reveal shows the name of the row whose id is the recipient id; no combobox; no chat.
- Continue calls the mocked `acknowledgeReveal` once and nothing else.
- Re-render with the acknowledged profile: chats, no reveal.
- Invalid automatic profile (`drawMode: 'auto'`, null recipient) and an unknown `drawMode` value: the unavailable card; no combobox; Try again calls `refreshUser`.
- A closed season with a pending profile shows the archive and no reveal.
- Legacy check: a profile without `drawMode` and without a recipient still shows the `Welcome, …!` selector with the combobox; one with a recipient shows the chats.

*Recipient name*
- Users fetch pending: loading text, no Continue; after it resolves, the name appears.
- Users fetch rejected: error text; Try again triggers a second `getDocs`; then the name appears. `acknowledgeReveal` is never called while there is no name.
- Loaded list without the recipient id: error state, and no other participant's name is shown.
- A late users result for an older year or account never supplies the name (the deferred pattern from the "users-fetch scope" tests).
- With fake timers: a fetch still pending at 10 000 ms shows the error state; its later success shows the name.

*Archive browsing scope*
- An admin on the reveal sees `Close 2026`. `Browse past years` opens the archive, and `Back to current year` returns to the reveal, still pending.
- Same scope: after Browse, a re-render with the same account, profile, year and epoch (for example a new users result) still shows the archive.
- Rollover: Browse in 2026 before choosing; re-render as closed 2026; re-render as active 2027 with a new pending profile and epoch — the reveal is shown, not the archive.
- Account switch: account A browses in 2026; re-render as account B with a pending profile in the same year — B's reveal is shown.
- The same two cases with a manual unassigned profile show the selector, not the archive.

#### 18. `__tests__/integration/recipient-reveal.test.js` (new, emulator, Admin SDK)

Same harness as `year-lifecycle.test.js`: `jest.mock('@/lib/participants', () => require('./helpers/emulator-admin').syntheticParticipantsModule())`, `clearEmulatorFirestore()` before each test, `interceptNextTransaction` for held races, and the bootstrap and acknowledge routes called with a spied `verifyIdToken`.

- **Draw at Start:** after Close 2025 and Start 2026, `years/2026/users` holds exactly the 2026 roster; `isCompletePairing` is true; one ring covers everyone; every profile has `drawMode: 'auto'` and both ack fields null. The Start route's response body has no pairing fields.
- **No redraw:** a second Start returns `changed: false` and the users snapshot is deep-equal.
- **Start vs Start (held):** exactly one `changed: true`; the stored pairing is complete; a later Start changes nothing.
- **Atomic failure:** a Start failed after its work leaves no 2026 users; the plain retry stores a complete pairing.
- **Bootstrap never acknowledges:** three bootstraps for one participant leave both ack fields null.
- **Acknowledge:** 200 `changed: true`; that profile has both fields set; every other profile is deep-equal to before. A replay returns `changed: false` with the same `acknowledgedAt` and the document unchanged.
- **Concurrent acknowledgments (held):** both 200; exactly one `changed: true`; both report the stored `revealAckAt`.
- **Fences:** wrong epoch, wrong year, another participant's `userId` together with that participant's `recipientId`, and a wrong `recipientId` each give 409 `REVEAL_STALE`, with the users snapshot unchanged.
- **Closed year:** after Close 2026, acknowledge gives 409 `YEAR_CLOSED` and the users snapshot is unchanged.
- **Acknowledge vs Close (held):** the response is 200 exactly when the profile carries the acknowledgment, otherwise 409; the year ends closed.
- **After the next Start:** a request with the 2026 scope during 2027 gives 409 `REVEAL_STALE`; the 2026 users snapshot is unchanged and every 2027 profile still has null ack fields.
- **Manual year:** in seeded 2025, acknowledge gives 409 `REVEAL_NOT_APPLICABLE` with users unchanged.
- **Access:** no token → 401; a 2025-only member during 2026 → 403.
- **Missing member while other automatic profiles remain:** delete one 2026 profile and its index row out of band. `admitParticipant` rejects with `PROFILE_CONFLICT`, and `ensureParticipantProfiles` rejects with `PROFILE_CONFLICT` (`conflicts: 1`). The `years/2026/users` snapshot is unchanged: no new document and no reveal-field change. Index and identity collections are not asserted.
- **Dev reassign:** after everyone acknowledges, `assignUsersInTransaction` with a builder that reverses the ring leaves the ack fields untouched and makes every `getRevealState` `'pending'`; acknowledging the new recipient returns `changed: true`.

#### 19. `__tests__/lib/participant_admission.test.js` (modified)

Add at the top a partial mock so the draw can be observed and overridden:
`jest.mock('@/lib/recipient-draw', () => { const actual = jest.requireActual('@/lib/recipient-draw'); return { ...actual, drawRecipientCycle: jest.fn(actual.drawRecipientCycle) }; });`

- **Existing Start test** (the `profiles.forEach` assertion at about lines 802–805): replace the null-pairing expectation. For the two-person roster each profile's `recipientId` and `gifterId` is the other's id, and each document equals exactly the ten-field shape above with `drawMode: 'auto'` and null ack fields. Every other assertion in that test stays.
- **New:** a five-person synthetic 2027 roster started from a closed 2026 gives a complete pairing in one ring of five.
- **New:** the callback run twice (wrap the fake `runTransaction` so the first run's writes are dropped and its `tx.create` payloads captured) persists the same ids and pairs as the first run, and `drawRecipientCycle` was called once.
- **New:** a repeated Start leaves the users documents deep-equal.
- **New:** with `drawRecipientCycle` overridden once to return self-pairs, `startNewYear` rejects with 'Recipient draw failed validation', `runTransaction` is not called, and nothing is written.
- **New (admission):** in an active 2026 holding two automatic profiles, a third roster member with no profile and no index row gets `PROFILE_CONFLICT`, and that call writes nothing. The same member with an existing automatic profile but no index row is linked, with no `users` write.
- **New (seeding):** in the same year with every profile present, `ensureParticipantProfiles` reports all existing.
- **New (seeding with repair):** one member's profile exists but its index row is missing, and another roster member has no profile. Seeding rejects with `PROFILE_CONFLICT` (`conflicts: 1`); the first member's index row is written; the set of `users` documents and their contents are unchanged.
- **New:** the `runFencedTransaction` context carries `profileId` equal to the identity's `userId`.

#### 20. `__tests__/integration/year-lifecycle.test.js` (modified)

In "Start creates exactly the 2026 roster with null pairings…":
- Rename it to "…with a complete automatic draw…".
- Replace the `users2026.forEach` expectation (about lines 381–384) with: `oauthId` and `image` null, a string `id`, `drawMode: 'auto'`, both ack fields null, and `isCompletePairing(users2026)` true (import it from `@/lib/recipient-draw`).

No other test in the file changes. The second-rollover test's `assignUsersInTransaction(circular)` call stays valid.

#### 21. `__tests__/unit/useUser_realtime.test.js` (modified: add `describe('recipient reveal')`)

Existing tests stay unchanged. Route `global.fetch` by URL. Fixtures: `autoPending` (2026 profile with `drawMode: 'auto'` and null ack fields) and `autoAcked`. Timing cases use fake timers, deferred promises, and handlers attached before any clock advance. Each case asserts no unhandled rejection.

*Operation*
- **O1** Request shape: POST `/api/reveal/acknowledge` with the bearer token, JSON headers and `{ year, epoch, userId, recipientId }`; `getIdToken` called once, not forced. On 200 the user carries both ack fields; the result is `acknowledged`; no listener is added or removed.
- **O2** A manual profile, an acknowledged profile, an invalid profile and a closed season each resolve `stale` with no token request and no fetch.
- **O3** Two calls for the same scope while one is in flight share one promise and one fetch.
- **O4** While live: a 500, a 400, a rejected fetch, a rejected token, and a 200 with a missing or mismatched echo each give `failed`; the user is unchanged; a later call sends a new request and succeeds. A non-string token gives `failed` with no fetch.
- **O5** `getIdToken` never settles: `failed` / `TIMEOUT` at 15 000 ms and not before; no fetch. Resolving the token afterwards starts no fetch.
- **O6** Fetch never settles and ignores abort: `TIMEOUT` at 15 000 ms; the signal is aborted. A late 200 leaves the user pending and starts nothing. A profile snapshot carrying the acknowledgment then publishes it.
- **O7** Headers arrive with 200 but `json()` never settles and ignores abort: `TIMEOUT` at 15 000 ms. The late body publishes nothing and starts nothing.
- **O8** After a timeout, a late 401 starts no second `getIdToken` and no fetch; a late 409 and a late 403 start no bootstrap request.
- **O9** 401 retry: exactly one retry with `getIdToken(true)`. With the first 401 at 5 000 ms and the second fetch pending, the result is `TIMEOUT` at 15 000 ms total (not settled at 14 999). A second 401 gives `failed` / `UNAUTHENTICATED` after exactly two fetches. A scope change between the 401 and the forced token gives no second fetch.
- **O10** A live 409 and a live 403 each give `failed` with the server code and start exactly one refresh bootstrap.
- **O11** Abandonment without advancing the clock, for each of: sign-out; account switch; a server-confirmed lifecycle change; a server-confirmed missing profile; a snapshot that changes the recipient; unmount. With the fetch held, the returned promise resolves `stale` in the same flush and the signal is aborted. Advancing 15 000 ms afterwards produces no further effect. Releasing a late 200, 401 or 409 publishes nothing and starts no fetch and no bootstrap beyond what the scenario itself starts. For sign-out and unmount, `jest.getTimerCount()` is 0.
- **O12** The listener confirms mid-flight: a snapshot carrying the acknowledgment while the fetch is held resolves the promise `acknowledged` at once and aborts the signal; the late response is ignored.
- **O13** Newer operation is isolated: operation A is held for recipient R1; a snapshot changes the recipient to R2, so A resolves `stale`. A second call starts operation B with its own held fetch. Releasing A's late 200 and advancing past A's original deadline leaves B pending (a third call returns B's promise; the fetch count is 2) and the user unchanged. B's 200 then acknowledges R2.

*Monotonic acknowledgment*
- **M1** API success, then a snapshot flagged `fromCache: false` with null ack fields for the same recipient: the user stays acknowledged and keeps the same object.
- **M2** The same with `fromCache: true`.
- **M3** A refresh bootstrap held from before the acknowledgment and released after it with a pending body: the user stays acknowledged.
- **M4** Acknowledged from the initial bootstrap, then a cached pending snapshot, then an acknowledged snapshot: acknowledged throughout.
- **M5** Pending, then a snapshot carrying the acknowledgment (cached, and separately server-flagged): published.
- **M6** Changed recipient: acknowledged for R1, then a snapshot with recipient R2 and the ack still R1 — the user is replaced and reads as pending. The same through a bootstrap response.
- **M7** Scope isolation: account A acknowledged, switch to account B with a pending profile — B is pending. 2026 acknowledged, then a server-confirmed Start and a 2027 bootstrap with a new pending profile — pending. A bootstrap for the same account with a different profile id — pending.
- **M8** Acknowledged, then a snapshot with an unknown `drawMode` value: the user is replaced and reads as invalid.

*Change detection*
- **D1** A snapshot that only adds `drawMode: 'auto'` to an assigned manual profile replaces the user (now pending).
- **D2** A snapshot that only changes `drawMode` from `'auto'` to another value replaces the user (now invalid).
- **D3** A snapshot that differs only in `revealAckAt`, or only in an unrelated field, keeps the same user object.

#### 22. `__tests__/unit/useAdminYearActions.test.js` (modified)

Update the expected Start prompt string in "Start: the prompt lists the roster…" to the new sentence. Nothing else changes.

#### 23. `__tests__/integration/firestore-rules-years.test.js` (modified: add one test; import `updateDoc`)

"automatic-draw profiles are never client-writable", in active 2026 with the identity pointing at an automatic profile in a three-profile ring:

- `updateDoc` of own `revealAckRecipientId`, of `revealAckRecipientId` plus `revealAckAt`, of `drawMode`, and of `recipientId` all fail; a merge `setDoc` fails.
- A reciprocal re-claim batch fails.
- Two automatic profiles with null pairings cannot claim each other.
- A manual profile cannot claim an automatic one, and an automatic profile with a null recipient cannot claim a manual one.
- Reads of the automatic profiles succeed.

The existing "own writes in 2026 succeed" test stays as the manual-profile control.

#### 24. `__tests__/integration/firestore-rules-admission.test.js` (modified: add one test)

In the root collections, two profiles seeded with `drawMode: 'auto'` and null pairings cannot be claimed by a reciprocal batch. The existing reciprocal-claim tests stay unchanged.

#### 25. `e2e/year-rollover.spec.ts` (modified)

Update the header comment. Add a helper that reads `years/{year}/users/{id}` with emulator owner access and returns `fields.name.stringValue`. From "Admin starts 2026" onward:

1. The other browser shows `getByTestId('recipient-reveal')` without a reload, with a new profile id.
2. `recipient-reveal-name` has the name of the 2026 profile whose id is that user's `recipientId`.
3. `Browse past years` → the 2025 archive with its pairings → `Back to current year` → the reveal is still shown.
4. Reload before acknowledging: the reveal is shown again.
5. A second browser context for the same participant also shows the reveal.
6. If the admin is on the 2026 roster: the admin's page shows the reveal and a `Close 2026` button.
7. The excluded participant sees Access Denied (unchanged).
8. Press Continue in the first browser: the chats appear and `__e2eUserData__.revealAckRecipientId` equals `recipientId`. The second context leaves the reveal without a reload.
9. Reload the first browser: no reveal.
10. A third fresh context for the same participant: no reveal, chats shown.
11. Send the 2026 message from the Recipient tab (replacing the combobox steps), then the retired-reset check (unchanged).

## Primary-executed steps

- Save this revision as the root `PLAN.md`.
- No deletions, installs or generated files. New directories are created by writing the files.
- Git: this plan requires no Git action. Branching, commits, pushes and pull requests happen only as the owner directs, without disturbing pre-existing work. If a commit is later directed, stage explicit paths only and keep `.claude/settings.local.json` and the three untracked `public/` files out.
- Provision a supported Node (`>=22.13.0 <23`) before any check.
- Before emulator-backed checks, inspect ports 8080, 9099, 4000 and 3000; use only emulators the primary starts.
- Deployment (including a Firestore rules deploy), production reads and publication are not authorized by this plan. For the owner's awareness: the app and rules must be live before the admin presses Start for the year that should be automatic.

## Verification (primary)

Passing means zero failures and no unhandled-rejection output.

1. `git diff --check`; changed paths are exactly the 25 files above plus `PLAN.md`, `RESEARCH.md` and the owner's pre-existing changes.
2. **Audit of the diff:**
   - No `@/lib/firebase` or `firebase-admin` import in any client file; no `firebase/firestore` or `@/lib/firebase-client` import in the route, `recipient-draw.js` or `recipient-reveal.js`.
   - `recipient-reveal.js` imports nothing; no client file imports `recipient-draw.js`.
   - The draw is computed before `runTransaction`. No pairing appears in a log line, in Start's response, or in the acknowledge response beyond the caller's echoed ids.
   - The acknowledge route's only `users` write is the two-field `tx.update` on `profileId`.
   - In `acknowledgeReveal`, every `getIdToken`, `fetch` and `startBootstrapNow` sits in the same synchronous block as a passed checkpoint. `settleRevealAck` awaits nothing. The returned promise is the operation's own, not a race with the work.
   - `keepAcknowledgment` is used by both the bootstrap accept branch and the snapshot handler, and neither reads `fromCache` for existing documents.
   - `src/lib/message-utils.js`, the send route, `firestore.js`, `RecipientSelector.js` and the bootstrap route are byte-identical.
   - No new `onSnapshot`.
3. **Focused unit tests:** `npx jest __tests__/unit/recipient_draw.test.js __tests__/unit/recipient_reveal.test.js __tests__/api/reveal_acknowledge_api.test.js __tests__/unit/RecipientReveal.test.js __tests__/unit/home_reveal.test.js __tests__/unit/useUser_realtime.test.js __tests__/lib/participant_admission.test.js __tests__/unit/useAdminYearActions.test.js` — three consecutive runs.
4. **Unmodified regressions:** `npx jest __tests__/unit/app_flows.test.js __tests__/unit/admin_ui.test.js __tests__/unit/RecipientSelector.test.js __tests__/lib/firestore.test.js __tests__/api/dev_assign_api.test.js __tests__/api/auth_bootstrap_api.test.js __tests__/api/admin_year_api.test.js __tests__/unit/PublicFeed_grouping.test.js __tests__/unit/ArchiveViewer.test.js`.
5. `npm run lint`.
6. `npm test`, reported against this branch's pre-change count.
7. `npm run build`.
8. `npx firebase emulators:exec --project=xmasteak-app "npm run test:integration"` — includes both rules suites, `year-lifecycle` and the new `recipient-reveal` suite.
9. `npx firebase emulators:exec --project=xmasteak-app "npm run test:e2e"` — the full Playwright suite, since the other specs cover the manual-year flow.

**What these would show, if they pass:**
- The draw is complete, valid, single-ring and stable across retries, and Start stays atomic and idempotent.
- Acknowledgment is fenced, idempotent and server-only, and client writes to automatic profiles are denied by the rules.
- An ended acknowledgment operation starts nothing and publishes nothing, and a newer operation is unaffected by an older one.
- For one tuple the acknowledgment does not regress in a page session; another tuple is independent.
- Manual years behave as before, apart from scoped archive browsing.

**What they cannot show:**
- Statistical quality of the operating system's random source (the tests show uniformity given a uniform source).
- Behaviour on real devices, with a real service-worker cache, or in production data.
- Behaviour after out-of-band edits (contract item 9 and section 6.2).
- That nobody inspects raw Firestore data.

## Risk-area flags

- **Security rules:** one added function used by two existing rules; needs a rules deploy. Until then, application-created automatic profiles are still unclaimable, because their pairing fields are never null.
- **SDK separation:** kept. The route and `participant-admission.js` use the Admin SDK; `UserContext.js` and `page.js` use the Client SDK; the two new lib files and the component import neither.
- **Listener reads:** no new listener. Per acknowledgment, once per participant per year: one profile-listener update (the document changed) and one refetch of the year's users (the existing effect re-runs when the user object changes), at most roster size + 1 document reads.
- **Message routing:** untouched. `PublicFeed_grouping.test.js` runs as a regression only.
- **Anonymity:** unchanged trust model and no new boundary. Pairings exist in readable `users` documents from Start rather than from each person's manual choice. The reveal names only the recipient. A single ring lets each participant exclude one person as their Santa.
- **Concurrency:** Start, Close and acknowledge all read `system/lifecycle` in their transactions and serialize on it. The draw is fixed before the transaction.
- **Client fencing:** the acknowledgment operation follows the existing pattern — auth generation, published-scope match, one deadline, synchronous idempotent abandonment — and adds a reconcile step to `applyState`, the single publication point.
- **Old builds:** a tab on the previous build skips the reveal and cannot write anything to automatic profiles. During deploy skew, a new client against an old server gets a failed acknowledgment and keeps the reveal. An admin on an old tab sees the old prompt sentence.
- **Dev assign (development only, 403 in production):** unchanged. In an automatic year it overwrites pairings; a participant whose recipient changed sees a new reveal for the new recipient.
- **Manual years:** the only behaviour change is that "Browse past years" no longer carries over to another account or year.

## Deferred (not in this change)

- **Year-level draw marker.** Detection is per profile (contract items 8–9). A marker on `system/lifecycle` would also cover every mode-bearing profile being removed outside the app, but it changes the lifecycle shape, its interpreter in `year-paths.js`, Close, the rules' view of the document, and their tests. The planner does not consider it essential for application-created data; see Open decision 8.
- Adding or removing a participant after an automatic Start. Adding is refused with `PROFILE_CONFLICT`. Removing leaves that person's Santa and recipient without a counterpart, as it does today in manual years.
- Any reroll, exclusion rules, or conversion of a year that is already running.
- Requiring acknowledgment on the server before messages can be sent.
- An admin view of who has not yet opened their reveal.
- `BACKLOG.md` still mentions `/api/admin/assign` and an AdminPanel `full` variant, neither of which exists in `src/`. This plan leaves it alone.

## Open decisions (owner)

1. **Which year becomes automatic.** The draw applies to years started after this is deployed. If 2026 has already been started in production, it stays manual and 2027 is the first automatic year; converting a running year would need a separate plan. *Recommendation:* approve as written and confirm the current production year state before any deploy.
2. **Meaning of "once".** Acknowledged on Continue, saved on the server, with the limits listed above. *Recommendation:* approve. Marking it seen on first display would lose the reveal on any crash or failed load.
3. **Draw shape.** A single random ring, with no exclusions. The alternative is any valid assignment, which allows two people to draw each other. *Recommendation:* the single ring; it is simple, always valid, and matches the existing dev helper.
4. **Second device.** When one device confirms, others showing the reveal move to the chats on their own. *Recommendation:* yes.
5. **Old tabs.** They skip the reveal until reloaded. The alternative is forcing a reload by raising the client version, which also interrupts anyone mid-chat. *Recommendation:* no forced reload.
6. **Rules guard.** Include the `isManualProfile()` guard (needs a rules deploy), or rely on the data invariants alone. *Recommendation:* include it.
7. **Wording.** The reveal copy and the new Start prompt sentence are as written above. *Recommendation:* approve or amend the text at approval.
8. **Automatic-year detection.** Accept per-profile detection with the stated bound, or add a year-level marker at the cost of a lifecycle schema change and a wider diff. *Recommendation:* accept per-profile detection; the uncovered cases need edits made outside the app.

## Not verified by the planner — for the primary

- Nothing was run. All syntax and behaviour claims come from reading the code.
- The rules expression `resource.data.get('drawMode', null) == null` follows the `.get(key, default)` pattern the file already uses on the lifecycle document; the emulator suites must confirm it on `resource.data`.
- The synchronous `randomInt(max)` from `node:crypto` on the supported Node version.
- Whether ESLint accepts the new component, the `page.js` timer and the `applyState` change as written (the repository has rules about state updates in effects).
- That the never-settling and ignored-abort cases in file 21 behave as described under the existing fake-timer harness.
- The production lifecycle state, and how Firestore rules are deployed for this project.
- Whether the installed PWA's service worker keeps old builds alive long enough to matter for decision 5.
- `docs/runtime-verification.md` was not read; it may describe the manual 2026 Welcome screen and need a follow-up note.
- Whether the admin account is on the 2026 roster; the end-to-end step for the admin's reveal is conditional for that reason.

## Review resolutions (revision 2)

1. **Abandoned acknowledgment work (blocker) — fixed in 6.1, 6.3, 6.6.**
   - Each operation has one fence, `op.settled`, set by a synchronous, idempotent `settleRevealAck` that clears the timer, aborts, releases the ref only if it still holds that operation, and resolves the operation's own promise. It waits on nothing.
   - Liveness is checked after the token resolves, after the headers, and after the body, and now includes the fence and the auth generation. Every token request, fetch and bootstrap starts in the same synchronous block as a passed check.
   - The 401 retry is once, under the same single deadline.
   - `applyState` reconciles the held operation on every publication, so an account, lifecycle, profile or recipient change abandons it immediately.
   - Late-result policy: discard. The existing listener or an idempotent retry recovers a commit whose response was late.
   - Tests O5–O13 cover never-settling auth and body, ignored abort, late auth/401/403/409 after timeout, cancellation without advancing the clock, the same-deadline retry, and a newer operation surviving an older one.
2. **Monotonic acknowledgment (blocker) — fixed in 6.2, 6.4, 6.5.**
   - One helper, `keepAcknowledgment`, is shared by the bootstrap accept branch and the snapshot handler; `fromCache` is no longer consulted.
   - For the same profile and recipient, pending never replaces acknowledged in a page session. A different recipient, profile, year, epoch or account is not latched.
   - 6.2 states the source policy and why an acknowledged value is trusted for its exact write-once tuple without calling it newly confirmed. It also states the one uncovered case (an out-of-band reset).
   - The old R11 is reversed. Tests M1–M8 cover a delayed server-flagged null snapshot after API success, a delayed bootstrap, cache regressions, a changed recipient and scope isolation.
3. **`drawMode` change detection — fixed in 6.5.** `modeChanged` is part of change detection; a `revealAckAt`-only difference is deliberately ignored and documented. Tests D1–D3 and M8.
4. **Contract item 5 — narrowed.** It now says only that Start's response and logs carry no pairing data and that acknowledge echoes the caller's own ids. It states that bootstrap returns the caller's own pairing, an admin participant sees their own recipient, and `users` stays readable. No boundary upgrade is implied. Tests assert the response shapes.
5. **Fail-closed boundary — bounded in contract items 8–9, file 5 and Deferred.**
   - The promise is now: no new `users` document and no reveal-field change for a missing member while at least one mode-bearing profile remains, for application-created data.
   - Index and admission repair for existing profiles is explicitly allowed, and the "zero global writes" claim for seeding is removed.
   - One unit test (seeding with repair) was added and the integration case was reworded.
   - The year-level marker is flagged as a tradeoff, not added.
6. **Archive visibility — fixed in file 8.** `showArchive` is derived from a stored scope key compared with `usersScopeKey`, so a new year or account opens on its reveal while same-scope browsing still works. `activeTab` and sound state are untouched. Tests cover rollover, account switch and same-scope persistence, for both reveal and manual profiles. This applies to the manual pre-selection screen too, which is flagged.
7. **Workflow — fixed in Primary-executed steps.** The branch-from-`main` instruction is removed; Git, deployment, production reads and publication are stated as not authorized by this plan and left to the owner's direction. File names and contracts are retained; the total is still 25 files.

**Unresolved owner choice added by this revision:** Open decision 8 (per-profile detection versus a year-level marker). Decisions 1–7 are unchanged.
