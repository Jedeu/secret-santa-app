# Research: iPhone notification setup stuck on “Saving…”

## Request, workflow and boundaries

The owner reports that after adding the app to the iPhone Home Screen, tapping Enable notifications leaves the control stuck on “Saving…”. The owner requested investigating this after completing the year-transition flag-removal PR.

That separate change is complete: PR **#64**, https://github.com/Jedeu/secret-santa-app/pull/64, commit `7080d5b`. Its primary checks passed (725 unit/API, 48 lifecycle integration, lint/build). At the latest GitHub check, **all checks passed**, including Vercel preview, lint, unit, integration and E2E. It is not part of this notification change.

This branch is `fix/iphone-push-saving`, based on `origin/main` at `687b9b8` when created. Notification source is identical to that in PR #64; the flag-removal PR is not a dependency. Prior archives research/plan remain in Git at `4b65590`; the gate-removal research/plan at `7080d5b`.

The owner explicitly changed the small-fix workflow: **Opus plans and implements; primary performs adversarial review and all checks/Git**. Do not use Fable. A reviewed plan still needs owner approval before implementation. The owner approved reviewed revision 2 and a separate notification PR on 2026-11-12 by answering “Yes” to the primary's explicit approval request. No production Firebase access, deploy, configuration/credentials change or real push test is authorized.

Protect the owner's pre-existing `.claude/settings.local.json` and untracked `public/sw.js`, `public/workbox-f1770938.js`, `public/worker-2a484529a5551160.js`. They remain unchanged and must not be edited or staged. The separate screenshot demo is still running on owned default ports and must not be stopped or wiped.

## What is known and what is not

- The owner confirmed iPhone plus Home Screen installation, and now sees the actionable toggle rather than “Notifications unavailable”.
- Primary asked: did iOS show an Allow Notifications prompt, and did the owner tap Allow before the stall? An answer is pending. Do not infer permission state, iOS version or the precise stalled stage.
- No Safari remote inspector trace or real-device reproduction is available. The code defects below are independently reproducible pending-promise paths, not proof of which path is happening on this phone.
- Static-only HTTPS checks executed no app scripts and touched no Firebase/API endpoints. The immutable Production deployment URL from GitHub redirects its `/sw.js` and manifest requests to Vercel (protection/login), so those responses do not reveal the app's worker state. The repository homepage URL returns 404 for both assets and may be stale. The actual URL installed on the phone is unconfirmed; do not treat either result as evidence that the phone's worker is missing. Results are recorded in the notification artifact directory.
- Home Screen push support is a platform requirement, not a guarantee of successful registration or delivery.

## Baseline code ground truth (before this fix)

### UI: `src/components/PushNotificationsControl.js`

- `togglePush` sets `loading=true` before awaiting `enablePushForCurrentUser` or `disablePushForCurrentUser`. Only its `finally` sets `loading=false`.
- Consequently, any never-settling operation leaves the disabled button labelled “Saving…” forever.
- Support checks run after mount to avoid hydration mismatch. They require browser APIs and three public Firebase push settings via `isPushSupported`.
- The existing iOS install hint is behind the unsupported early return; this is a distinct UX issue and not necessary to solve the reported post-install stall.
- The label reflects **desired preference + permission**, not server-registration success. A failed enable with permission granted currently leaves “Disable notifications” plus an explicit not-registered note. Preserve that distinction or explicitly plan a narrow, tested change; never claim delivery is active merely because permission was granted.
- The current generic enable error note says it will retry when the app opens. There is no explicit retry action in this component.

### Client pipeline: `src/lib/push-client.js` (Client SDK only)

Imports `firebase/app`, `firebase/messaging` and `clientAuth` from `@/lib/firebase-client`. No Admin SDK belongs here.

Enable order:
1. Validate support and authUid.
2. Synchronously persist that account's desired enabled preference, write the device-intent id, create the operation and notify subscribers.
3. Call `Notification.requestPermission()` if needed.
4. `reconcile(op)` -> `obtainFcmToken(op)` -> `navigator.serviceWorker.ready` -> Firebase `getToken(messaging, { vapidKey, serviceWorkerRegistration })`.
5. Up to three rounds of authenticated `/api/push/status` then `/api/push/register`, using fresh epoch/revision and the latest stored preference every round.

Unbounded waits:
- `Notification.requestPermission()`.
- `navigator.serviceWorker.ready` (specifically never rejects and may wait forever).
- Firebase `getToken()`.
- `op.user.getIdToken()` before each API call.
- HTTP response-body `response.json()`: the existing 15-second AbortController timer is cleared immediately after `fetch` returns headers, before JSON is read.

The only request timeout currently covers the `fetch` await, not the entire operation. `enablePushForCurrentUser`, `disablePushForCurrentUser` and `syncPushTokenIfGranted` have no overall settlement bound. `releasePushRegistration` already has its own bounded timeout, marks its op cancelled and aborts its fetch controllers; it returns false and never changes the preference.

### Existing concurrency and authorization contracts (must survive)

- Desired preference is per account (`secret-santa-push-pref:{authUid}`), written only by an explicit enable/disable click before its first await. Never roll it back or write it after an await; sync, release and retries never write preference.
- Device intent, realm generation, captured auth user and epoch/revision are independent fences. `ensureCurrent(op)` runs after awaits and immediately before network work. An obsolete operation returns `aborted` and starts no further app API requests.
- A bare UI Promise.race that merely clears the spinner is insufficient: abandoned work could later resume and mutate registration or overwrite a retry's UI. Any timeout/cancellation must preserve those fences. Browser prompts/SDK promises themselves may not be cancellable; do not claim otherwise.
- The server registration protocol must remain unchanged: status then register on every reconcile round, even if already matching; three conflict rounds maximum; revisions rotate; unregister is owner checked.
- `cancelPushOperations` is used by `UserContext` session/lifecycle cleanup, `PushNotificationsRuntime` effect cleanup and sign-out. `src/lib/sign-out.js` limits cleanup to three seconds; do not make sign-out wait longer.
- Background sync is opt-in/per-account and must never prompt for permission. iOS permission invocation must still occur directly from the explicit user gesture, before introducing any await ahead of it.
- JS timers may be suspended while iOS backgrounds an app; no precise wall-clock guarantee can be made while execution is suspended.

### Worker/install configuration

- `next.config.js`: next-pwa, `register: true`, `skipWaiting: true`, custom source `worker`, disabled only in development.
- `worker/index.js`: Firebase messaging SW initialization when public messaging config is present; notificationclick behavior. No missing registration logic was proven here.
- `public/manifest.json`: `display: standalone`, start URL `/`; layout links the manifest and Apple web-app metadata.
- No evidence currently justifies changing the manifest, worker, next-pwa setup, dependencies, push server, API contracts, Firestore rules or Firebase configuration.

## Executed research probe (not a real-device or real-FCM test)

Primary ran the **actual unmodified** `push-client.js` in isolated Node 22.15.0 VM modules. All Firebase imports, browser APIs, auth and fetch were synthetic; no network, credentials or database were used. The existing HTTP timer was accelerated to 20ms; observation was 100ms. A normal synthetic flow registered successfully. Each isolated pending stage left enable unsettled:

| Scenario | Result at observation | App API fetches |
|---|---|---|
| Normal synthetic success | `registered` | 2 |
| Service-worker ready pending | unsettled | 0 |
| FCM token pending | unsettled | 0 |
| Permission pending | unsettled | 0 |
| Auth token pending | unsettled | 0 |
| Response JSON pending | unsettled, its fetch timer already cleared | 1 |

The source has no other bound on these waits, and the UI awaits that result before its finally. This confirms a code path that can produce the reported indefinite “Saving…” behavior; it does not establish the phone's precise cause or prove actual push delivery.

Artifacts: `/tmp/secret-santa-iphone-push-saving.JwbbBh/probe.mjs`, `probe-results.jsonl`, `probe.stderr`. Probe exit code 0 means its expected success/pending observations matched, not that the bug was fixed.

## Existing tests and verification considerations

- `__tests__/unit/push_client.test.js`: two synthetic realms, shared storage, mocked messaging and a stateful revision-fenced fake server. Covers ordering races, account switch, delayed permission, preference-write audit, conflicts, release timeout, listener/storage behavior and sync. Worker readiness, token acquisition and most calls are currently immediately-resolved mocks; there is no never-ready/token/body bound test.
- `__tests__/unit/PushNotificationsControl.test.js`: success, generic failure and aborted states, account preference updates, install hint; no stuck-operation/retry test.
- Related untouched regressions: `PushNotificationsRuntime.test.js`, `worker_push_display.test.js`, `pwa_manifest_assets.test.js`, `next_config_pwa.test.js`, UserContext and sign-out tests.
- Keep real device limitations explicit. Unit/fake-timer coverage can prove deterministic settlement, actionable feedback and stale-completion fencing, but not iPhone push delivery. Any real-device verification must be performed separately with the owner.
- Node >=22.13.0 <23 required; supported 22.15.0 binary is available. Primary runs lint, relevant focused regressions, full unit/API suite and production build in a disposable copy, excluding `.env*`, credentials, owner settings and generated files. Use an allowlisted environment and isolated HOME/config; no production keys or real FCM dispatch.
- Emulator suites wipe entire databases and default ports are occupied by the screenshot demo. No new emulator check is obviously necessary for a client-only fix that leaves the server protocol unchanged; the planner should scale checks accordingly and explicitly list suites not run.

## Risk areas

Client SDK separation, operation/identity/lifecycle cancellation, permission user-gesture timing, misleading success UI, timer cleanup, retry races and late non-cancellable SDK completions. Message routing, Firestore listeners, security rules, the anonymity model, rosters and year transitions need no changes.

## External sources checked by primary

- MDN `ServiceWorkerContainer.ready`: promise never rejects and waits indefinitely for an active worker. https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/ready
- Firebase messaging API: `getToken` returns a promise, accepts the service-worker registration; don't migrate messaging APIs/SDK versions as part of this fix. https://firebase.google.com/docs/reference/js/messaging
- WebKit iOS push: Home Screen web apps, iOS/iPadOS 16.4+, permission request from direct user interaction. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## Opus handoff and adversarial review

Opus (`claude-opus-5-5`, xhigh) drafted a four-file plan and returned a complete revision after primary adversarial review. Both CLI init records confirmed read/search tools only (`Read`, `Grep`, `Glob`), plan permission mode, no MCP servers or skills. The delegate did not implement or execute checks.

The primary challenged cleanup that depended on abort-cooperative promises, stale account/attempt UI updates, held in-flight request and late-rejection coverage, permission-timeout classification, and overstated device/timing guarantees. Revision 2 specifies immediate request/timer cleanup, scoped UI-attempt guards, preference-aware retry feedback and deterministic regressions, while preserving server fencing and the three-second sign-out bound. No blocking objection remains. The owner subsequently approved revision 2 and publication of a separate notification PR on 2026-11-12. Root `PLAN.md` now records APPROVED; Opus is implementing the four listed files.

## Implementation and initial verification (2026-11-12 UTC)

Opus implemented exactly the four approved files using only read/search/edit/write tools. CLI init confirmed `claude-opus-5-5`, xhigh launch, `acceptEdits`, no MCP servers or skills. The primary audited every tool/read/edit path and reviewed both runtime files and new test blocks. No blocking defect or scope deviation remained; both pre-existing test blocks were preserved verbatim.

Primary checks ran under Node **22.15.0**, an allowlisted credential-free environment, isolated HOME/config, synthetic test mocks and a disposable copy without `.env*` or owner settings:

| Check | Actual result |
|---|---|
| Unmodified branch baseline | **699 unit/API passed**, 57 suites |
| Updated full unit/API suite | **741 passed**, 57 suites (+42) |
| Focused push client/control suites | **73 passed**, 2 suites, three consecutive runs |
| Related runtime/worker/manifest/config/UserContext/recipient/app-flow regressions | **60 passed**, 7 suites |
| Lint | Passed |
| Production build | Passed without real credentials/client config |
| Scope/SDK/whitespace and existing-test preservation | Passed |

No unhandled-rejection or PromiseRejectionHandledWarning diagnostics appeared. Jest itself also detects unhandled rejections; the additional process listener follows the existing test pattern but is not treated as the sole oracle. All four owner-file hashes and the default-port demo listener/PID records remained unchanged.

The draft notification PR will be stacked on PR #64 so the two PRs do not conflict over their root planning artifacts. The fixes are independent in application behavior; only Git publication is sequenced (#64 first). After adding that reviewed base, the primary will rerun checks on the combined tree and record the actual result.

Not run locally: integration, rules, Playwright E2E, real iPhone token acquisition or push delivery. No production Firebase access, real push send, credentials/configuration change, deployment command or live rollover occurred.
