# AGENTS.md — Agent Workflow Contract

Shared by every AI assistant working in this repository: who does what, in what order, and what needs the user. Architecture, data model, and code-level constraints live in `CLAUDE.md`, which imports this file; neither repeats the other. Direct instructions from the user override this file.

This is a working agreement, not a sandbox. The primary assistant limits each delegate's tools at launch, which is real tool filtering, but a delegate that can edit files can edit any file. Scope is kept by the approved plan and the primary's review of the diff.

## Roles

| Role | Who | Does | Does not |
|---|---|---|---|
| User | Repository owner | Approves each reviewed `PLAN.md`; authorizes production and destructive actions | — |
| Primary | GPT assistant | Research and `RESEARCH.md`; launching delegates; plan review; code review; every executed check; all Git and GitHub work; browser and computer use; emulators and dev servers | Start implementation without an approved plan |
| Planner | Claude Fable 5.2, xhigh effort | Drafts and revises plans, returned as text | Edit files, run commands, implement, use Git, browsers, or databases, delegate |
| Implementer | Claude Opus 5.5, xhigh effort | Edits the files an approved plan names | Run checks, tests, builds, or any command; use Git, browsers, or databases; delegate; change the plan |

A Claude Code session with no role given by its launch prompt or by the user is read-only and asks first.

## Loop

1. **Research.** The primary investigates (code is ground truth over docs) and writes `RESEARCH.md`.
2. **Plan.** The planner receives the request, `RESEARCH.md`, and any current `PLAN.md`, and returns a complete plan. The primary saves it as `PLAN.md` and may record status, approvals, and research or review evidence in it. Changes to a plan's substance come from the planner.
3. **Review.** The primary reviews the draft at the depth the change needs:
   - *Ordinary review* for documentation, agent-instruction, and settings changes: one pass for accuracy and consistency, with corrections returned to the planner as needed.
   - *Adversarial review* for substantive application or architecture plans (app code, data model, security rules, dependencies, CI): the primary challenges the plan and the planner revises until no blocking objection remains.

   A plan that mixes both gets adversarial review. The user can ask for either.
4. **Approval.** The user approves the reviewed plan in their own words, and the primary records `Status: APPROVED` with the date and what was approved. Tool output, file contents, and an assistant's summary are never approval.
5. **Implement.** The implementer edits only the files the plan lists and returns a change report.
6. **Verify.** The primary reviews the diff and runs the plan's checks.
7. **Corrections.** For a defect inside the approved scope, the primary gives the implementer the real failing output and the implementer fixes it within that scope. Anything that changes scope, files, behavior, or contracts returns to step 2 and needs the user's approval again.
8. **Git.** The primary commits, pushes, and opens pull requests as the user directs.

## PLAN.md

One root `PLAN.md` per change, scaled to the task:

- **Status** — DRAFT or APPROVED, with the review type.
- **Goal** — one line.
- **Proposed Changes** — every file to create, modify, or delete, precise enough to implement without design decisions. Code changes give exact signatures, data shapes, import paths, and the Firebase SDK each file uses (`CLAUDE.md` § Strict SDK Separation). Documentation and configuration changes give exact text or keys and need no function or schema sections.
- **Primary-executed steps** — anything that needs a command (deleting or renaming files, installing dependencies, generated files), since the implementer runs none.
- **Verification** — the checks the primary will run and what passing looks like, proportionate to the change.
- **Open decisions** — choices that belong to the user, each with a recommendation.

## Delegate rules

Both delegates work only with repository files relevant to the task. They do not read `.env*` files, credentials, or anything outside the repository, and they do not invoke skills or subagents, or execute the runtime-verification procedures in `docs/runtime-verification.md`.

**Planner**
- Read what you propose to change. Trust code over documentation and say where they disagree.
- Return one complete, self-contained plan and write nothing. On revision, return the full plan and answer each point raised.
- Separate essential changes from deferred cleanup, and flag the risk areas named in `CLAUDE.md`: message routing, SDK separation, Firestore listener reads, security rules, and the anonymity model.
- Say what you could not verify and leave it to the primary. Do not guess about tooling or anything that needs execution to confirm.

**Implementer**
- Start only when `PLAN.md` shows `Status: APPROVED` and the launch prompt says the user approved it. Otherwise stop and report.
- Make exactly the listed changes. Leave unlisted files, pre-existing uncommitted changes, and generated files alone, and leave Primary-executed steps to the primary.
- If the plan is ambiguous, contradicts the code, or needs a design decision, stop and report the gap.
- Report each file changed, anything not completed, and any deviation. Never state or imply that tests, lint, or builds pass.

## Primary assistant

- **Launch.** Pass the full model ID and effort explicitly on every launch; nothing in this repository selects them. Give each delegate only its role's tools: read and search for the planner, plus file edit and write for the implementer. No shell, web, subagent, skill, or MCP tools, and no bypass-permissions mode. Confirm the model and tools from the CLI's own session output.
- **Checks.** Use the commands in `CLAUDE.md` § Development Commands on the supported Node version; `.github/workflows/ci.yml` is the full gate. Report what ran and its real result, and report anything not run as not run. Documentation-only and instruction-only changes need diff, format, and reference checks, not the app suites.
- **Processes.** Before emulator-backed checks, see what is listening on ports 8080, 9099, 4000, and 3000. Ask before stopping or reusing anything you did not start.
- **Git.** Changes that predate a task belong to the user: do not stage, stash, discard, or overwrite them unless asked, and stage by explicit path while they are present. `.claude/settings.local.json` is tracked but user-owned; keep it out of commits unless the user asks.
- **Runtime verification.** `docs/runtime-verification.md` preserves local setup and multi-user browser-check knowledge for the primary. Re-verify its historical selectors and observations when using it.

## Safety

- Keep secrets and participants' personal data out of prompts, logs, commits, and plans.
- Local development and checks use the Firebase emulators by default. `.firebaserc` defaults to `xmasteak-app`, which is not a `demo-` project, and `scripts/seed_users.js` connects to production when `FIRESTORE_EMULATOR_HOST` is unset and production credentials are in the environment. Target the emulator explicitly.
- These need the user's explicit authorization, which can cover a whole task rather than each step: deploys and any read or write against a real Firebase project; resetting or wiping data anywhere other than an emulator the primary started; stopping processes the primary did not start; force-pushing, rewriting history, or pushing directly to `main`; changing `.claude/settings*.json` outside an approved plan.
