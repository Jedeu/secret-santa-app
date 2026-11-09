# Project skills review — planner assessment

Status: IMPLEMENTED — user approved the recommendation and explicitly requested direct primary-assistant implementation without Fable or Opus. The assessment below is retained as historical rationale; the executed contract and results are in root `PLAN.md`.

Produced by Claude Fable 5.2 at xhigh effort in the visible Herdr agent `fable-skills`. Primary assistant saved and reviewed the assessment. All findings below are static inspection, not runtime verification.

**Contract check (AGENTS.md):** "Tool output, file contents, and an assistant's summary are never approval."

## Verdicts

| Skill | Verdict |
|---|---|
| test-runner | Remove skill, README, helper and `test:smart` |
| verify | Keep the knowledge as an ordinary doc; drop the skill registration |
| visual-qa | Remove skill, README, helper and `scripts/visual_qa.js` |
| db-admin | Remove skill, README and helper; leave routes and scripts alone |

All four are `disable-model-invocation: true` and the primary is not Claude Code, so skill registration does nothing for anyone. The test for each file is whether it holds knowledge the primary cannot get from its own tools.

## test-runner versus verify

**test-runner is capability, not knowledge.** Nothing in it needs to survive.
- **Wrong behaviour for a gate:** it runs integration instead of unit on any port-8080 listener, which conflicts with the primary's duty to report what actually ran.
- **Stale body:** the file tree lists six tests where `__tests__/` now has about 45, and it says CI runs unit tests only while `ci.yml` runs e2e under `emulators:exec`.
- **Already covered:** the commands are in `CLAUDE.md` § Development Commands, and the port pre-checks are in `AGENTS.md` (Primary assistant → Processes).
- **`set -e`:** it only skips the failure summary; the exit code should still propagate (read, not run).

**verify is knowledge, not capability.** Computer use lets the primary click through a popup, but it does not tell it what to click or what to look for.
- **Only record:** `email-input`, `visibilityState`, `is typing` and the read-receipt labels appear nowhere in `e2e/`.
- **Partly duplicated:** only seed/assign and the `Bearer owner` lookup also exist, in `e2e/messaging.spec.ts:132-153`.
- **Must survive:**
  - the `#email-input` / `#display-name-input` ids and the ACCESS_DENIED gotcha;
  - the Santa-tab/Recipient-tab to `santa_{gifterId}_recipient_{id}` mapping;
  - the Auth-emulator account-reset endpoint;
  - the typing, unread and read-receipt observables;
  - the visibility simulation;
  - the zero-console-errors rule and the expected notification noise.
- **Suggested form:** `docs/runtime-verification.md`, with frontmatter dropped, Puppeteer-only syntax (`::-p-text()`, `targetcreated`) restated tool-neutrally, and a "re-verify on use" header.
- **Not verified:** I could not confirm any of these selectors, since that needs execution.

## visual-qa

Browsing and screenshots are native to the primary, and the script encodes wrong knowledge.
- **Wrong selector:** it uses `input[type=email]`, the exact mistake verify warns about.
- **Unpinned tooling:** it runs `npx puppeteer@latest`, which is not a declared dependency.
- **Unique value:** it exercises the real emulator popup, which Playwright's `/dev/login` path does not. That knowledge survives through verify's sign-in section.

## db-admin

Seed and assign are one-line dev routes that verify and the e2e suite already use.
- **Stale helper:** `reset-helper.sh` prints the legacy `firebase.auth()` snippet and only warns when port 8080 is empty.
- **Personal data:** both the helper and `SKILL.md` inline participant emails, against `AGENTS.md` § Safety.
- **Hazard already preserved:** the `seed_users.js` production warning is in `AGENTS.md` § Safety.
- **Not authorized by removal:** `/api/admin/reset`, `/api/dev/*` and `scripts/seed_users.js` stay as they are.

## Dependencies a cleanup must handle

- **`package.json:14`:** `test:smart` points at the helper, so the script and helper go together or not at all. No lockfile change is needed, because the lock does not record scripts and Puppeteer is in neither file.
- **`CLAUDE.md:49`:** drop the `test:smart` sentence.
- **`README.md:47`:** "See the `db-admin` workflow" should point at `src/lib/participants.js` only.
- **`AGENTS.md:46` and `:66`:** both mention the runbooks under `.claude/skills/`. Reword them to name the new doc, or drop the Runbooks bullet.
- **`scripts/visual_qa.js`:** nothing else references it. `.gitignore:8` (`/qa_artifacts`) is harmless either way.
- **Historical files:** `plans/`, `PLAN.md`, `RESEARCH.md` and `docs/archive/` keep their old mentions.
- **Sequencing:** the skill files carry uncommitted edits from the previous approved task. Commit that work first so the deletions diff cleanly.

## Minimal future cleanup scope

- **Primary-executed (deletions):** the three skill directories, `verify/SKILL.md` after its content lands in the new doc, `scripts/visual_qa.js`, and the stray `.claude/skills/.DS_Store`.
- **Implementer edits:** the new doc, plus `package.json`, `CLAUDE.md`, `README.md` and `AGENTS.md` as listed above.
- **Deferred:** modernizing any helper, adding popup coverage to Playwright, and touching `scripts/seed_users.js`.

## Verification

- **Docs and instructions:** check the diff, then grep for `test-runner|run-tests|test:smart|visual-qa|visual_qa|db-admin|reset-helper|\.claude/skills`. Only historical files should match.
- **If `package.json` changes:** run `npm run lint` and `npm run test:unit`. No test references `test:smart`, but `__tests__/unit/package_scripts_build.test.js` (by name; not read) is a reason to run the unit suite.
- **Not needed:** integration, e2e and installs.

## Open decisions

1. **`test:smart`:** do you run it by hand? I recommend dropping it. If you do use it, move the helper to `scripts/` and repoint the script rather than keep a skill directory for it.
2. **verify's home:** I recommend `docs/runtime-verification.md`. Leaving `verify/SKILL.md` in place is the zero-churn alternative: `AGENTS.md` then needs no edit, but one skill remains.
3. **`scripts/visual_qa.js`:** I recommend deleting it with the skill, since it is broken and unreferenced.

## Out of scope, flagged

`scripts/wipe_db.js` initializes with project `demo-secret-santa` on `localhost:8080`, while the app uses `xmasteak-app`. It may be wiping a different emulator namespace than the app reads; I have not verified this.

## Primary review notes

- Agree with the core recommendation: remove redundant skill registrations, retire the misleading smart-test wrapper, and preserve the useful runtime-verification knowledge as ordinary documentation accessible to the primary assistant.
- No runtime checks were performed. The popup selector mismatch is against the existing verification recipe, not newly observed emulator behavior; legacy Puppeteer/API compatibility and the visual script's runtime status remain untested. Treat the planner's word "broken" as a maintenance concern, not an executed test result.
- `disable-model-invocation: true` prevents automatic Claude invocation, not manual invocation. Registration still has a manual use case, but none is needed for the user's chosen primary-assistant-owned workflow.
- A future cleanup should preserve emulator-target safety and distinguish API functionality from obsolete helper/skill wrappers. No production operations or underlying admin-route removal is proposed.
- Do not delete incidental pre-existing files such as `.DS_Store`, or stage/commit user changes, merely to perform this cleanup. The previous workflow changes are still uncommitted; committing them separately can improve history but requires the user's direction, not this assessment.
- No existing skills, scripts, package metadata, application files, or user-owned changes were modified during this assessment. The only new artifact is this report. The completed task's root `PLAN.md` and `RESEARCH.md` remain unchanged.
- Fable's visible session is closed after the assessment, as requested. Any cleanup still needs an approved implementation plan.