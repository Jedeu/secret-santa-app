# Research: remove the year-transition environment gate

## Request and authorization

The owner requests removing the `YEAR_TRANSITIONS_ENABLED` switch because it is unnecessary for their desired admin workflow. This is a follow-up to merged PR #63 (`687b9b8`, feature commit `4b65590`). The request is for a code change, not permission to deploy, access production Firebase, change credentials, or execute Close/Start. Implementation still requires approval of this change's reviewed `PLAN.md` under `AGENTS.md`.

The owner subsequently specified that, for bug fixes and small changes, Opus should own both planning and implementation, with the primary doing adversarial review. Fable is not used for this follow-up. The existing plan-approval requirement remains in place.

The owner also requested opening a PR when the change is complete. This authorizes a follow-up branch, explicit-path commits/push, and PR creation after implementation/review/checks; it does not authorize direct pushes to `main` or production operations.

The notification report is a separate, unresolved investigation and is outside this change.

## Baseline and owner files

- Current branch: `feat/annual-exchange-archives`. After fetching `origin/main`, its tracked HEAD tree is identical to merged `origin/main` at `687b9b8`.
- Pre-existing modified `.claude/settings.local.json` and untracked `public/sw.js`, `public/workbox-f1770938.js`, `public/worker-2a484529a5551160.js` belong to the owner. Do not edit, stage, overwrite, or remove them.
- Use a new follow-up branch based on `origin/main`; do not push directly to `main`.
- The prior archive feature's full research and approved plan remain available in Git at `4b65590:RESEARCH.md` and `4b65590:PLAN.md`. Their reported checks are historical, not verification of this follow-up.

## Code ground truth

### Runtime gate

`src/lib/participant-admission.js` uses the Admin SDK via `@/lib/firebase` and contains:

- `ERROR_DEFINITIONS.TRANSITIONS_DISABLED`: HTTP 409, `Year transitions are not enabled on this deployment.`
- Exported synchronous `assertYearTransitionsEnabled()`: allows the operation only when the flag equals the string `'true'` or `NODE_ENV === 'development'`.
- The independent `verifyAdminRequest(request)` guard verifies the bearer ID token, enforces verified email outside development, then checks the configured admin list. It does not depend on the transition flag.

The only runtime callers of the flag guard are:

- `src/app/api/admin/year/close/route.js`: `verifyAdminRequest` -> flag guard -> parse and validate `{ year }` -> `closeYear({ year })`.
- `src/app/api/admin/year/start/route.js`: `verifyAdminRequest` -> flag guard -> parse and validate `{ fromYear, targetYear }` -> `startNewYear({ fromYear, targetYear })`.

Both routes import server-side admission functions, not the Client SDK. Both include a comment claiming the flag is required outside development. No other application code consumes the flag or disabled error.

### Safeguards that must remain

Remove only the environment opt-in; do not replace it with another configuration gate or a no-op helper. Keep the existing authentication, verified-email check, admin authorization, request schemas, response shapes, error mapping for other errors, and typed-year UI confirmations.

`closeYear({ year })` and `startNewYear({ fromYear, targetYear })` already implement lifecycle validation and transactions independently of the gate. Their bodies must remain unchanged. These preserve idempotency, Close-before-Start, roster validation, target-year emptiness, fresh annual UUIDs, epoch fencing, year-scoped storage and archive preservation. Retired Reset remains HTTP 410. No automatic transition occurs on deployment, login, page load or any background task.

### Test references

- `__tests__/api/admin_year_api.test.js`: saves/sets/restores the flag around every case and expects each route to return `TRANSITIONS_DISABLED` when unset. It already covers missing/invalid tokens, non-admin, unverified admin, malformed input, mapped lifecycle errors and successful response shapes. Replace the gate failure cases with explicit production-mode successes for unset, `'false'` and `'true'`; retain all negative authorization/input cases and restore any environment changes reliably.
- `__tests__/lib/participant_admission.test.js`: imports the helper; saves/restores the flag; tests the gate; asserts the disabled error's status and message. Delete these now-obsolete references, retaining `NODE_ENV` restoration and all admission/transaction/authorization tests.
- `__tests__/integration/year-lifecycle.test.js`: saves/restores the flag; its production gate test expects both routes to reject without writes. Replace that obsolete case with real emulator-backed production-route coverage with the flag unset and explicitly `'false'`/`'true'`. Use existing synthetic fixtures and mocked token verification; prove Close/Start succeed, lifecycle and epoch advance correctly, new roster profiles are created, and the full root-history snapshot remains unchanged. Retain flag cleanup for these legacy-value regression cases. Existing lifecycle/race/retired-reset tests must remain.
- `__tests__/unit/useAdminYearActions.test.js`: the generic server-error toast test uses the retired disabled error fixture. Replace it with an existing error such as `YEAR_MISMATCH`, preserving that test's behavior and exact production error text.

## Documentation and references

`CLAUDE.md` Important Notes says both routes require the flag outside development. Update that sentence to describe admin-only explicit actions without the environment opt-in. Keep the remaining lifecycle/no-deletion guarantees.

The old `PLAN.md` and `RESEARCH.md` described the original default-off rollout. They are being replaced with the focused follow-up artifacts; do not leave their old flag requirement as current instructions. The new plan must state the changed deployment consequence and retain the production prerequisites below without prescribing enabling the removed flag.

## Deployment consequence and retained rollout risk

Once this code is deployed, an authenticated, verified admin can explicitly Close/Start without an environment variable, including deployments where the legacy variable is unset, `'false'`, or `'true'`. Deployment itself still performs no rollover.

Removing the gate does not fix old deployments or deploy Firestore security rules. Before any live Close/Start, updated rules and retirement of old privileged writers remain necessary to protect archives. Production data/topology have not been inspected or verified. The original managed export/PITR recommendation and owner-controlled irreversible actions still apply. Do not broaden this code task into a production rollout, credentials change, rules deployment, or data operation.

Risk flags: this changes admin-route availability/security configuration, so the plan needs adversarial review. No change to message routing, Firebase SDK boundaries, listener counts, rules contents, roster membership or the anonymity model is needed.

## Verification tooling and limits

- `package.json` and `CLAUDE.md` require Node >=22.13.0 <23; `.nvmrc` is 22.15.0. Default shell Node was previously unsupported. Use the supported version and verify it before checks.
- CI checks lint, unit, full integration and E2E. Primary runs all executed checks, not delegates. A proportionate follow-up gate is diff/reference checks, lint, the full unit/API suite, the complete `year-lifecycle` emulator integration file and a production build; list any broader suites not run honestly.
- Integration setup hardcodes local ports 8080/9099, and tests clear the whole emulator database. Opus additionally found, and the primary confirmed, that `src/lib/firebase.js` unconditionally overwrites both emulator-host variables in development; `__tests__/integration/helpers/emulator-admin.js` also has an 8080 fallback. Any disposable verification remap must account for all four files (Firebase config, test setup, server initialization and helper fallback), not just environment variables. The screenshot demo was intentionally left running on owned default ports; do not wipe or stop it for this follow-up. Check listeners on 8080, 9099, 4000 and 3000 before any emulator work. If occupied, use disposable verification files with remapped ports outside the repository, or stop and ask; do not modify repository test infrastructure for this task.
- Isolate credentials/config and explicitly target owned loopback emulators. No `.env*` or user-owned settings should be copied into verification environments. Use `METADATA_SERVER_DETECTION=none` only in the isolated verification runner if needed, as in the prior task; it is not an app fix.
- Build in a disposable workspace to avoid touching the owner's generated service workers.
- The primary confirmed Node 22.15.0 is available and inventoried the default-port listeners read-only: Auth PID 67225 (9099), Firestore PID 67279 (8080), Next PID 67324 (3000); no listener on 4000. No application checks for this follow-up have run yet; no production access has occurred.

## Planning handoff and adversarial review

Opus (`claude-opus-5-5`, xhigh) returned an initial plan and a complete revision addressing the primary's review. Both CLI init records confirmed only `Read`, `Grep` and `Glob`, plan permission mode, and no MCP servers or skills. The primary audited tool calls: no shell, edits, writes, excluded/sensitive reads or reads outside the repository.

The reviewed revision names exactly eight implementation paths, plus primary-owned `PLAN.md` and `RESEARCH.md`. Review corrections resolved the initial file-count error, explicitly isolated inherited credentials, accounted for server emulator-host overwrites, removed inaccurate confirmation/rollback claims, corrected HTTP-route documentation, and included the owner's PR request. No blocking objection remained. The owner then approved revision 2 on 2026-11-11 with “Yes I approve of the plan” and reiterated that the iPhone notification stall should be addressed after this PR.

## Implementation and verification (2026-11-11)

Opus implemented exactly the eight approved files with read/search/edit/write tools only. The CLI confirmed `claude-opus-5-5`, xhigh launch, `acceptEdits`, no MCP servers or skills. Primary audited the tool calls and reviewed the diff: no forbidden tools/reads or scope deviation; no blockers. The admission module exactly matches the baseline with only the retired error and gate helper removed; authorization, lifecycle transactions and notification code are unchanged.

Primary verification used Node **22.15.0**, an allowlisted environment (no inherited credentials/config), disposable copies, and owned loopback emulators. Actual results:

| Check | Result |
|---|---|
| Unmodified `origin/main` full unit/API baseline | **699 passed**, 57 suites |
| Lint | Passed |
| Updated full unit/API suite | **725 passed**, 57 suites; expected +26 |
| Focused verbose unit/API rerun | **175 passed**, 3 suites; all 30 production matrix cases |
| Production build | Passed without production credentials/client config; expected Firebase initialization-skipped warnings |
| Complete year-lifecycle emulator integration file | **48 passed** |
| Scope, references, SDK boundary and whitespace | Passed |

The integration run changed ports only in four disposable files. Firestore/Auth/websocket/hub/logging used **18080/19099/19150/14400/14500**; the emulator confirmed Firestore endpoint `127.0.0.1:18080`. The running screenshot demo's listeners and PIDs remained exactly unchanged. All four owner-file hashes remained identical. Owned verification emulators shut down, their ports were free, and the disposable workspace was deleted. Redacted logs and delegate reports remain under `/tmp/secret-santa-remove-year-gate.H2rG4S`.

Not run locally: the full integration suite, dedicated rules suites, Playwright E2E, production sign-in or real FCM. No production Firebase access, configuration/credential changes, deploy command or live Close/Start occurred. GitHub CI will run separately on the requested PR.
