# PLAN: Remove Redundant Project Skills

Status: APPROVED — user directed the primary assistant to implement the skills assessment directly, without Fable or Opus. Ordinary review; no delegates involved.

Completion: Implemented directly. On Node 22.15.0, `npm run lint` passed and `npm run test:unit -- --runInBand` passed (39 suites, 184 tests). Static scope, JSON, reference, whitespace, and user-change preservation checks passed. No build/integration/E2E checks or database operations. No agents were launched. The user subsequently requested committing and pushing these changes on the feature branch; pre-existing settings and generated service-worker changes remain excluded.

## Goal
Remove redundant project-local skills and preserve useful runtime-verification knowledge in ordinary documentation.

## Proposed Changes
- Create `docs/runtime-verification.md`: preserve the emulator-only setup, popup selector gotchas, directional assignment mapping, REST lookup, isolated-user procedure, typing/unread/read-receipt observables, visibility simulation, expected headless notification noise, and console-error expectations. Use tool-neutral instructions and label inherited observations for re-verification. Distinguish dev-login tests from Google-popup verification; protect existing emulator state.
- Delete the ten tracked files under `.claude/skills/{test-runner,db-admin,visual-qa,verify}/` (their SKILL.md, README.md and shell helpers, as applicable), plus `scripts/visual_qa.js`. Leave unrelated pre-existing files such as `.DS_Store` alone.
- `package.json`: remove only the obsolete `test:smart` script. No dependency or lockfile change.
- `CLAUDE.md`: remove the obsolete smart-runner sentence and link to the runtime-verification document.
- `README.md`: replace the retired database-skill reference with the participant-list source and runtime-verification document.
- `AGENTS.md`: remove retired skill-directory references and point primary-assistant runbook guidance to the runtime document. Keep other role/safety constraints unchanged.
- `plans/08-project-skills-review.md`: record user approval and completion metadata without rewriting Fable's historical assessment.

## Primary-executed steps
All changes, checks and Git handling are primary-owned by direct user instruction. Do not start any agents. Preserve the existing branch and all unrelated changes, especially `.claude/settings.local.json`, public service-worker files, application code, API routes and database scripts. No staging, commits, installs into project dependencies, database operations or production actions are part of this cleanup.

## Verification
- `git diff --check`; check new markdown whitespace/links and JSON syntax.
- Search live project files for obsolete skill/helper/script references; historical plans and research may retain them.
- Compare file hashes against the pre-cleanup baseline; verify only intended files changed and original user changes are preserved.
- On Node 22 (`.nvmrc`: 22.15.0), run `npm run lint` and `npm run test:unit -- --runInBand`. If needed, use a pinned temporary Node runtime without modifying package metadata/dependencies.
- Do not run build, integration, or E2E for this removal of obsolete tooling; no app behavior changed and those checks require additional runtime/emulator setup.
