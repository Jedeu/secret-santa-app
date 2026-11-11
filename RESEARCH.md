# Research and verification: annual exchange archives

## Approved request

The owner approved reviewed `PLAN.md` revision 4 on 2026-11-10. On 2026-11-11 the owner separately requested a draft pull request.

- Existing conversations and pairings are **2025**; the next exchange is **2026**.
- Two separate admin actions: **Close year** makes the exchange read-only; **Start new year** opens a clean exchange later.
- Currently admitted participants may browse every archived conversation, including before choosing their current recipient.
- Reveal historical pairings at Close; do not change current-year anonymity.
- Keep Google sign-in and the participant registry. Preserve historical profiles, names, pairings, messages and reactions.
- Exclude **Jana** from the 2026 roster and app access once 2026 starts. Preserve her 2025 history for admitted participants. No archive-only access role.
- Automatic recipient assignment on sign-in is explicitly deferred; current manual selection remains.

Implementation approval did not authorize production reads/writes, deployments, credential operations or live Close/Start actions. The later draft-PR request authorizes Git/GitHub publication, not those production operations.

## Ground truth and architecture

### Legacy storage and reset

Before this change, all year data lived in root `users`, `messages`, `reactions`, `lastRead` and `typing` collections. There was no year field or archive model. The old admin Reset deleted app data, including history, and reseeded participants. It could not safely perform this rollover.

Chosen design: **archive in place**, not copy/verify/delete.

- Root collections remain the 2025 archive; later years use `years/{year}/…` with the same five collection names and document shapes.
- Close is one transaction on `system/lifecycle` that freezes year-specific writes and publishes the year in `closedYears`.
- Start requires the current year closed, a configured roster, and all five target collections empty. It creates fresh UUID profiles, updates participant indexes and advances the lifecycle/epoch in one transaction.
- No bulk production reset/deletion remains in the new app. Ordinary active-year typing/reaction deletions and pairing updates remain allowed.
- The old Reset endpoint returns 410, and the unsafe standalone production-capable seed script is removed.
- Missing lifecycle/year metadata identifies legacy 2025, never 2026. An invalid existing lifecycle is not overwritten by server operations.

Keeping history in place eliminates bulk copy/delete jobs, partial migration publication and source-deletion recovery states. The necessary cost is consistent year-aware references across server operations, client writers, subscriptions and security rules.

### Admission, rosters and stale clients

`src/lib/participant-admission.js` remains the server-side identity/profile owner. Admission uses the current year's roster, verified email outside development, UUID profiles and epoch-scoped server-written identity/index records.

`PARTICIPANTS` remains the known-person registry; `YEAR_ROSTERS` defines eligibility. Future years require a reviewed roster configuration change and deployment; unconfigured years cannot start.

The epoch advances only on Start. Fresh annual UUIDs prevent old outbox payloads from becoming valid new-year messages, including when the same people pair again. Stale identities lose year-data access until readmitted; the excluded participant cannot be readmitted to 2026.

Old installed clients may read closed 2025 data but cannot write it. After Start they must reload: bootstrap without the year-aware client header returns `CLIENT_UPDATE_REQUIRED`, preventing the old root-profile subscription/rebootstrap loop.

### Archive fidelity and routing

The archive uses the archived year's profiles and assignments, never the new year's profiles. It preserves directional conversations and mutual pairs, retains unroutable messages, separates ambiguous legacy rows without inventing a definite Santa, and lists pairings with no messages.

The live routing module is unchanged. Its grouping/routing regression tests remain in the gate.

Archive rendering is passive: no composer, lastRead markers, typing, reaction toggles or outbox activity. Old reactions render as static chips. Data is fetched on demand with three server reads, not permanent historical listeners. Only complete snapshots without pending writes are cached, keyed by auth identity/year; auth changes invalidate pending loads and cache entries. Offline first-load behaviour is an honest error with manual retry, not a partial archive silently memoized forever.

### Client lifecycle and scope races

The reviewed plan explicitly addresses:

- Publishing writable scope synchronously, outside replayable React state-updater functions.
- Capturing scope/reference identity for read markers, typing timers and reaction toggles so delayed work cannot resolve a different year later.
- Ignoring invalidated read-marker resolutions, rejections and confirmation reads.
- Keeping a metadata listener for the signed-in session, acting only on server-confirmed snapshots.
- Fencing bootstrap responses against the confirmed lifecycle; persistent disagreement produces a bounded retryable error rather than stale writable UI or an unbounded loop.
- Bounded lifecycle-listener reattachment for either ordering of first-admission success and permission denial.
- Tagging and cancelling user-list fetches so old-year/account results cannot overwrite new recipient options, even for one render.
- Keeping archives reachable from the unassigned-participant Welcome screen, with a return action to current-year selection.

### Rules and anonymity

Rules allow year data to be read only for the current year or an explicitly closed earlier year, never a future or unlisted year. Writes are limited to the current open year. Server writers independently fence lifecycle/membership because Admin SDK operations bypass client rules.

Rules validate lifecycle scalar fields, list type and current-year/state consistency. List-element typing/order, duplicates and other canonical-list checks are server-only; this documented residual does not permit future-year reads or non-current-year writes. Only the server writes lifecycle metadata, and rollout stops on invalid existing metadata.

Current-year anonymity remains the existing UI/social trust convention, not a hard raw-data secrecy guarantee. Closed-year pairings are deliberately revealed to admitted participants.

## Planning and implementation evidence

Fable (`claude-fable-5-2`, xhigh) drafted and revised the plan using read/search tools only. Primary adversarial review resolved lifecycle validation, target-namespace cleanliness, cache fidelity, scope/callback races, old-client fences, rollout ordering and exact test/file contracts before requesting approval.

After owner approval, Opus (`claude-opus-5-5`, xhigh) implemented **20 creates and 64 modifications** using only read/search/edit/write tools. Primary completed the **4 approved deletions**, reviewed the implementation and executed all checks. No delegate ran a command, test, build, browser, database or Git operation.

Scope audits confirmed:

- Every implementer edit was in the approved manifest; no forbidden file read or unexpected tool was found.
- The rules match the approved full replacement.
- No removed-export reference or SDK-boundary issue remains in the checked source/test/script paths.
- Original owner settings and pre-existing generated service-worker assets remain byte-identical and are excluded from publication.
- No dependency manifest/lockfile changes were made. Installed direct dependency versions match the lockfile.
- Verified application source hashes remain unchanged after all checks.
- Diff and new-file whitespace checks pass.

## Primary-executed local checks (2026-11-11)

Checks ran from a disposable copy with **Node 22.15.0**, isolated home/config/credentials, explicit loopback emulator hosts and push dispatch disabled. No `.env*` or user-owned settings were copied. The emulator stacks were started by the primary after checking ports 8080, 9099, 4000 and 3000.

| Check | Actual result |
|---|---|
| `npm run lint` | Passed, no lint output beyond the command banner |
| `npm test -- --runInBand` | **699 passed**, 57 suites |
| Emulator rules compile/integration gate | **56 passed**, 5 suites; subset of the full integration suite |
| Focused participant-admission integration rerun | **5 passed** |
| Full `npm run test:integration`, two consecutive clean reruns | **127 passed**, 10 suites, each run |
| `npm run build` | Passed |
| Emulator-backed `npm run test:e2e` | **48 Chromium tests passed**, no failed/retried result |
| Supplemental three-session browser probe | Passed the checks below |
| Scope, reference, SDK, rules-equality and whitespace checks | Passed |

Emulator commands used `npx firebase emulators:exec --project=xmasteak-app --only=firestore,auth "<npm script>"`. The project name is not a `demo-` ID, but all app/test data access was explicitly directed to owned local emulators with production credentials unavailable.

The installed Java 16 runtime worked; CI specifies Java 17. Firebase CLI warned that a future major release requires Java 21. This was not silently presented as a Java-17 local run.

### Initial integration failure, retained honestly

The first full integration run had **126 passes and one failure**. Concurrent seeding/admission returned `3 INVALID_ARGUMENT: Transaction is invalid or closed` at the transaction's user query. Credential metadata discovery also emitted VM/dynamic-import warnings.

Primary disabled credential metadata discovery **only in the isolated verification environment** using `METADATA_SERVER_DETECTION=none`, supported by the installed metadata package. The focused admission suite and two complete integration reruns then passed. No application source was changed to mask the failure. The initial run remains a failed attempt, not a claimed application fix or a proven root-cause diagnosis.

### Supplemental browser evidence

The final probe used three isolated browser contexts on a fresh owned emulator stack and verified:

1. A 2025 message receives a real server acknowledgement and a reaction is created through normal UI clicks.
2. All three already-open sessions become read-only without reload; archived message content and the static reaction remain visible.
3. Start creates a fresh UUID without reload; the excluded already-open session becomes Access Denied.
4. Archives are available before recipient selection, and Back returns to Welcome.
5. A 2026 message is acknowledged, exists only in the new namespace, reaches the recipient's Santa tab, and supports a new-year UI reaction.
6. Root users/messages/reactions remain deeply equal before and after Close/Start/new-year activity; retired Reset returns 410.

There were **zero attempted external browser requests, zero uncaught page errors and zero unexpected console errors**. Three expected first-admission listener warnings and one expected admission-denial response were recorded. All owned processes shut down; the four checked ports were clear afterwards.

### Earlier supplemental attempts and remaining caveats

Two earlier supplemental attempts failed and are not counted as passes:

- A normal click hit a first-row reaction-picker/header overlap in unchanged Chat/ReactionPicker components.
- Initial navigation through the unchanged dev-login helper timed out.

The final probe used lower synthetic fixture rows plus pre-created owned emulator accounts and a server-admission setup check, then normal physical UI clicks. No force-click or unlisted application fix was used. These unrelated/setup quirks remain outside this feature's scope.

E2E logs also retain the unchanged single-tab IndexedDB persistence fallback when multiple tabs open. The historical `docs/runtime-verification.md` contains obsolete Reset/seed-script guidance and a delegate-read note inconsistent with `AGENTS.md`; it was inspected only by the primary and left outside this change's manifest. Do not follow its retired Reset instructions.

Production Google popup sign-in, actual FCM push, production data shape and deployment topology were **not verified**.

## Publication and production boundary

The owner requested a draft PR for review. Publish only this task's explicit manifest and planning/research artifacts, not user-owned settings or generated files. No production Firebase read/write, credential change, deployment or live Close/Start has been performed.

Production transitions default off behind `YEAR_TRANSITIONS_ENABLED`. Before enabling them, the owner must separately authorize and verify rollout, including retirement of older deployments/credential holders that could still run the destructive old Reset or other unfenced writers. Existing data is not copied, deleted or automatically rolled over on deployment or page load.

## External documentation checked by primary

- Server-only archive reads: https://firebase.google.com/docs/reference/js/firestore#getdocsfromserver
- Independent cache/pending-write metadata: https://firebase.google.com/docs/reference/js/firestore.snapshotmetadata

Documentation inspection supported planning; real offline runtime behaviour was not independently browser-tested.
