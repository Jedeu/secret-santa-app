# Plan 5: AdminPanel `full` Variant — Product Decision (Backlog §5, surfaced by PR #55)

## Goal

Resolve the dangling admin-shuffle feature: `AdminPanel`'s `full` variant (the only UI path to `/api/admin/assign`) is rendered nowhere, so the shuffle endpoint is unreachable from the app.

## Ground Truth

- `src/components/AdminPanel.js:15`: `variant = 'full'` renders "Start Exchange (Admin)" (→ `/api/admin/assign`) + "Reset App (Admin)". Only the `compact` variant (reset-only, header) is referenced anywhere in the app. This was already true before the dead-code sweep.
- `src/app/api/admin/assign/route.js`: Fisher-Yates shuffle → circular assignment → `batchUpdateUsers`. Admin-gated via Bearer token + `isAdmin()`.
- The live flow is **self-selection**: users pick their own recipient (`RecipientSelector.js`, `/api/dev/assign` for dev), enforced by the `isAllowedSelfRecipientSelection` / `isAllowedRecipientClaimUpdate` rules.
- `assignSecretSantas`-related helpers live in `src/lib/firestore.js`; `__tests__/admin_ui.test.js` covers AdminPanel.

## Decision Required (user call — pick one)

### Option A: Delete the variant + endpoint (recommended)

Self-selection is the real product flow; the shuffle contradicts it (Plan 4 item 3 exists only because of this endpoint). Deleting removes an admin-privileged write path that can silently trample user choices.

Changes:
- `src/components/AdminPanel.js`: remove `variant` prop, `handleAssign`, `onAssignComplete`, and the `full` branch — component becomes the compact reset button.
- Delete `src/app/api/admin/assign/route.js`.
- `src/lib/firestore.js`: remove `batchUpdateUsers` **iff** the deleted route was its last caller (grep first; `/api/dev/assign` may share helpers — dev routes stay).
- Tests: prune `full`-variant / assign cases from `__tests__/admin_ui.test.js`.
- Docs: drop the route from CLAUDE.md's API list (coordinate with Plan 1); **close Plan 4 item 3 as moot**.

### Option B: Give the shuffle a UI home

Keep a "start the exchange for everyone" escape hatch (e.g., participants who never log in to self-select).

Changes:
- Render `<AdminPanel variant="full" …/>` somewhere admin-visible (e.g., `Sidebar.js` or a `/admin` section in `page.js`).
- **Must** land Plan 4 item 3 (force-flag guard) in the same change — an unguarded reshuffle button next to live self-selections is a footgun.
- Add an e2e/unit test proving the button is reachable and gated to admin.

## Verification

- Option A: `npm test`; grep for `admin/assign`, `handleAssign`, `variant="full"`, `batchUpdateUsers` ⇒ no remaining references; `npm run build`.
- Option B: `npm test` + manual admin-login smoke via emulators (`visual-qa` skill).

## Recommendation

**Option A.** The endpoint has had no UI path through at least two audits, the rules architecture is built around self-selection, and deletion also cancels Plan 4 item 3. If a season ever needs a forced shuffle, `/api/admin/assign` can be resurrected from git history behind the force-flag guard.
