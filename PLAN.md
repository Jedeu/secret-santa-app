# PLAN.md: Remove the `YEAR_TRANSITIONS_ENABLED` gate

## Status
**Status: APPROVED (revision 2), 2026-11-11. Adversarial review: COMPLETE — no blocking objections.** The owner approved this reviewed plan with “Yes I approve of the plan” and requested the PR before the separate iPhone notifications investigation. Implementation and verification are now authorized for this scope. That approval covers only:
- the 8 repository edits below;
- the primary's isolated local checks;
- the branch, explicit-path commit, push and PR that the owner has asked for.

It does not authorize any deploy, any read or write against real Firebase or hosting, any credential or configuration change, or a live Close/Start.

**Roles (owner override of `AGENTS.md` § Roles):** Claude Opus 5.5 (`claude-opus-5-5`, xhigh) plans. In a separate approved launch, with edit/write tools only, it also implements. The GPT primary does the adversarial review, runs every check and does all Git/GitHub work. **Review type:** adversarial, because this changes when admin routes are available.

## Primary execution evidence (2026-11-11)
- Owner approval recorded above; Opus implemented exactly the eight approved files. CLI init confirmed `claude-opus-5-5`, xhigh launch, `Read/Grep/Glob/Edit/Write`, `acceptEdits`, no MCP servers or skills. Tool audit found no forbidden reads, commands or scope deviations.
- Adversarial code review: no blockers. The admission module is byte-for-byte the baseline minus the retired error and helper; all other function bodies are unchanged. Both routes retain admin verification before input parsing. No notification code or rules changed.
- Supported Node: **22.15.0**. All application checks ran in an allowlisted, credential-free environment and a disposable copy without `.env*` or user settings.
- Baseline `npm test -- --runInBand` on unmodified `origin/main`: **699 passed**, 57 suites.
- `npm run lint`: **passed**.
- Updated `npm test -- --runInBand`: **725 passed**, 57 suites; expected +26 delta confirmed.
- Focused verbose unit/API rerun: **175 passed**, 3 suites, including all **30** production-mode matrix cases.
- `npm run build`: **passed**. Missing production Firebase configuration produced expected initialization-skipped warnings; no credentials or real client configuration were supplied.
- Owned emulator `year-lifecycle` integration file: **48 passed**, including real Close/Start for unset/false/true and denied non-admin/unverified callers with unchanged data. Ports: Firestore 18080, Auth 19099, websocket 19150, hub 14400, logging 14500. Only four disposable files were remapped; repository infrastructure was unchanged. Firestore startup confirmed endpoint `127.0.0.1:18080`.
- Diff/reference/SDK/scope checks passed. All four owner-file hashes and all demo listener/PID records remained identical. Owned verification emulators stopped, remapped ports were free, and the disposable workspace was deleted.
- **Not run locally:** full integration, dedicated rules suites, Playwright E2E, production sign-in, real FCM, production reads/writes, deployments or live rollover. CI remains a separate PR check.

## Goal
Remove the gate completely. Close and Start then depend only on admin authorization, a verified email outside development, the typed-year prompt and the server's transactional lifecycle checks.

## Context
PR #63 (`4b65590`, merged as `687b9b8`) added `assertYearTransitionsEnabled()`. Outside `NODE_ENV=development`, both admin year routes return 409 `TRANSITIONS_DISABLED` unless the flag is exactly `'true'`. This helper is the flag's only runtime consumer (RESEARCH.md; confirmed by search). `closeYear` and `startNewYear` enforce the lifecycle rules on their own. Notifications are out of scope.

## Consequence (approval includes acknowledging this)
- **Lost control.** Today a non-development deployment also needs an operator to set the flag to `'true'`. After this change that deployment-level opt-in no longer exists. On any deployment running this code, a verified admin session can Close or Start, whether the flag is unset, `'false'` or `'true'`.
- **Protections that remain:**
  - the admin token check;
  - a verified email outside development;
  - the typed-year prompt (`src/hooks/useAdminYearActions.js:24` sends no request unless the trimmed input exactly equals the year);
  - the server's checks: Close before Start, year match, roster, empty target year, idempotency and epoch fencing.
- **Irreversible from the app:** Close cannot be reopened and shows that year's pairings to admitted participants. Start removes access for anyone not on the next roster.
- **No kill switch.** There is no configuration switch to turn the routes off. Disabling Close/Start again needs a separately approved code change and deploy.
- A leftover `YEAR_TRANSITIONS_ENABLED` in hosting config is ignored. Removing it is out of scope.
- No deploy, sign-in or page load starts a transition. No replacement gate, no-op helper or other switch is added.

## Scope
**Unchanged:**
- `verifyAdminRequest`, `requiresVerifiedEmail`, `closeYear`, `startNewYear` and every other function body.
- Request schemas, response shapes, other error codes and the 500 mapping.
- Typed-year prompts, `AdminPanel`, `firestore.rules`, Reset 410, message routing, listeners, rosters and all notification code.

**Never touched:** `.claude/settings.local.json`, `public/sw.js`, `public/workbox-f1770938.js`, `public/worker-2a484529a5551160.js`, `.env*`, `firebase.json`, `__tests__/integration/setup.js`, `__tests__/integration/helpers/*`, `src/lib/firebase.js`, `docs/runtime-verification.md`.

## Proposed changes: exactly 8 implementation files (none created or deleted)

**1. `src/lib/participant-admission.js`** (server; Admin SDK via `@/lib/firebase`; imports unchanged)
- Delete the `TRANSITIONS_DISABLED: { status: 409, … }` line from `ERROR_DEFINITIONS`.
- Delete the `/** Default-off production gate for Close and Start. */` comment and the whole `export function assertYearTransitionsEnabled() {…}`. Leave one blank line between `verifyAdminRequest`'s closing `}` and `// --- References ---`.

**2. `src/app/api/admin/year/close/route.js`** (server; imports only `next/server`, `@/lib/participant-admission`, `@/lib/year-paths`)
- The import list becomes `AdmissionError, admissionErrorResponse, closeYear, verifyAdminRequest`.
- Replace ` * Admin only; requires YEAR_TRANSITIONS_ENABLED=true outside development.` with ` * Admin only: a valid ID token for an admin email, verified outside development.`
- Delete `assertYearTransitionsEnabled();`. The order becomes `verifyAdminRequest` → JSON parse (failure → `INVALID_YEAR`) → `isValidYear` → `closeYear({ year })`.
- `export async function POST(request)` and all responses stay unchanged.

**3. `src/app/api/admin/year/start/route.js`**: the same three edits. The import list becomes `AdmissionError, admissionErrorResponse, startNewYear, verifyAdminRequest`.

**4. `__tests__/api/admin_year_api.test.js`** (global `@/lib/firebase` mock; `closeYear`/`startNewYear` stay `jest.fn()`)
- **`ROUTES` rows** gain a fifth element, `okResult`:
  - close: `{ year: 2025, state: 'closed', epoch: 1, closedYears: [2025], changed: true }`
  - start: `{ year: 2026, state: 'active', epoch: 2, closedYears: [2025], changed: true, participants: 7 }`

  The callback becomes `(_name, POST, validBody, lib, okResult)`.
- **New helpers:** `LEGACY_FLAG_VALUES = [['unset', undefined], ['"false"', 'false'], ['"true"', 'true']]`, and `setEnv(name, value)`, which deletes the variable when `value === undefined` and assigns it otherwise.
- **Top-level `beforeEach`:** `jest.clearAllMocks()`; save `NODE_ENV` and the flag; `setEnv('YEAR_TRANSITIONS_ENABLED', undefined)`; `adminAuth.verifyIdToken.mockResolvedValue(ADMIN)`. **`afterEach`:** restore both variables with `setEnv`.
- **Delete** `'409 TRANSITIONS_DISABLED without the flag outside development'`.
- **Keep unchanged:** both 401 tests, both 403 tests, the non-JSON 400, the 500 INTERNAL test, and every validation, mapping and 200 test in `describe('close')` / `describe('start')`.
- **Add**, as the last child of the `describe.each(ROUTES)` callback, `describe.each(LEGACY_FLAG_VALUES)('in production with YEAR_TRANSITIONS_ENABLED %s', …)`. Its `beforeEach` sets `NODE_ENV='production'` and the flag value. It holds five tests:

| Test | Setup | Expect |
|---|---|---|
| verified admin → 200 | `lib().mockResolvedValue(okResult)` | 200; body `toEqual({ success: true, ...okResult })`; `lib()` called once with `validBody` |
| 401 missing token | `token: null` | 401 `UNAUTHENTICATED`; `lib()` not called |
| 403 verified non-admin | `{ uid: 'member-uid', email: 'member@example.test', email_verified: true }` | 403 `ADMIN_REQUIRED`; not called |
| 403 unverified admin | `{ ...ADMIN, email_verified: false }` | 403 `EMAIL_NOT_VERIFIED`; not called |
| 400 bad JSON | `invalidJson: true` | 400 `INVALID_YEAR`; not called |

  Net change: −2 tests, +30 tests (2 routes × 3 values × 5).

**5. `__tests__/lib/participant_admission.test.js`** (local `@/lib/firebase` mock unchanged)
- Remove the `assertYearTransitionsEnabled,` import.
- Remove the `savedFlag` declaration, its save and its restore. `afterEach` keeps only `process.env.NODE_ENV = savedNodeEnv;`.
- Remove the table row `['TRANSITIONS_DISABLED', 409]` and the `TRANSITIONS_DISABLED` message expectation (keep the other two expectations).
- Remove the whole `'assertYearTransitionsEnabled: …'` test.
- Net change: −2 tests.

**6. `__tests__/integration/year-lifecycle.test.js`** (real Admin SDK on the emulator; synthetic rosters; `asCaller` spies on `verifyIdToken`)
- Keep the existing `savedFlag` save/restore. After `MALFORMED`, add the same `LEGACY_FLAG_VALUES` and `setEnv` as in file 4.
- Replace `'transitions gate: in production with the flag unset …'` in the same position with `describe('production admin routes ignore the retired YEAR_TRANSITIONS_ENABLED flag')`. It contains two tests.

  **a. `test.each(LEGACY_FLAG_VALUES)('flag %s: Close then Start succeed through the routes and H is unchanged')`**
  - Setup: `seedHistory()`; record `H = await history()` and `epochBefore`; `asCaller(ADMIN_DECODED)`; set the flag and `NODE_ENV='production'`.
  - Call `closeRoute(request({ year: 2025 }))` and then `startRoute(request({ fromYear: 2025, targetYear: 2026 }))` inside a `try`, restoring `NODE_ENV` in `finally`.
  - Expect:
    - Close 200 with body `toEqual({ success: true, year: 2025, state: 'closed', epoch: epochBefore, closedYears: [2025], changed: true })`.
    - Start 200 with body `toEqual({ success: true, year: 2026, state: 'active', epoch: epochBefore + 1, closedYears: [2025], changed: true, participants: ROSTER_2026.length })`.
    - `lifecycle()` `toMatchObject({ epoch: epochBefore + 1, state: 'active', year: 2026, closedYears: [2025], startedAt: expect.any(String), closedAt: null })`.
    - The sorted emails in `years/2026/users` equal the sorted `ROSTER_2026` emails.
    - `expectIndexResolvesFor(ROSTER_2026, 2026, epochBefore + 1)` passes.
    - `await history()` equals `H`.

  **b. `test('flag "true" grants nothing: a non-admin and an unverified admin get 403 from both routes and nothing is written')`**
  - Setup: `seedHistory()`; snapshot `[...GLOBAL_PATHS, ...H_PATHS, ...YEAR_2026_PATHS]`; flag `'true'`; `NODE_ENV='production'`.
  - Run two callers: `decoded(ALPHA)` expects `ADMIN_REQUIRED`, and `{ ...ADMIN_DECODED, email_verified: false }` expects `EMAIL_NOT_VERIFIED`. For each: `jest.restoreAllMocks()`, `asCaller`, then call both routes. Restore `NODE_ENV` in `finally`.
  - Expect 4 responses, each 403 with its code, and an unchanged snapshot.
- Keep every other test. Net change: −1 test, +4 tests.

**7. `__tests__/unit/useAdminYearActions.test.js`** (Client SDK mocked via `@/lib/firebase-client`)
- In `'a server error shows its message and does not call onComplete'`, keep `status: 409`.
- Change the fixture body to `{ error: 'The exchange year does not match. Check the current state and try again.', code: 'YEAR_MISMATCH' }`.
- Change the toast expectation to `'Failed to close 2025: The exchange year does not match. Check the current state and try again.'`.

**8. `CLAUDE.md`** (Important Notes, "Year lifecycle:" bullet)
- Replace only the final sentence, "Both admin routes require `YEAR_TRANSITIONS_ENABLED=true` outside development.", with:
  > In the app, only `POST /api/admin/year/close` and `POST /api/admin/year/start` call `closeYear` and `startNewYear`; these routes accept only an admin's Bearer ID token (verified email outside development), and no environment variable enables or disables them. The admin panel calls a route only after the admin types the year, and no deploy, sign-in, page load or background task starts a transition.
- The API Routes entries stay unchanged.

## Primary-executed steps
1. **Before implementation:** `git switch -c fix/remove-year-transition-gate origin/main`. HEAD's tree equals `origin/main`, so the owner's uncommitted files carry over untouched; do not stash. Save this plan as `PLAN.md` and keep `RESEARCH.md`.
2. **After implementation:** review the diff, then run the Verification steps.
3. **Only if every executed check passes and the review has no blocker:**
   - Record the approval and the check results in `PLAN.md`.
   - Stage the 10 task paths by explicit path: the 8 files above plus `PLAN.md` and `RESEARCH.md`.
   - `git diff --cached --name-only` must list exactly those 10.
   - Commit with `fix: remove the YEAR_TRANSITIONS_ENABLED gate from admin year routes`.
   - `git push -u origin fix/remove-year-transition-gate`.
   - `gh pr create --base main --head fix/remove-year-transition-gate`. The body gives the summary, the consequence section, the checks that ran with their results, and the checks not run.

   Never push to `main`, force-push or stage the owner's files. Keep secrets and personal data out of the PR. Git and GitHub steps use the primary's normal repository authentication. The checks never use that environment.

## Verification (primary)

**Preconditions**
- Record SHA-256 checksums of the four owner files.
- Record the listeners and PIDs on 8080, 9099, 4000 and 3000, plus any other ports the demo's emulator processes hold. Do not stop or reuse them.

**Repository checks (read-only)**
1. `git diff --check` prints nothing. `git status --porcelain` shows only the 10 task paths and the four owner paths.
2. Run these with the pathspec `-- . ':!PLAN.md' ':!RESEARCH.md'`:
   - `git grep -n -e assertYearTransitionsEnabled -e TRANSITIONS_DISABLED -e 'not enabled on this deployment'` prints nothing.
   - `git grep -n YEAR_TRANSITIONS_ENABLED` matches only `__tests__/api/admin_year_api.test.js` and `__tests__/integration/year-lifecycle.test.js`.
   - If either finds a match in a tracked hidden file, stop.
3. `git diff origin/main -- src` adds no import lines. The only removed import lines are the two `assertYearTransitionsEnabled,` entries.

**Isolated runner (used for checks 4–8)**
- **Disposable copy.** Create a root `$V` outside the repository. Copy the working tree to `$V/app`, excluding `.git`, `.env*`, `.claude/`, `.next/`, `public/sw.js`, `public/workbox-*.js` and `public/worker-*.js`. Copy `node_modules`; do not symlink it.
  - Confirm `$V/app` has no `.env*` files (next/jest loads them).
  - Confirm the 8 manifest files are byte-identical to the repository's.
- **Allowlisted environment.** Run every command under `env -i` with only:
  - `PATH` (Node 22.15.0's bin first, then system directories, plus Java if the emulator needs it);
  - `HOME=$V/home`, `XDG_CONFIG_HOME=$V/home/.config`, `XDG_CACHE_HOME=$V/home/.cache`, `TMPDIR=$V/tmp`;
  - `LANG`;
  - `NEXT_TELEMETRY_DISABLED=1`, `METADATA_SERVER_DETECTION=none`, `PUSH_DISPATCH_ENABLED=false`.
- **Nothing else is inherited.** In particular: no `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_*`, `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_TOKEN`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `NODE_ENV`, emulator hosts or the retired flag. The isolated HOME has no Firebase CLI login, no gcloud ADC and no npmrc.
- `node --version` inside this environment prints `v22.15.0`.
- If firebase-tools needs cached emulator binaries, copy only that binary cache into `$V/home`, after confirming its location from the CLI. Never copy configstore, gcloud or credential files.

**Checks**
4. `npm run lint` exits 0.
5. `npm test` exits 0 with zero failures.
   - Measure the baseline the same way on unmodified `origin/main`. The expected delta is +26 (API +28, lib −2, hook 0). If the baseline is still 699, expect 725.
   - `npx jest --verbose` on the three unit/API files shows passing results for: all 30 production-matrix cases; the retained 401, 403, 400, 500, mapping and 200 cases; and the `YEAR_MISMATCH` toast test.
6. `npm run build` exits 0, inside `$V/app` only. If it fails solely because client config is absent, report that. Never supply real values.
7. **Copy-only emulator remap.** Repository test infrastructure is never edited. Remap four files, because the development code overwrites the emulator hosts (recorded in RESEARCH.md):
   - `firebase.json`: Firestore and Auth to free loopback ports (e.g. 18080/19099), UI disabled, and every other port firebase-tools would open moved off the demo's ports. The exact key names are a tooling detail the primary confirms.
   - `__tests__/integration/setup.js`: both hosts.
   - `src/lib/firebase.js`: lines 8–9.
   - `__tests__/integration/helpers/emulator-admin.js`: the line 30 fallback host.

   Guards:
   - `grep -nE "(127\.0\.0\.1|localhost):(8080|9099)|\"port\": *(8080|9099|4000)"` over those four files prints nothing.
   - `diff -r` of the copy against the repository (excluding the copy exclusions, `node_modules` and build output) shows only these remaps.

   If any guard fails, stop.
8. In `$V/app`, run `npx firebase emulators:exec --only=firestore,auth --project=xmasteak-app "npx jest --config jest.integration.config.js --runInBand __tests__/integration/year-lifecycle.test.js"`.
   - The startup output must show only remapped loopback ports.
   - The whole file passes (+3 tests net), including the three flag cases, the "grants nothing" case and every retained lifecycle, race, Reset-410 and second-rollover test.
   - If the CLI refuses to run alongside the demo, stop and ask. Never stop the demo.

**Afterwards**
- Stop only the processes the primary started.
- The demo's listeners and PIDs are unchanged, and the remapped ports are free.
- The owner-file checksums are identical.
- Delete `$V`.

**Not run (report as not run):** the full integration suite, the `firestore-rules-*` suites and Playwright E2E. CI runs these on the PR. Production sign-in, deploys and a live Close/Start are not run either.

## Production notes (informational; each step needs separate, explicit owner authorization; none is authorized here)

**Prerequisites before any live Close:**
- Inventory every deployment and credential holder that can run server code with the production Admin credentials. Each will serve working Close/Start to a verified admin.
- Read-only check that the lifecycle is missing or a valid active 2025 document, and that no `years` data exists. An export or point-in-time recovery is recommended.
- The archive `firestore.rules` is deployed before or together with the app, and `/api/admin/reset` returns 410.
- Every pre-archive writer is retired and confirmed unable to write, after waiting out the maximum request duration.
- The only thing enforcing this order now is the owner not pressing Close before it is done.

**Rollback**
- There is no configuration kill switch.
- A rollback is allowed only while a fresh read-only check confirms that no Close or Start has ever run:
  - the lifecycle is missing, or is `state: 'active'` for 2025 with `closedYears` absent or empty;
  - no `years/*` data exists.
- Even then, roll back only to a build that keeps the archive protections (`687b9b8` or later), with the archive rules still deployed.
- Never restore a pre-archive app or pre-archive rules. That would bring back pre-archive destructive or unfenced writers, such as the old Reset.
- Once any year has been closed or started, or if the state cannot be verified: roll forward, or use a separately approved recovery.

## Risk areas (`CLAUDE.md`)
- **Security / admin-route availability:** changed, as described above. `firestore.rules` is unchanged and never read the flag.
- **Anonymity:** the code is unchanged, but fewer controls now stand before a Close that reveals pairings.
- **SDK separation:** unchanged; no imports are added.
- **Message routing and listener reads:** untouched.

## Deferred cleanup
- The `ADMIN_EMAILS` comment in `src/lib/config.js` still lists retired abilities.
- Emulator ports are hardcoded in `src/lib/firebase.js`, the integration setup and helpers, and `firebase.json`.

## Not verified (left to the primary)
- Whether any tracked hidden file contains the flag (the planner reads no `.env*`).
- Deployment state, hosting config, previews, credentials and production data. None were inspected, and none may be under this plan.
- Tooling: the firebase-tools 14.x keys for any other emulator ports, the emulator binary cache location under the isolated HOME, and whether `emulators:exec` runs alongside the demo and starts without a login.
- Baseline test counts, and whether `npm run build` succeeds without client config.
- Jest behaviour of nested `describe.each`, and setting `NODE_ENV` while a test runs (existing tests already rely on the latter).

## Open decisions
None. The recommended branch is `fix/remove-year-transition-gate`. Approving the plan includes acknowledging the Consequence section.

## Review resolutions
1. **File count.** Fixed: the plan now says 8 implementation files everywhere and includes `CLAUDE.md` (§8). With `PLAN.md` and `RESEARCH.md` that makes 10 task paths, used consistently in staging and status checks. The primary commits, pushes and opens the PR by explicit path after the checks, on `fix/remove-year-transition-gate`. Never `main`; owner files are excluded.
2. **Environment isolation.** Checks now run under an `env -i` allowlist with an isolated HOME and XDG directories. No credentials or `.env*` are inherited. `PUSH_DISPATCH_ENABLED=false` and `METADATA_SERVER_DETECTION=none` are set. The plan keeps Node 22.15.0, the disposable copy and build, and the four-file copy-only remap. The integration run uses `emulators:exec --only=firestore,auth`. Extra port keys are left as a primary tooling confirmation, and the demo is preserved.
3. **Mistyped confirmation.** The claim is removed. The prompt sends no request unless the input exactly matches the year (`useAdminYearActions.js:24`). The lost opt-in is explained once, plainly.
4. **Rollback.** The advice to redeploy older builds and the phase-number rollback rule are removed. Rollback now depends on a verified state with no Close or Start, and only to builds that keep the archive protections. After any transition, roll forward or use a separately approved recovery. This task is code-only; no production rollout is authorized.
5. **`CLAUDE.md` wording.** The new text says the app calls the library functions only from the two HTTP routes; it does not say the functions require HTTP. It keeps the verified-email rule outside development, states there is no environment opt-in, and says nothing starts a transition automatically.
6. **Retained coverage.** The plan keeps:
   - the full unset/`'false'`/`'true'` production matrix on both routes (200, 401, 403 ×2, 400);
   - the existing response and error tests;
   - removal of the obsolete helper and error tests;
   - the `YEAR_MISMATCH` fixture;
   - the emulator test of real Close/Start with archive invariants, and the denied-callers test;
   - all untouched protections and the 8-file manifest.

   No notification edits.
