# Backlog: Remaining Audit Items

From the July 2026 codebase audit. Completed so far: dependency security upgrade + `resetDatabase` hardening (PR #54), dead-code sweep (PR #55).

## 1. Documentation truth-up (audit item 3)

- **Rewrite CLAUDE.md's Architecture / Data Model sections against real code.** The documented message schema (`senderId`/`recipientId`/`message`/`isSantaAnonymous`/`read`, Firestore Timestamp) doesn't exist — the real one is `fromId`/`toId`/`content`/`conversationId` with ISO-string timestamps. `getConversationId` is documented as a "hash of two user IDs" but is the directional `santa_{id}_recipient_{id}` format. The API route list omits `/api/messages/send`, `/api/push/*`, `/api/dev/*`. "Firestore rules are minimal" is long stale — they were hardened in PR #27-era work.
- **Clean up stale workflow artifacts:** `PLAN-QOL.md` and `RESEARCH-FINDINGS.md` (untracked, root) describe completed February work — archive or delete. `PROGRESS.md` (tracked) tracks the old PLAN.md and is now inconsistent with it.
- **Add a README.md** — CLAUDE.md currently doubles as human onboarding.

## 2. UX correctness fixes (audit item 4)

- **Visibility-gate mark-as-read** (`src/components/Chat.js:94-99`): the effect calls `updateLastReadTimestamp` on every `messages` change with no `document.visibilityState` check, so messages arriving while the app sits in a background tab are instantly marked read — false "✓✓ Read" receipts and vanishing unread badges. `NotificationSoundRuntime` already has the right gate to copy.
- **Typing indicator: debounce → throttle** (`src/lib/typing-client.js:21`): `setTyping` resets a 2s timer per keystroke, so nothing is written while someone types continuously — "is typing…" mostly appears after they *stop*. Should write immediately, then at most every 2s. The unit test enshrines the current behavior and needs updating with it.

## 3. CI gap (audit item 5)

- **The integration suite — including all three Firestore rules tests — never runs in CI.** Add a job to `.github/workflows/ci.yml`: `npx firebase emulators:exec --project=demo-secret-santa "npm run test:integration"` (the e2e job already proves emulators work in CI; needs the same Java setup step).

## 4. Correctness / robustness backlog (from audit section 2)

- **Duplicate-user race in `useUser`** (`src/hooks/useUser.js:49-74`): query-then-create with client UUID; two devices signing in simultaneously can create two user docs for one email. Fix with a transaction or deterministic doc ID; neither code nor rules enforce email uniqueness.
- **Email casing normalization**: user docs store the OAuth email verbatim while `/api/messages/send` and push routes query `.toLowerCase()` and rules compare exactly. Works only because Google returns lowercase. Normalize once at creation.
- **Admin assign endpoint tramples self-selection** (`/api/admin/assign`): unconditionally reshuffles all `recipientId`/`gifterId` values and doesn't touch existing conversations. Should refuse (or require a force flag) when assignments exist.
- **Document the anonymity trust model in CLAUDE.md**: rules let any signed-in participant read all messages/users, so unmasking your Santa via DevTools is trivial, and anyone can message anyone (no pairing check on send). Accepted trade-off for 8 friends — but it should be written down as such, since a real fix needs server-side identity stripping.

## 5. Open product decision (surfaced by PR #55)

- **AdminPanel `full` variant is unreferenced** — there is no UI path to `/api/admin/assign` (was already unreachable before the sweep). Either delete the variant + endpoint (self-selection is the real flow) or give the admin shuffle a new UI home.

## 6. Modernization (audit item 7, longer-term)

- **`enableIndexedDbPersistence` is deprecated** (`src/lib/firebase-client.js:49`) and fails with multiple tabs open. Replace with `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` — also fixes the multi-tab limitation.
- **TypeScript migration**, incremental, starting with `src/lib/` — the `senderId`→`fromId` docs drift is exactly the bug class it prevents. `jsconfig.json` aliases already exist.
- **Legacy-message backfill + branch removal**: one-time migration stamping `conversationId` onto old message docs would let the dual legacy/new routing in `message-utils.js`, `PublicFeed.js`, and the unread hooks be deleted (CLAUDE.md's designated complexity hotspot). After any reset there are no legacy rows anyway.
- **Drop `uuid` dependency**: `crypto.randomUUID()` covers all remaining `uuidv4()` call sites (message-outbox already prefers it).
- **Styling consolidation**: pervasive inline style objects; CSS modules or Tailwind would shrink components and enable pseudo-classes (PublicFeed does hover via `onMouseEnter` mutation).
- **`next build --webpack` is pinned for `@ducanh2912/next-pwa`**; Serwist is the Turbopack-compatible successor if default builds are ever wanted.
- **Deferred dependency majors**: `eslint` 10 / `@eslint/js` 10 / `globals` 17, `uuid` 14, `firebase-tools` 15 (drops Java < 21 — CI uses Java 17). Remaining `npm audit` findings are transitive build-time deps awaiting upstream: `postcss` via `next`, `serialize-javascript` via `next-pwa`, nested `uuid` copies via Google's `gaxios`/`teeny-request`.

## 7. Small polish items

- `layout.js:4-9` sets `userScalable: false, maximumScale: 1` — blocks pinch-zoom, WCAG 1.4.4 violation; remove.
- Last lint warning (`ClientProviders.js:129`): copy `timeoutMapRef.current` to a local inside the effect before using it in cleanup.
- `.gitignore` typo: `.DS_Stored` → `.DS_Store`.
- `PublicFeed.js` regroups/re-sorts all messages every render with no `useMemo` and computes `unreadCount` by mutating `threadList` mid-render.
- Relative timestamps in `Chat.js` ("Just now", "5m ago") never refresh without a re-render; a slow interval tick would keep them honest.
- Five test files sit at `__tests__/` root outside the documented `unit/`/`integration/` split — confusing naming, they run in the unit suite.
- E2E send assertions can't detect server-side send failures: the sender-view check is satisfied by optimistic outbox rendering, and `messaging.spec.ts` wraps its cross-user delivery check in an `if (visible)` guard that silently skips on failure (found via PR #59's `aud`-mismatch investigation).
