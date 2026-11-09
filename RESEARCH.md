# Research: Project Agent Workflow Contract

## User requirements
- Primary GPT assistant owns codebase research, context preparation, adversarial plan review and feedback to Fable, code review, all executed checks, Git management, and browser/computer work.
- Claude Code Fable 5.2, xhigh: planning only.
- Claude Code Opus 5.5, xhigh: implementation only.
- First task: Fable assesses necessary changes to CLAUDE.md and other project-specific instructions/settings.
- Reviewed PLAN.md requires user approval before implementation. This task is planning, not authorization to alter workflow settings or application behavior.
- User clarification during planning: instructions/settings changes such as CLAUDE.md only need ordinary review, not an adversarial challenge round. Reserve adversarial review for substantive application plans.
- Subsequent user directions: launch Claude delegates visibly through Herdr, use Opus 5.5 at medium effort for this particular implementation, and close the other agents when work is done. Approval covers the planned individual protected-file edits; do not repeatedly request the same approval.
- Completion: Opus performed only file edits; primary reviewed, deleted the three retired agent definitions, and ran documentation/configuration checks. No application code, dependencies, CI, helpers, user settings, or service workers were changed by this task. No commits or staging performed.

## Repository baseline
- Started on `main`; primary assistant created `chore/agent-workflow-contract` for this task.
- Existing user changes, not ours: tracked modification to `.claude/settings.local.json`; untracked `public/sw.js`, `public/workbox-f1770938.js`, `public/worker-2a484529a5551160.js`.
- Do not overwrite, stage, delete, or reclassify those changes without explicit approval.
- Claude Code installed: 2.1.321. Local `--help` advertises model selection, xhigh effort, per-invocation tools, and plan permission mode. Exact requested model access is not yet verified.
- Previous launch failed before inference due to expired OAuth; user has reauthenticated and `claude auth status` now confirms login.
- Fable launch succeeded after reauthentication: stream initialization and actual response messages report `claude-fable-5-2`; CLI was explicitly passed `--effort xhigh`. Effective tools are only Glob, Grep, Read, with no MCP servers.
- Current host Node: v26.5.0. `package.json` requires >=22.13.0 <23. Primary assistant must choose a compatible runtime before future application checks.
- No app tests, builds, database operations, website navigation, or deployments have been performed for this planning task.

## Verified instruction/configuration findings

### CLAUDE.md
- RPI section assigns research to `codebase-research-analyst`, planning to `architect-planner`, implementation plus tests to `phase3-implementer`.
- Workflow conflicts with the user's new ownership; approval requirement should remain explicit.
- Development commands contain invalid `npm test:unit`, `npm test:integration`, and `npm test:watch`; actual scripts require `npm run ...`.
- Key Files calls Firestore rules permissive; Important Notes calls them hardened. Avoid turning documentation adjectives into unverified security guarantees.
- Valuable existing constraints include directional conversation IDs, UUID-based user IDs, client/Admin SDK separation, routing regression coverage, listener costs, and UI-only anonymity limitations.
- Existing architecture guidance should not be discarded or expanded into an app audit during this task.

### .claude/agents/architect-planner.md
- Frontmatter: `model: opus`, no explicit tool allowlist.
- Body says only writable output is PLAN.md; forbids application implementation.
- Mandatory exact function/schema/SDK sections are not proportionate to documentation-only work.
- Needs an explicit review/revision loop with the primary assistant and user approval gate.

### .claude/agents/phase3-implementer.md
- Frontmatter: `model: sonnet`, no explicit tool allowlist.
- Requires tests after every edited file plus final verification, contrary to user's implementation-only role.
- Contains obsolete claims: conversationId is a deterministic hash; isSantaAnonymous is an established field; repeats inline admin email instead of shared config.
- Some SDK language treats all src/app files as client while separately allowing API routes; preserve accurate client/server boundaries.
- Must report changes/blockers without claiming tests it did not execute. Primary assistant supplies actual check failures for implementation corrections; unapproved contract changes return to planning.

### .claude/agents/codebase-research-analyst.md
- Frontmatter: `model: opus`; tools include Bash, Write, WebFetch, Skill, SlashCommand, and other capabilities despite body claiming read-only/no editing tools.
- Examples contain stale message schema and hash claims.
- Primary assistant now owns research. Assess retirement versus updating; avoid leaving a conflicting auto-delegation path.

### .claude/settings.local.json
- Despite its name, file IS TRACKED (`git ls-files .claude`).
- User's existing diff adds broad Git, gh, firebase, npm, and other Bash permissions.
- Baseline also allows commands such as chmod, curl, and tests. Deny/ask arrays are empty.
- Must not silently overwrite or stage the user's changes; must not casually ignore/untrack a tracked modified file.
- Assess shared project settings versus local overrides. Instruction prose alone is not a security boundary. Per-invocation delegate tool restriction and effective permission precedence require verified handling.
- Do not add broad permissions, edit home-directory/global settings, or assume settings filenames enforce role isolation.

### .claude/skills/test-runner/
- SKILL.md, README.md, run-tests.sh auto-select integration INSTEAD OF unit if any process occupies port 8080.
- Thus test:smart is not a full validation gate and port occupancy does not identify Firebase.
- SKILL.md troubleshooting suggests killing processes by port and deleting package-lock.json.
- package.json test:smart points to this helper; avoid script/API removal without handling the reference.
- Primary assistant owns checks. Prefer documentation/ownership correction to script redesign unless necessary for this task.

### .claude/skills/verify/SKILL.md
- Claims npm run dev uses Turbopack and must not be used. Current package.json dev is already next dev --webpack.
- Provides browser actions, emulator seeding, and destructive account resets. These require explicit primary-assistant ownership and target/authorization safety, not automatic delegation.

### .claude/skills/db-admin/ and visual-qa/
- Include SKILL.md, README.md, and shell helpers with database and browser operations.
- These must not become backdoors for planner/implementer execution.
- db-admin examples include outdated auth API and inline admin identity.
- visual-qa uses npx Puppeteer latest although Puppeteer is not declared; Playwright is installed and e2e commands exist. Do not modernize browser tooling in a workflow-only task without need.
- Consider linked-document consistency if skill contracts change; avoid exhaustive unrelated rewrite.

## Other relevant files
- `package.json`: dev/build already use --webpack; scripts for lint, unit, integration, Playwright, smart helper; Node >=22.13.0 <23.
- `.github/workflows/ci.yml`: Node 22; Java 17; lint/unit/integration/e2e jobs already exist. No CI changes needed solely to reassign agent roles.
- `README.md` already exists. Avoid treating old proposals to create it as current work.
- `.gitignore` does not ignore `.claude/settings.local.json`; existing tracked status cannot be fixed by adding an ignore entry alone.
- `plans/README.md` and `plans/01-documentation-truth-up.md` contain historical backlog recommendations. They are not current authorization; archive/migration proposals may already be completed or stale.
- `.agent/db-json-analysis.md` is a project artifact to assess only if relevant; don't expose data contents unnecessarily.

## Planner questions
1. What is the smallest coherent set of instruction/config changes that enforces the requested role split without replacing it with more agent automation?
2. Is a shared AGENTS.md useful for GPT/Claude, and how can CLAUDE.md link rather than duplicate it?
3. Which capabilities must be restricted at delegate launch versus project agent frontmatter? Do not assume unsupported version/effort keys.
4. How should existing tracked and user-modified local permissions be handled without overwriting user work or weakening effective restrictions?
5. Which legacy agents/skills should be retired, redirected, or retained for primary-assistant use only?
6. How can safety around credentials, production targets, destructive emulator operations, existing processes, and Git be made explicit and proportionate?

## Verification ownership and limits
All executed checks belong to the primary assistant. A docs/config plan should specify concrete syntax/consistency checks, preservation of existing changes, and capability assertions. Do not claim any result not executed. Runtime application checks should be justified by scope rather than mechanically requiring all suites for markdown-only edits.
