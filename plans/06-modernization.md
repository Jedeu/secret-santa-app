# Plan 6: Modernization (Backlog §6, audit item 7 — longer-term)

Seven independent workstreams, ordered by value/effort. Each is its own PR; none block the others except where noted.

## 6.1 Replace deprecated `enableIndexedDbPersistence`

**Ground truth**: `src/lib/firebase-client.js:48-67` calls the deprecated API and logs a warning when a second tab steals persistence (`failed-precondition`).

**Change** (`src/lib/firebase-client.js`):
- Swap `getFirestore(app)` + `enableIndexedDbPersistence(db, …)` for cache config at init:
  ```js
  import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
  db = initializeFirestore(app, {
      localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
          cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      }),
  });
  ```
- `initializeFirestore` must run before any `getFirestore` for the app; the re-entry branch (`getApps().length`, line 71-75) can keep `getFirestore(app)` — it returns the already-initialized instance.
- `connectFirestoreEmulator` ordering is unchanged (after init, before first use).
- Delete the `persistenceEnabled` flag and the `.catch` ladder; keep a one-line log.
- Bonus: fixes the multi-tab limitation (both tabs share the cache).

**Verify**: `npm run dev` against emulators — console shows emulator connect, no deprecation warning; open two tabs, both work; `npm test`.

## 6.2 TypeScript migration (incremental, start with `src/lib/`)

**Why**: the `senderId`→`fromId` docs drift (Plan 1) is exactly the bug class types prevent. `jsconfig.json` `@/*` aliases already exist.

**Phase 1** (this plan's scope): `npm i -D typescript @types/react @types/node`; add `tsconfig.json` (`allowJs: true`, `checkJs: false`, `strict: true`, paths from jsconfig; delete jsconfig.json — tsconfig supersedes it); `next build` auto-detects TS. Convert the pure-logic leaves first: `message-utils.js`, `config.js`, `participants.js`, `logger.js` → `.ts`, defining shared types in `src/lib/types.ts` (`User`, `Message`, `Conversation` shapes taken from the send route + rules).
**Phase 2+** (later PRs): remaining `src/lib`, hooks, components. No `any` in converted files; add `tsc --noEmit` to the lint CI job once phase 1 lands.

**Verify**: `npm run build`, `npm test` (jest picks up `.ts` via next/jest transform — confirm `jest.config` uses next/jest; if not, add `ts-jest`/babel preset).

## 6.3 Legacy-message backfill + dual-routing removal

**Ground truth**: legacy branches live in `src/lib/message-utils.js:72-86` (`filterMessages` fallbacks), `src/hooks/useRealtimeMessages.js:182,207-209`, and `src/components/PublicFeed.js:46` (sorted-pair fallback). CLAUDE.md marks this the designated complexity hotspot. After any reset there are no legacy rows.

**Steps**:
1. One-time migration script `scripts/backfill-conversation-ids.js` (Admin SDK, import from `@/lib/firebase.js` pattern): for each message missing `conversationId`, resolve direction via `isSantaMsg` + the users' `recipientId`/`gifterId`, stamp `santa_{id}_recipient_{id}`. Dry-run flag that prints planned writes. **Note**: rules forbid message updates — the Admin SDK bypasses rules, so this must run server-side.
2. Run against prod (or simply reset for the season — then there's nothing to migrate).
3. Delete the legacy branches: `filterMessages` fallback logic, `getLegacyConversationId` + its callers, hook conditionals, PublicFeed's sorted-pair path.
4. Simplify tests: `__tests__/unit/message_routing.test.js`, `__tests__/unit/PublicFeed_grouping.test.js` lose their legacy cases (CLAUDE.md says always run PublicFeed_grouping after touching message logic).

**Verify**: `npm test`, `npm run test:integration`, and update CLAUDE.md's "Known Complexity" section (the hotspot no longer exists).

## 6.4 Drop the `uuid` dependency

`crypto.randomUUID()` (Node 20+ and all modern browsers) covers the `uuidv4()` call sites: `src/hooks/useUser.js:6,62` and `src/app/api/messages/send/route.js:2,222` (`message-outbox.js` already prefers it). **Coordinate with Plan 4 item 1**: if the deterministic user-ID fix uses `uuidv5`, either keep `uuid` for that one import or derive the ID via `crypto` hashing instead. Also note `uuid` v14 is a deferred major — dropping it moots that.

**Verify**: `npm test`; grep `from 'uuid'` ⇒ none; `npm uninstall uuid`; `npm run build`.

## 6.5 Styling consolidation

Pervasive inline style objects; `PublicFeed.js` does hover via `onMouseEnter` mutation. Recommendation: **CSS Modules** (zero new deps, Next-native) over Tailwind (repo-wide rewrite + tooling). Phased: start with `PublicFeed.module.css` (fixes the hover hack with `:hover`), then `Chat`, `Sidebar`. Keep `globals.css` custom properties (`--accent`, `--surface-highlight`) as the token layer. Low priority; do opportunistically when touching a component.

## 6.6 PWA plugin: `next-pwa` → Serwist (optional)

`next build --webpack` is pinned for `@ducanh2912/next-pwa` (see `package.json` + `__tests__/unit/package_scripts_build.test.js` + `next_config_pwa.test.js`, which enshrine the pin). Serwist (`@serwist/next`) is the Turbopack-compatible successor; migration touches `next.config.js`, `worker/index.js` (custom push worker must port), and both guard tests. Only worth it if default (Turbopack) builds are wanted; otherwise defer.

## 6.7 Deferred dependency majors

| Package | Current | Major | Blocker/note |
|---|---|---|---|
| `eslint` / `@eslint/js` | 9.x | 10 | Flat-config already in use; check plugin compat (`eslint-config-next` 16) |
| `globals` | 16.x | 17 | Trivial, bundle with eslint bump |
| `uuid` | 11.x | 14 | Mooted if 6.4 lands |
| `firebase-tools` | 14.x | 15 | Drops Java < 21 — bump `java-version` to 21 in **both** CI emulator jobs (e2e + Plan 3's integration job) in the same PR |

Remaining `npm audit` findings are transitive build-time deps awaiting upstream (`postcss` via `next`, `serialize-javascript` via `next-pwa`, nested `uuid` copies via Google's `gaxios`/`teeny-request`) — no action, re-check after each `next`/`firebase-admin` release.

## Suggested Order

6.1 (small, immediate win) → 6.4 (trivial, after Plan 4 decides the v5 question) → 6.3 (biggest simplification) → 6.2 phase 1 → 6.7 → 6.5/6.6 opportunistically.
