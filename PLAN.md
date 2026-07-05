# PLAN: Dead-Code Sweep

## Goal

Remove code with zero production callers, verified by reference search: unused firestore.js exports and their orphaned indexes, unused imports, an unreachable UI branch, and duplicated conversation-ID parsing.

## Proposed Changes

1. **`src/lib/firestore.js`** — delete unused exports: `getMessages`, `getUserMessages`, `getUnreadCount`, `markAsRead`, `getLastRead`, `getUserById`, `getUsersByName`, `getPlaceholderUserByName`, `getAllMessagesWithCache`, `getAllUsersWithCache`, `sendMessage`. (Note: the dead `markAsRead` wrote `lastReadAt` as an ISO string, which current firestore.rules would reject — it predates the read-receipts rework.) Keep `updateUser` (used by integration tests as a fixture helper).
2. **`__tests__/lib/firestore.test.js`** — drop the test blocks and imports for the deleted functions.
3. **`firestore.indexes.json`** — remove all three composite indexes; they only served the deleted compound queries. Every remaining query is single-field (auto-indexed).
4. **`src/hooks/useRealtimeMessages.js`** — remove unused imports left over from the Context refactor: `firestore`, the whole `firebase/firestore` import, the listener-tracker functions, and `useRef`.
5. **`src/app/page.js`** — remove the unreachable `!currentUser?.recipientId` branch ("Waiting for assignments…" + AdminPanel `full` variant): AuthGuard blocks null users and `needsRecipient` diverts users without a recipient to RecipientSelector, so the condition can never be true. AdminPanel's `full` variant becomes unreferenced but is intentionally left in place (separate decision whether to rewire the admin assign UI).
6. **`src/lib/message-utils.js`** — export the currently-private `parseConversationId`.
7. **`src/components/PublicFeed.js`** and **`src/lib/push-server.js`** — delete their local copies of `parseConversationId` (and PublicFeed's `getConversationId`) and import from `@/lib/message-utils` (pure module, safe on both sides of the SDK boundary).

## Verification

- `npm run lint`
- `npm run test:unit`
- `npx firebase emulators:exec --project=demo-secret-santa "npm run test:integration"`
- `npm run build`
