# Progress Against PLAN.md

Last updated: 2026-02-08

## Part 1: Bug Inventory Progress

| ID | Status | Notes |
|---|---|---|
| BUG-1 | Completed | Fixed Santa unread asymmetry in `/Users/jed.piezas/Desktop/secret-santa-app/src/hooks/useRealtimeMessages.js` so legacy messages (no `conversationId`) are counted consistently. Added regression test in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/realtime_hooks.test.js`. Verified with `npx jest __tests__/realtime_hooks.test.js --runInBand`. |
| BUG-2 | Completed | Fixed legacy message duplication in `/Users/jed.piezas/Desktop/secret-santa-app/src/lib/message-utils.js` by deterministic legacy routing and `isSantaMsg`-aware fallback. Updated `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/message_routing.test.js`. Verified with `npx jest __tests__/unit/message_routing.test.js --runInBand`. |
| BUG-3 | Completed | Fixed Public Feed legacy threading ambiguity in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/PublicFeed.js` by using deterministic conversation routing for ambiguous legacy rows and preserving sender identity labels instead of forcing Santa role inference. Updated `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/PublicFeed_grouping.test.js`. Verified with `npx jest __tests__/unit/PublicFeed_grouping.test.js --runInBand`. PR: `https://github.com/Jedeu/secret-santa-app/pull/27` (commit `0c2720e`). |
| BUG-4 | Completed | Hardened `/Users/jed.piezas/Desktop/secret-santa-app/firestore.rules` with collection-scoped access controls: validated `messages` creates (sender identity must match authenticated email), restricted `lastRead` reads/writes to owner-scoped documents, and constrained `users` writes to first-time self-selection/recipient-claim paths instead of global authenticated read-write. |
| BUG-5 | Completed | Replaced check-then-batch recipient assignment with atomic `runTransaction()` logic in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/RecipientSelector.js`, preventing concurrent claim overwrite races. Added coverage in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/RecipientSelector.test.js`. Verified with `npx jest __tests__/unit/RecipientSelector.test.js --runInBand`. |
| BUG-6 | Completed | Added synchronous submit lock (`submitLockRef`) in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/RecipientSelector.js` so rapid double-clicks cannot invoke `handleSetRecipient` twice before React state propagation. Extended `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/RecipientSelector.test.js` with a double-submit regression test. Verified with `npx jest __tests__/unit/RecipientSelector.test.js --runInBand`. |
| BUG-7 | Completed | Added server-validated message write path via `/Users/jed.piezas/Desktop/secret-santa-app/src/app/api/messages/send/route.js` (token verification + sender identity derived from authenticated email), and updated `/Users/jed.piezas/Desktop/secret-santa-app/src/components/Chat.js` to POST through that endpoint instead of direct client `addDoc()` writes. Added API coverage in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/api/send_message_api.test.js` and updated send-flow mocks in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/integration_flows.test.js`. Verified with `npx jest __tests__/api/send_message_api.test.js __tests__/integration_flows.test.js __tests__/unit/RecipientSelector.test.js --runInBand`. |
| BUG-8 | Completed | Added Firestore-backed initial `lastViewed` hydration in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/PublicFeed.js` by loading `publicFeed_<threadId>` timestamps from cache/Firestore (`lastRead` docs) and merging into local state/localStorage. Added regression test `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/PublicFeed_lastViewed_sync.test.js`. Verified with `npx jest __tests__/unit/PublicFeed_grouping.test.js __tests__/unit/PublicFeed_lastViewed_sync.test.js --runInBand`. |
| BUG-9 | Completed | Updated `/Users/jed.piezas/Desktop/secret-santa-app/src/components/Chat.js` auto-scroll logic to keep the viewport pinned for incoming messages only when the user is already near the bottom (while preserving instant scroll for own sends). Added regression coverage in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/Chat_unread.test.js`. Verified with `npx jest __tests__/unit/Chat_unread.test.js __tests__/integration_flows.test.js __tests__/unit/PublicFeed_lastViewed_sync.test.js --runInBand`. |
| BUG-10 | Completed | Replaced blocking `alert()` calls with non-blocking toast notifications via shared toast context in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/ClientProviders.js`, and migrated usages in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/RecipientSelector.js`, `/Users/jed.piezas/Desktop/secret-santa-app/src/components/AdminPanel.js`, `/Users/jed.piezas/Desktop/secret-santa-app/src/components/AuthGuard.js`, and `/Users/jed.piezas/Desktop/secret-santa-app/src/components/Chat.js`. Updated `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/RecipientSelector.test.js` for toast assertions. Verified with `npx jest __tests__/unit/RecipientSelector.test.js __tests__/integration_flows.test.js __tests__/unit/Chat_unread.test.js --runInBand`. |
| BUG-11 | Completed | Added explicit `aria-label="Add emoji"` on the emoji picker trigger button in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/Chat.js` and added accessibility regression coverage in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/Chat_unread.test.js`. Verified with `npx jest __tests__/unit/Chat_unread.test.js --runInBand`. |
| BUG-12 | Completed | Added live-region semantics to unread badges in `/Users/jed.piezas/Desktop/secret-santa-app/src/components/Sidebar.js`, `/Users/jed.piezas/Desktop/secret-santa-app/src/components/TabNavigation.js`, and `/Users/jed.piezas/Desktop/secret-santa-app/src/components/Chat.js` (`role="status"`, `aria-live="polite"`, `aria-atomic="true"` with descriptive `aria-label`). Added accessibility assertions in `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/Sidebar.test.js` and `/Users/jed.piezas/Desktop/secret-santa-app/__tests__/unit/Chat_unread.test.js`. Verified with `npx jest __tests__/unit/Sidebar.test.js __tests__/unit/Chat_unread.test.js __tests__/integration_flows.test.js --runInBand`. |

## Part 2: Mobile PWA Progress

| Step | Status | Notes |
|---|---|---|
| Step 1: `public/manifest.json` | Not started | No manifest added yet. |
| Step 2: Icons in `public/icons/` | Not started | Icon assets not created yet. |
| Step 3: `src/app/layout.js` metadata | Not started | PWA metadata/manifest links not added yet. |
| Step 4: `next-pwa` integration | Not started | `@ducanh2912/next-pwa` not wired in yet. |
| Step 5: Push notifications (future) | Not started | Still out-of-scope. |

## Security Notes (Context-Aware)

- Current trust model (8 known users via Firebase Auth) reduces practical risk, but `firestore.rules` are still technically permissive for any authenticated user.
- Easy hardening opportunity (low effort): restrict access to known user IDs/emails in rules and lock admin-only operations by admin identity checks.

## Operational Notes

- Git/PR flow from this agent session has had intermittent permission/escalation interruptions.
- `gh` CLI was installed, but this runtime reports an invalid token in `gh auth status`; PR creation has been handled via branch push + user-side PR creation when needed.
