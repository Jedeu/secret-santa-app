# Plan 7: Small Polish Items (Backlog §7)

Six independent fixes, each small enough for a single commit. Could ship as one "polish" PR.

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

## Verification (whole plan)

```
npm run lint
npm test
npx jest --listTests   # suite count unchanged after 7.6
npm run build          # 7.1 viewport export still valid
```
