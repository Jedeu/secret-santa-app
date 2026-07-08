# Plan 7: Small Polish Items (Backlog §7)

Seven independent fixes, each small enough for a single commit. Could ship as one "polish" PR.

## 7.1 Restore pinch-zoom (WCAG 1.4.4)

- **Ground truth**: `src/app/layout.js:4-9` viewport export sets `maximumScale: 1, userScalable: false`.
- **Change**: delete both properties, keep `width: 'device-width', initialScale: 1`.
- **Watch out**: `__tests__/unit/layout_metadata.test.js` may assert the viewport shape — update it to assert the properties are *absent*.

## 7.2 Fix last lint warning in ClientProviders

- **Ground truth**: `src/components/ClientProviders.js:126-131` — the unmount cleanup reads `timeoutMapRef.current` directly (react-hooks/exhaustive-deps warns the ref may have changed by cleanup time).
- **Change**: inside the effect body, `const timeoutMap = timeoutMapRef.current;` then use `timeoutMap` in the cleanup.
- **Verify**: `npm run lint` ⇒ zero warnings.

## 7.3 `.gitignore` typo

- **Ground truth**: line under `# Misc` reads `.DS_Stored`; the real macOS artifact is `.DS_Store` (currently NOT ignored).
- **Change**: `.DS_Stored` → `.DS_Store`. Check `git ls-files | grep DS_Store` for any already-committed copies to `git rm --cached`.

## 7.4 Memoize PublicFeed grouping; stop mid-render mutation

- **Ground truth**: `src/components/PublicFeed.js` rebuilds `threads`/`threadList` (lines ~46-140) and re-sorts on every render with no `useMemo`; lines 197-199 compute `thread.unreadCount` by mutating `threadList` objects mid-render (a React anti-pattern that breaks with concurrent rendering).
- **Change**:
  - Wrap the group/sort pipeline in `useMemo` keyed on `[messages, currentUserId, …]` (whatever inputs it actually reads).
  - Compute `unreadCount` inside the same memo (or a derived memo), producing new thread objects instead of mutating — `{ ...thread, unreadCount }`.
  - The per-thread message sort at line ~295 moves into the memo too.
- **Verify**: `npx jest __tests__/unit/PublicFeed_grouping.test.js __tests__/unit/PublicFeed_lastViewed_sync.test.js --runInBand` (CLAUDE.md requires PublicFeed_grouping after message-logic changes).
- **Coordinate**: if Plan 6.3 (legacy removal) lands first, this refactor shrinks; do 6.3 → 7.4 if both are queued.

## 7.5 Refresh relative timestamps in Chat

- **Ground truth**: `formatRelativeTime` (`src/components/Chat.js:28-49`) renders "Just now"/"5m ago" but nothing re-renders on a timer, so labels go stale until an unrelated re-render.
- **Change**: add a low-cost tick — `const [, setNow] = useState(0)` + `useEffect` with `setInterval(() => setNow(n => n + 1), 60_000)` (cleanup on unmount). Optionally pause when `document.visibilityState !== 'visible'` (same gate as Plan 2) to avoid background work.
- **Verify**: existing Chat unit tests pass; manual: leave a chat open >1 min, label ticks from "Just now" to "1m ago".

## 7.6 Relocate stray root-level test files

- **Ground truth**: five test files sit at `__tests__/` root outside the documented `unit/`/`integration/` split, and all run in the unit suite: `admin_ui.test.js`, `integration_flows.test.js`, `outbox_retry_delivery.test.js`, `participants.test.js`, `realtime_hooks.test.js`. (Directories `__tests__/api/`, `__tests__/lib/`, `__tests__/context/` also sit outside the split — leave them or fold into `unit/` as a follow-up.)
- **Change**: `git mv` the five files into `__tests__/unit/`. Rename `integration_flows.test.js` → `app_flows.test.js` (it's a jsdom unit test; the name is the confusing part). Fix any relative imports to `../helpers`/`./setup` (they'd become `../helpers` → check each file's imports after the move).
- **Watch out**: `npm run test:unit` ignores `/helpers/` and `setup.js` by pattern — moving test files (not helpers) doesn't change what runs, but confirm the count of collected suites is identical before/after (`npx jest --listTests | wc -l`).

## 7.7 Make e2e send assertions detect server-side send failures

- **Ground truth**: discovered during PR #59 — for months, two e2e message sends failed server-side in CI (Auth-emulator tokens carried `aud: demo-secret-santa` while the Admin SDK expected `xmasteak-app`) yet the suite stayed green, because:
  - `e2e/unread-badge.spec.ts:154-168` `sendMessage()` asserts the message text appears in the **sender's own page**, which the optimistic outbox renders even when `/api/messages/send` fails.
  - `e2e/messaging.spec.ts:166-174` does check the recipient's page, but wraps it in `if (await messageInB.isVisible(...))` — a failed delivery is silently skipped, not failed.
  - PR #59 fixed the project-id mismatch itself (`--project=xmasteak-app` in both CI emulator jobs); this item fixes the assertions so a future send regression can't hide behind optimistic rendering again.
- **Change**:
  - `messaging.spec.ts`: replace the `if (visible)` guard around the recipient-side check with an unconditional `await expect(messageInB).toBeVisible({ timeout: ... })`. The guard's original excuse ("assignments may differ") is moot — the test already seeds via `/api/dev/seed` + `/api/dev/assign`.
  - `unread-badge.spec.ts` `sendMessage()`: after the sender-view wait, also assert no failed/retry state on the message (or assert delivery via the observing context, which these two-context tests already have open). Alternatively, intercept the `/api/messages/send` response via `page.waitForResponse` and assert `response.ok()`.
- **Verify**: `npx firebase emulators:exec --project=xmasteak-app "npm run test:e2e"` passes; then temporarily break token verification (or point `--project` back to `demo-secret-santa`) and confirm the suite now **fails** instead of passing with buried `[WebServer]` errors.

## Verification (whole plan)

```
npm run lint
npm test
npx jest --listTests   # suite count unchanged after 7.6
npm run build          # 7.1 viewport export still valid
```
