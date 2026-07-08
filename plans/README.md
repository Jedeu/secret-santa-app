# Backlog Plans

One plan per section of `BACKLOG.md` (July 2026 audit follow-ups). Each is grounded in the code as of branch `chore/dead-code-sweep` and follows the CLAUDE.md PLAN.md convention (Goal / Proposed Changes / Verification).

| Plan | Backlog § | Scope | Effort | Blocked by |
|---|---|---|---|---|
| [01-documentation-truth-up](01-documentation-truth-up.md) | 1 | CLAUDE.md rewrite, archive stale artifacts, add README | S | — |
| [02-ux-correctness-fixes](02-ux-correctness-fixes.md) | 2 | Visibility-gated mark-as-read; typing debounce→throttle | S–M | — |
| [03-ci-integration-tests](03-ci-integration-tests.md) | 3 | Run integration + rules tests in CI | S | — |
| [04-correctness-robustness](04-correctness-robustness.md) | 4 | useUser dup race, email casing, assign guard, trust-model doc | M | Item 3 waits on Plan 5 decision |
| [05-admin-assign-decision](05-admin-assign-decision.md) | 5 | Delete vs. re-home the admin shuffle (**user decision**) | S | — |
| [06-modernization](06-modernization.md) | 6 | Persistence API, TS migration, legacy backfill, dep majors | L (phased) | 6.4 coordinates with Plan 4 item 1 |
| [07-small-polish](07-small-polish.md) | 7 | Six one-commit fixes (zoom, lint, gitignore, memo, timestamps, test layout) | S | 7.4 easier after 6.3 |

**Suggested order**: 03 (CI safety net first) → 07 → 02 → 05 (decision) → 04 → 01 (docs last, so they describe the post-fix state) → 06 phased.

**Cross-plan couplings**:
- Plan 5 Option A deletes `/api/admin/assign` ⇒ Plan 4 item 3 becomes moot.
- Plan 4 item 1 may use `uuidv5` ⇒ affects Plan 6.4 (drop `uuid`).
- Plan 1's CLAUDE.md rewrite should absorb Plan 4 item 4 (trust model) and reflect Plan 5's outcome.
- `firebase-tools` v15 (Plan 6.7) requires Java 21 in both CI emulator jobs (Plan 3 adds the second one).
