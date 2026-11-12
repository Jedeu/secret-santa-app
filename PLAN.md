# PLAN.md: Bound iPhone notification setup so "Saving…" always settles

## Status

**Status: APPROVED, revision 2, 2026-11-12 UTC. Adversarial review: COMPLETE — no blocking objections.** The owner answered “Yes” to approval of this notification plan and a separate PR. Planner: Opus 5.5, branch `fix/iphone-push-saving`.

**Primary execution evidence (2026-11-12 UTC):** Opus implemented exactly the four approved files; model/tool scope was confirmed and audited. Primary adversarial code review found no blocking defects. Existing test bodies remain verbatim. All initial local checks passed under Node 22.15.0 in a credential-isolated disposable copy: baseline 699 unit/API tests; updated 741 tests in 57 suites (+42); focused 73 tests in 2 suites passed three consecutive runs; related regressions 60 tests in 7 suites; lint and production build passed. No unhandled-rejection diagnostics appeared. Real iPhone/FCM delivery, integration/rules/E2E and production operations were not run locally. Owner-file hashes and demo listeners/PIDs were unchanged. Publication is stacked on PR #64 to avoid conflicts in the root planning artifacts; client source remains this plan's four-file change. After adding the reviewed #64 base, the combined tree passed **767 unit/API tests** in 57 suites (725 in #64 plus 42 notification tests), the **73 focused tests**, lint and production build again. The four notification implementation files remained byte-identical before and after the base addition. Merge #64 before the notification PR.

**Primary review evidence:** revision 2 resolves independent timer/request cleanup and stale-account/attempt UI handling. Note objects use the declared `{ text: string, retry: boolean }` shape throughout (the string-name bullets are shorthand for the `text` value). Guarantees exclude already-dispatched server requests, as stated under Scope; the bounds are timer-driven and subject to JS scheduling/suspension, not strict wall-clock or CPU-time guarantees. The verification section lists planned assertions, not executed implementation tests. That review preceded implementation; the primary execution evidence above records the completed implementation and checks.

PR #64 (the flag removal) is complete and all its checks pass. The owner separately approved this notification implementation, local verification, and publication of a separate PR on 2026-11-12. Production Firebase access, real FCM sends, configuration/credential changes and deployment commands remain unauthorized.

## Goal

- Enable, disable, sync and retry each settle within a fixed amount of running JS time.
- Work that times out, is cancelled or is superseded is fenced off. Its timers and request handles are released at once, whether or not the browser, SDK or HTTP promises ever settle.
- A late result from that work starts no app request and changes no storage, server state or UI.
- The UI gives truthful feedback and offers an explicit retry where one makes sense.

## Scope

**Fixes:**
- The indefinite "Saving…" from the five unbounded waits in RESEARCH.md: permission, `serviceWorker.ready`, `getToken`, `getIdToken` and `response.json()`.
- Stale UI writes after an account switch or a later attempt.

**Does not verify:**
- Which stage stalls on the owner's iPhone, or how iOS presents the prompt.
- Real FCM/APNs token creation, or push delivery.
- The cause on the phone. RESEARCH.md's static asset checks do not identify the phone's URL or prove that a worker is missing, and this plan does not guess at the live cause.

**Cannot cancel:**
- A visible permission prompt, pending Firebase SDK work, or an HTTP request that was already sent.
- Aborting a request that was already sent does not mean the server skipped it. The server's epoch/revision checks still decide any commit that is in flight. The guarantee is only that no *additional* app request starts once an operation is abandoned.

**Unchanged:**
- Worker, manifest, next-pwa config, dependencies and Firebase config.
- Server routes and protocol: status-then-register on every round, with at most three conflict rounds.
- Firestore rules, `PushNotificationsRuntime.js`, `sign-out.js`, `UserContext.js` and `page.js`.
- The iOS install-hint UX.
- `releasePushRegistration`: its signature, its 3 s default and sign-out limit, its `false` results, and its rule that it never writes the preference.

## Proposed changes (4 implementation files; Client SDK only; plain JS with JSDoc, no TS annotations)

### 1. `src/lib/push-client.js` (imports unchanged)

**Constants:** `PERMISSION_TIMEOUT_MS = 30 * 1000`, `SETUP_TIMEOUT_MS = 45 * 1000`, `PUSH_TIMEOUT_CODE = 'PUSH_TIMEOUT'`. `REQUEST_TIMEOUT_MS` stays at 15 s.

**Timeout error:** `class PushTimeoutError extends Error`, constructed with `stage`.
- Message: `'Push setup timed out.'`. It never contains "permission".
- Fields: `name = 'PushTimeoutError'`, `code = PUSH_TIMEOUT_CODE`, `stage = stage ?? null`.
- JSDoc: `@param {'permission'|'service-worker'|'token'|'auth'|'request'|null} stage`.
- Export `isPushTimeoutError(error)`, which returns `error?.code === PUSH_TIMEOUT_CODE`.

**Operation shape:**
- `makeOperation` returns `{ generation, authUid, intentId, user, cancelled: false, stage: null, requests: new Set() }`.
- `requests` replaces `controllers`. Each entry is `{ controller, timer, timedOut }`.
- `releasePushRegistration` builds its operation with `makeOperation(user.uid, intentId)`, which gives the same fields as before.

**Stage:** set synchronously just before each wait.
- `'permission'` in enable, before `requestPermission`.
- `'service-worker'` and `'token'` in `obtainFcmToken`.
- `'auth'` and `'request'` in `postJson`, before `getIdToken` and before `fetch`.

**Realm state:** `const activeDeadlines = new Set();` holds the cancel function of each pending `withDeadline`.

**`abandonOperation(op)`:** synchronous and idempotent. It never waits for any fetch, body or SDK promise.
1. Set `op.cancelled = true`.
2. For each request: `clearTimeout(req.timer)` and `try { req.controller?.abort(); } catch {}`.
3. Call `op.requests.clear()`.

**`withDeadline(op, work, timeoutMs)`** returns a Promise.
- `work = Promise.resolve(work)`, with an explicit `work.catch(() => {})`.
- The deadline promise has an idempotent `settle(error)` that synchronously:
  1. clears its own timer;
  2. calls `activeDeadlines.delete(cancel)`;
  3. calls `abandonOperation(op)`;
  4. rejects with `error`.
- Timer callback: `settle(isCurrent(op) ? new PushTimeoutError(op.stage) : new PushAbortedError())`. The error type is chosen *before* the operation is abandoned.
- `cancel = () => settle(new PushAbortedError())`, which is added to `activeDeadlines`.
- Returns `Promise.race([work, deadline])`. Its `.finally` clears the timer and deletes `cancel`, which covers the path where `work` wins.
- When `work` wins, the operation is **not** abandoned. Enable continues from the permission step into setup on the same operation.

**Outcomes, and where each rejection is observed:**
- **`work` settles first:** its value or error reaches the caller's existing `catch`, exactly as today.
- **Timer fires first and the operation is still current:** the caller gets `PushTimeoutError(stage)`. Its `catch` rethrows it, because it is not an abort.
- **Timer fires first but the operation was already superseded** (another tab's intent, an auth change, or a generation bump): the caller gets `PushAbortedError` and returns `'aborted'` silently.
- **`cancelPushOperations()` is called:** the caller gets `PushAbortedError` and returns `'aborted'` immediately, with no clock advance.
- **Abandoned work resumes later:** it throws at its next `ensureCurrent(op)` (because `op.cancelled` is set), or it throws its own error. That rejects the inner `work` promise, for example `reconcile(op)`.
  - The rejection is observed by the handler that `Promise.race` already attached to `work`, and by the explicit `work.catch`. It is then dropped.
  - The caller's `catch` never sees it, because the outer await has already settled.
  - The throw happens before any `fetch`, so no follow-up request, storage write or `lastKnown` update occurs.

**`postJson(op, pathname, body)`:**
1. `ensureCurrent`, then the auth check.
2. `op.stage = 'auth'`; await `getIdToken()`; `ensureCurrent`.
3. Create `req = { controller, timer, timedOut: false }`. The 15 s timer sets `req.timedOut = true` and then aborts. Call `op.requests.add(req)`. The timer and request now cover both `fetch` and `response.json()`.
4. Inside `try`:
   - `op.stage = 'request'`, then `ensureCurrent` immediately before `fetch`.
   - If `fetch` rejects: `ensureCurrent(op)`, then throw `new PushTimeoutError('request')` if `req.timedOut`; otherwise rethrow.
   - After `fetch`: `ensureCurrent`.
   - If `json()` fails, `data = null`.
   - After the body: `ensureCurrent(op)`, then `if (req.timedOut) throw new PushTimeoutError('request')`.
5. `finally`: `clearTimeout(req.timer); op.requests.delete(req)`. This is normal-path cleanup only. Abandonment never waits for it.

The `{ ok, status, data }` return shape is unchanged, and a timed-out body is never treated as success. If fetch or the body ignores abort, the request timer still fires, and the operation deadline or a cancel settles the caller.

**Call sites:**
- **`enablePushForCurrentUser`:**
  - The synchronous preference, intent, operation and notify steps are unchanged.
  - Permission: `op.stage = 'permission'; const permission = await withDeadline(op, Notification.requestPermission(), PERMISSION_TIMEOUT_MS);`. `requestPermission()` is still evaluated synchronously inside the click, before any await.
  - The post-await `isCurrent` check and `PERMISSION_DENIED` handling are unchanged.
  - Then `return await withDeadline(op, reconcile(op), SETUP_TIMEOUT_MS);`.
- **`disablePushForCurrentUser` and `syncPushTokenIfGranted`:** `await withDeadline(op, reconcile(op), SETUP_TIMEOUT_MS)`. Sync still never prompts. Their existing `catch` blocks are unchanged.
- **`releasePushRegistration({ timeoutMs = 3000 } = {})`:**
  - Its timeout callback calls `abandonOperation(op)` instead of the inline controller loop, then resolves `false`.
  - At the limit, the request timer and controller are released even if the unregister fetch never settles.
  - It is not added to `activeDeadlines`; its own limit bounds it.
- **`cancelPushOperations()`:** `pushGeneration += 1; [...activeDeadlines].forEach((cancel) => cancel());`.

**New export `retryPushRegistration`:**
```js
/** @param {{ authUid?: string|null }} [options]
 *  @returns {Promise<'registered'|'disabled'|'skipped'|'aborted'>} */
export async function retryPushRegistration({ authUid } = {})
```
It never writes the preference and never prompts.
1. Return `'skipped'` if any of these holds: `!authUid`; `clientAuth.currentUser?.uid !== authUid`; `!isPushSupported()`; `Notification.permission !== 'granted'`; `getPushPreference(authUid) !== 'enabled'`. No network call, no storage write.
2. `const op = makeOperation(authUid, writeIntent(authUid));`. The fresh intent supersedes older work on this device, as a click does. The preference is re-read every round.
3. `try { return await withDeadline(op, reconcile(op), SETUP_TIMEOUT_MS); } catch (e) { if (isAbort(e)) return 'aborted'; throw e; }`

**Header comment:** add the bounded waits, `PushTimeoutError`, and the rule that retry never writes the preference.

### 2. `src/components/PushNotificationsControl.js`

**Imports:** add `retryPushRegistration` and `isPushTimeoutError`.

**Notes:** the note becomes `{ text, retry } | null`. Existing strings are unchanged. New strings:
- `ENABLE_TIMED_OUT_NOTE = 'Notification setup timed out before this device was confirmed. Tap Try again, or it will retry the next time the app opens.'`
- `PERMISSION_NOT_GRANTED_NOTE = 'Notifications are not allowed on this device yet. Tap Enable notifications to try again.'`

**`isPermissionError`:** returns `false` first when `isPushTimeoutError(error)`.

**`enableFailureNote(error, uid)`** is evaluated when the attempt settles and returns:
- `null` if `getPushPreference(uid) !== 'enabled'`. A newer disable elsewhere wins, so stale "enabled" text is never brought back.
- `null` if `readPermission() === 'denied'`. The existing blocked hint shows instead.
- `{ PERMISSION_NOT_GRANTED_NOTE, retry: false }` if permission is not `'granted'`. This includes a permission-stage timeout while permission is still `'default'`, and it has no step suffix.
- `{ ENABLE_TIMED_OUT_NOTE + ' (step: <stage>)', retry: true }` for a timeout while permission is `'granted'`. The suffix is added only when `stage` is set.
- `{ ENABLE_NOT_REGISTERED_NOTE, retry: true }` otherwise.

The disable-failure note `{ DISABLE_NOT_FINISHED_NOTE, retry: false }` is set only if `getPushPreference(uid) === 'disabled'` when the attempt settles.

**Attempt and account guard** (component-local; no `UserContext` change):
- Add `attemptRef = useRef(0)`. `togglePush` and `retryRegistration` each run `const attempt = ++attemptRef.current; const uid = authUid;` synchronously, before calling the client. A live check is `attemptRef.current === attempt`.
- Every post-await effect runs only while the attempt is live: the success toast, the failure note, the permission toast, and `refreshAfterAttempt(uid)` in `finally`. `console.error` logging is not guarded.
- The `[authUid]` preference-sync effect's cleanup runs on an account change or unmount. It:
  1. unsubscribes;
  2. runs `attemptRef.current += 1`;
  3. calls `setLoading(false)` and `setRegistrationNote(null)`.

  It starts no async work. The effect body then syncs the new account as today. If lint flags the setState calls in the cleanup, use the file's existing single-line disable pattern with a reason.
- `refreshAfterAttempt(uid)`: `next = getPushPreference(uid)`, `lastPreferenceRef.current = next`, `setPreference(next)`, `setPermission(readPermission())`, `setLoading(false)`.

**`togglePush`:**
- Order unchanged: guard, attempt, `setLoading(true)`, clear the note, then call enable or disable with no await before it.
- On failure: disabling → disable note; permission error → existing toast; otherwise `enableFailureNote(error, uid)`.

**`retryRegistration`:**
1. Return if `!authUid || loading`.
2. Start an attempt, set loading, clear the note, then `await retryPushRegistration({ authUid: uid })`.
3. `'registered'` → the `'Push notifications enabled.'` toast. Other results → no toast and no note.
4. On error: log it and set `enableFailureNote(error, uid)`.
5. `finally`: the guarded refresh.

**Render:**
- Show the note text.
- Below it, render `<button type="button">Try again</button>` only when `registrationNote?.retry && preference === 'enabled' && permission === 'granted'`.
- The button is `disabled={loading || !authUid}`. It uses the main button's border, radius, padding and font size, with neutral `var(--surface-highlight)` / `var(--foreground)` colours.

**Stage display (chosen):** show the `(step: …)` suffix for now, and only in the timed-out note.

### 3. `__tests__/unit/push_client.test.js`

All existing tests stay unchanged, including race tests 1–10, the preference-write audit 11, and 12a–12d.

**Helper additions:**
- Held entries gain `entry.fail(error)`, which rejects the fetch without applying it on the server.
- A local `deferred()`.
- `settle(p) = p.then((value) => ({ value }), (error) => ({ error }))`, attached before any clock advance so that no rejection is ever unhandled.

**New `describe('bounded setup')` block:**
- `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach`.
- Drive time with `await jest.advanceTimersByTimeAsync(ms)`. Do not use `until`.
- Every case ends with `jest.getTimerCount() === 0` and an `unhandledRejection` listener (the `typing-client.test.js` pattern) that was never called.

**Cases:**
- **B1. Permission pending.**
  - `requestPermission` is called synchronously, and there is one preference write.
  - At 30 000 ms the call rejects `{ code: 'PUSH_TIMEOUT', stage: 'permission' }`, with no `getToken` and no fetch.
  - A late `'granted'` or a late rejection causes no `setItem` and no fetch.
- **B2–B4. `ready`, `getToken` or `getIdToken` pending.**
  - Each rejects at 45 000 ms with stage `'service-worker'`, `'token'` or `'auth'` respectively. The preference stays `'enabled'`.
  - A late resolve or reject causes no `getToken` (B2) and no fetch.
- **B5a. Body honours abort.** Rejects at 15 000 ms with stage `'request'`, after one fetch, and the signal is aborted.
- **B5b. Body ignores abort.**
  - The signal is aborted at 15 000 ms, and the call rejects at 45 000 ms with stage `'request'`.
  - A late body causes no further fetch.
- **B6. Held in-flight request times out, then a retry succeeds** (`test.each` over a held status and a held register; the held fetch ignores abort).
  - Enable rejects with stage `'request'` at 45 000 ms.
  - `retryPushRegistration` returns `'registered'`, after exactly one new status and one new register. Record `server.row`.
  - Then call `release()` on the old entry (status → 200; register → 409 against the rotated revision), or `fail(new TypeError())`.
  - Expect no new r1 request, `server.row` unchanged, PREF_A written once, and no unhandled rejection.
- **B6b. Late `ready`.**
  - Enable times out at stage `'service-worker'`.
  - A retry with a resolved `ready` returns `'registered'`.
  - Resolving the old `ready` causes no `getToken` and no fetch.
- **B7. Retry is skipped** when PREF_A is `'disabled'`, when there is no user or another user, or when permission is `'default'`. No fetch, no `requestPermission`, and no `setItem` of the preference or the intent.
- **B8. Superseded at the deadline.** Another intent is written while `ready` is pending. At 45 000 ms enable resolves `'aborted'` and does not reject.
- **B9. Cancel during `ready`.** `cancelPushOperations()` resolves enable as `'aborted'` without any clock advance, and the timer count is 0.
- **B10. Cancel while held headers or a pending body ignore abort.**
  - Synchronously after `cancelPushOperations()`: `getTimerCount() === 0`, and the captured signal is aborted.
  - Enable settles `'aborted'` with no clock advance.
  - A late resolve or reject causes no further fetch and no unhandled rejection.
- **B11. Disable and sync are bounded.**
  - Disable with `getToken` pending rejects with stage `'token'`, and the preference stays `'disabled'`.
  - Sync with `ready` pending rejects with stage `'service-worker'` and never calls `requestPermission`.
- **B12. Release with a held unregister that ignores abort,** `timeoutMs: 3000`.
  - Returns `false` at 3 000 ms, and the timer count is 0 (the 15 s request timer is cleared).
  - The preference is unchanged.
  - A late `release()` is decided by the server's revision check, and no further request follows.

### 4. `__tests__/unit/PushNotificationsControl.test.js`

The mock adds `retryPushRegistration: jest.fn()` and `isPushTimeoutError: jest.fn((e) => e?.code === 'PUSH_TIMEOUT')`. Existing cases stay unchanged. Pending calls use deferreds.

- **U1. Timeout while granted.** Permission is granted and enable rejects with a timeout at stage `'token'`.
  - The UI is not on "Saving...", and the label is "Disable notifications".
  - The note contains "timed out" and "(step: token)", and "Try again" is visible.
  - No toast.
- **U2. Permission still `'default'`.** Enable rejects with a timeout at stage `'permission'`.
  - The label is "Enable notifications", with the permission-not-granted note.
  - No "step" text, no "Try again", no toast.
- **U3. Timeout is not "blocked".** A timeout whose message contains "permission" does not show the blocked toast. `PERMISSION_DENIED` still shows it.
- **U4. Try again.**
  - Calls `retryPushRegistration({ authUid })` once and does not call enable again.
  - On `'registered'`: the enabled toast, and the note is cleared.
- **U5. Retry outcomes.**
  - A retry that times out again brings back the note and "Try again".
  - `'skipped'` or `'aborted'` gives no toast and no note.
  - The UI is never left on "Saving...".
- **U6. Another tab disables after U1.** The note and "Try again" disappear.
- **U7. Another tab disables while an enable or a retry is pending,** and then that call rejects with a timeout.
  - The label is "Enable notifications".
  - No note, no "Try again", no toast.
- **U8. Account switch from A to B** (`test.each`: A late-resolves `'registered'` / A late-rejects with a timeout).
  - A's enable is pending, and A's preference is `'enabled'`.
  - Rerender with B, whose preference is `'disabled'`. Immediately: not "Saving...", and the label is "Enable notifications".
  - Click to start B's enable, which stays pending.
  - Settle A. B is still on "Saving...", with no toast and no note.
  - Settle B with `'registered'`. Exactly one enabled toast, and the label is "Disable notifications".
- **U9. Unmount.** Unmount while an attempt is pending, then settle it. No toast.

## Primary-executed steps

- None for implementation: no deletions, installs or generated files.
- All Git work stays with the primary on `fix/iphone-push-saving`.
- Stage explicit paths only: the four files plus `PLAN.md` and `RESEARCH.md`.
- Never stage `.claude/settings.local.json` or the three untracked `public/` files.
- The owner's 2026-11-12 approval authorizes committing, pushing this branch and opening a separate draft notification PR after review and verification. Never push directly to `main`.

## Verification (primary)

**Preconditions:**
- Node 22.15.0.
- Work in a disposable copy that excludes `.env*`, credentials, `.claude/settings.local.json` and the generated `public/` files.
- Reuse installed dependencies that match the lockfile; install nothing.
- Use an isolated HOME and config, and an allowlisted environment with placeholder non-production `NEXT_PUBLIC_FIREBASE_*` values and `PUSH_DISPATCH_ENABLED=false`.
- Leave the owner's demo and its ports alone.
- Record checksums of the four owner files before and after.

**Checks** (pass means zero failures):
1. `git diff --check`. Changed paths are exactly the four files, `PLAN.md`, `RESEARCH.md` and the owner's pre-existing changes.
2. **Audit:**
   - No `@/lib/firebase` or `firebase-admin` import.
   - `requestPermission()` is evaluated before any await in enable.
   - `togglePush` calls enable or disable before any await.
   - Preference writes appear only in the click paths.
   - `abandonOperation` clears timers and requests synchronously.
   - The `releasePushRegistration` 3000 default and `sign-out.js` are unchanged.
   - Every post-await UI effect is behind the attempt guard.
3. **Focused tests, three consecutive runs:** `npx jest __tests__/unit/push_client.test.js __tests__/unit/PushNotificationsControl.test.js`. The output must contain no unhandled-rejection or `PromiseRejectionHandledWarning` text.
4. **Regressions:** `npx jest __tests__/unit/PushNotificationsRuntime.test.js __tests__/unit/worker_push_display.test.js __tests__/unit/pwa_manifest_assets.test.js __tests__/unit/next_config_pwa.test.js __tests__/unit/useUser_realtime.test.js __tests__/unit/RecipientSelector.test.js __tests__/unit/app_flows.test.js`, plus any existing sign-out unit test.
5. `npm run lint`
6. `npm test`. Report the count against this branch's pre-change baseline, not PR #64's 725.
7. `npm run build` in the copy, then confirm the owner-file checksums are unchanged.

**Not run:**
- Integration, rules and E2E suites. There is no server, rules or protocol change, those suites wipe the emulator, and the owner's demo holds the ports. A future PR's CI would run them.
- Any real device, real FCM or production check. These are not authorized.

## What the tests prove and what they cannot

- **Proven, synthetically:**
  - Each wait is bounded in fake-timer time.
  - Timeouts, cancels and supersession release their timers and requests.
  - Late results start no request and change no storage, server state or UI.
  - Stale attempts cannot touch a later attempt or another account.
- **Not proven:**
  - Real iPhone token registration, or APNs/FCM delivery.
  - Which stage stalls on the phone, and whether iOS showed the prompt or the owner tapped Allow.
  - Whether iOS aborts a pending body read.
- **Timing:**
  - The bounds count running JS time only. iOS may suspend timers while the app is backgrounded or a prompt is open, so settlement can take longer on the wall clock.
  - Running-time worst cases: enable 30 s + 45 s; disable, sync and retry 45 s each.
- **Feedback:**
  - Only a timeout while permission reads `'granted'` names a step.
  - A permission timeout while permission is `'default'` shows the permission-not-granted note.
  - Denied, generic and aborted outcomes name no step.
- **After an authorized deploy**, the owner taps Enable on the installed iPhone. Expect one of: a success toast, a timed-out note with a step, the permission note, or the generic note. Delivery needs a separately authorized real send.

## Risk-area flags

- **SDK separation:** preserved; Client SDK only.
- **Untouched:** message routing, Firestore listeners, security rules, anonymity.
- **Fencing:** the preference, intent, generation and auth fences are unchanged; the deadline adds operation-level abandonment. `cancelPushOperations` now also settles and aborts this tab's pending operations. Server revisions still decide requests that were already sent.

## Deferred (not in this change)

- The iOS install hint sits behind the unsupported early return.
- The `PERMISSION_DENIED` toast says "blocked" even when the prompt was only dismissed.
- When another tab supersedes an operation, this tab notices at its next fence or at its deadline (≤45 s), not immediately.

## Approval request (owner)

1. Approve this plan as written (30 s permission timeout, 45 s setup timeout, `(step: …)` shown in the timed-out note), or amend those values.
2. Separately: after verification, should a separate notification PR be published? I recommend a draft PR with no deploy. Nothing is published until you direct it.

## Review resolutions

1. **Cleanup independent of fetch settlement (blocker):**
   - `abandonOperation` synchronously clears each request's timer, aborts its controller and empties `op.requests`. `withDeadline`'s `settle` does its own cleanup synchronously.
   - Release's 3 s timeout uses the same helper.
   - B10 and B12 cover held headers and bodies that ignore abort: immediate settlement, zero timers, and no follow-up request.
   - Server revisions decide any request that was already sent.
2. **Stale UI (blocker):**
   - An attempt counter guards every post-await UI effect.
   - The `[authUid]` effect cleanup invalidates pending attempts and resets loading and the note, without starting async work.
   - Settle-time preference checks stop stale enabled or disable notes from coming back.
   - U7–U9 cover these. No protocol or `UserContext` change.
3. **Regression completeness:**
   - B6 covers a held status or register, timeout, retry success, then late release or rejection.
   - Every timeout case asserts zero timers and covers late rejection. `settle()` attaches handlers before clock advances.
   - All existing tests are retained.
4. **Signatures and wording:**
   - Signatures are JSDoc only.
   - "Outcomes, and where each rejection is observed" now states where a stale rejection is observed (the `Promise.race` handler and the explicit `work.catch`) and how a deadline timeout differs from a silent stale abort.
5. **UI and verification precision:**
   - Only a timeout while permission is granted names a step.
   - The bounds count running JS time, not the wall clock.
   - Device delivery and the phone's stalled stage stay unverified.
6. **Decisions made:**
   - The values are chosen as written, and the owner can amend them at approval.
   - Publication is a separate question in the approval request.
   - Still four implementation paths; no worker, config, SDK, server or rules change; no install-hint UX work.
