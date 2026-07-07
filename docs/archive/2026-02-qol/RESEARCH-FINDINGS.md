# Research Findings: Audit of PLAN.md & PLAN-QOL.md vs Implementation

**Date:** 2026-02-16

---

## 1. Gaps Between Plan and Implementation

### 1.1 PLAN.md (PWA + Bug Inventory)

| # | Item | Status | Notes |
|---|------|--------|-------|
| manifest.json | COMPLETE | Exact match to plan |
| App icons (4 files) | COMPLETE | All present in `public/icons/` |
| layout.js metadata | COMPLETE | `metadata` export matches plan |
| next-pwa setup | COMPLETE | Two minor deviations (see below) |
| BUG-1 through BUG-12 | ALL FIXED | Plan said "document only, fix later" but all 12 bugs were resolved |

**next.config.js deviations (non-issues):**
- Uses `require('@ducanh2912/next-pwa').default(...)` instead of `.require(...)` -- this is actually a necessary correction for CJS/ESM interop.
- Adds `customWorkerSrc: 'worker'` option not in the plan -- harmless addition.

### 1.2 PLAN-QOL.md (4 QoL Features)

**Feature 1 -- Read Receipts:** COMPLETE. All components match:
- `lastReadClient.js` uses `serverTimestamp()`, null-safe normalization, optimistic cache
- `useOtherUserLastRead` hook in `useRealtimeMessages.js`
- Checkmarks in `Chat.js` with ISO string comparison
- `firestore.rules` lastRead cross-read rule with publicFeed exclusion

**Feature 2 -- In-App Sound:** COMPLETE with one deviation:
- Sound file is `notification.wav` instead of plan's `notification.mp3`. Internally consistent (component references `.wav`). Functional difference: none.

**Feature 3 -- Typing Indicator:** COMPLETE. All 5 cleanup paths wired (onChange, onBlur, submit, visibilitychange, unmount). Hook, library, and rules all match plan.

**Feature 4 -- Message Reactions:** COMPLETE. toggleReaction, ReactionPicker, ReactionChips, allReactions context listener, PublicFeed read-only chips, and Firestore rules all match plan.

**Missing items:**
| # | Missing Item | Severity |
|---|-------------|----------|
| 1 | `[ReadReceipt]` console.debug traces (P2-4 dev observability) -- present for Sound, Typing, and Reactions but NOT for Read Receipts | Low |
| 2 | Sound file format mismatch (`.wav` vs plan's `.mp3`) | Trivial |

**All planned test files are present:**
- 5 unit test files and 3 integration test files match the plan exactly.

---

## 2. Potential Bugs

### 2.1 Typing indicator debounce fires AFTER delay, not immediately then debounces

**File:** `src/lib/typing-client.js:32-46`

`setTyping()` wraps the Firestore write in a `setTimeout(fn, 2000)`. This means on first keystroke, there's a **2-second delay** before the typing indicator appears to the other user. Most chat apps fire immediately on first keystroke, then debounce subsequent writes. The current implementation is a trailing-edge-only debounce -- the other user sees nothing until the typist has been typing for 2 full seconds.

**Severity:** Low (UX polish, not broken)

### 2.2 `useTypingIndicator` always ticks at 1-second intervals

**File:** `src/hooks/useTypingIndicator.js:50-56`

The hook runs a `setInterval(setNowTick, 1000)` unconditionally -- even when the other user is not typing and the typing document doesn't exist. For 8 users this is negligible, but architecturally it's unnecessary work. The interval could start only when `typingAt !== null` and stop when it expires.

**Severity:** Negligible (8-user app)

### 2.3 `toggleReaction` has a TOCTOU race condition

**File:** `src/lib/reactions-client.js:25-40`

`toggleReaction()` does `getDoc()` then conditionally `setDoc()` or `deleteDoc()`. Between the check and the write, another client (or the same user on two tabs) could change the state. For 8 users this is unlikely to cause real issues, but a rapid double-tap could result in the reaction being added twice or not toggling correctly.

**Severity:** Low (unlikely with 8 users, but the pattern is inherently racy)

### 2.4 Read receipts show checkmarks for ALL messages when `otherLastReadAt` is set

**File:** `src/components/Chat.js:337`

```javascript
const isReadReceipt = Boolean(isMe && otherLastReadAt && msg.timestamp && otherLastReadAt >= msg.timestamp);
```

This is correct behavior by design (ISO string comparison), but worth noting: if User B has read any message from User A, ALL older messages will retroactively show `✓✓`. This is standard WhatsApp behavior, so not a bug -- just a design choice worth flagging.

### 2.5 `NotificationSoundRuntime` creates a new `Audio` object on every chime

**File:** `src/components/NotificationSoundRuntime.js:111`

```javascript
const audio = new Audio('/sounds/notification.wav');
```

Each chime creates a new `Audio` instance, re-fetching the sound file (though browser caching mitigates this). A pre-loaded `Audio` object stored in a ref would be more efficient and avoid potential mobile autoplay issues where the first play of a new Audio requires user gesture.

**Severity:** Low (browser cache handles the network concern; mobile autoplay policy may cause the first chime to silently fail until user interaction)

### 2.6 Reactions listener lacks error state exposure

**File:** `src/context/RealtimeMessagesContext.js:246-255`

The `allMessages` listener exposes `allMessagesError` to consumers (line 272). The `allReactions` listener logs the error and retries but doesn't expose an `allReactionsError` state. If the reactions listener fails permanently, consumers have no way to know or display an error.

**Severity:** Low (retry logic covers most cases)

### 2.7 Typing documents are never cleaned up server-side

**File:** `src/lib/typing-client.js`, `firestore.rules`

Typing documents are deleted client-side via `clearTyping()`, but if a user closes their browser/app abruptly (crash, force quit, network loss), the typing document persists in Firestore indefinitely. The `useTypingIndicator` hook's 5-second expiry hides stale indicators from the UI, but orphaned documents accumulate in the `typing` collection forever.

**Severity:** Low (documents are tiny; over years of seasonal use, a few dozen orphaned docs are negligible)

---

## 3. Dependency Vulnerabilities & Concerns

### 3.1 CRITICAL: `latest` tag on core dependencies

**File:** `package.json:24-26`

```json
"next": "latest",
"react": "latest",
"react-dom": "latest",
```

This is the most urgent finding. Using `latest` means:
- `npm install` on a different day can pull in a completely different major version
- CI builds are non-deterministic unless `npm ci` + committed lockfile is enforced
- A React or Next.js breaking change could silently break the app

Currently locked at Next.js 16.0.7 and React 19.2.0 via `package-lock.json`, but this is fragile.

**Recommendation:** Pin immediately to `"next": "^16.0.7"`, `"react": "^19.2.0"`, `"react-dom": "^19.2.0"`.

### 3.2 HIGH: `@ducanh2912/next-pwa` maintenance risk

**Version:** 10.2.9

This is a community fork of the abandoned `next-pwa`. Concerns:
- Single-maintainer package -- supply chain risk
- PWA plugins need frequent updates to track Next.js major versions
- Uses CJS `require()` which may conflict with future Next.js ESM-only moves

**Recommendation:** Monitor maintenance activity. Evaluate `@serwist/next` as an alternative.

### 3.3 MEDIUM: ts-jest version mismatch

**Installed:** `ts-jest@29.4.5` with `jest@30.2.0`

ts-jest 29.x is designed for Jest 29.x. Cross-major version usage is unsupported and could cause subtle test failures.

**Recommendation:** Upgrade to `ts-jest@30.x` or switch to Jest's native transform.

### 3.4 MEDIUM: No Node.js version enforcement

No `.nvmrc` file and no `engines` field in `package.json`. The dependency stack (Next.js 16, Jest 30, Firebase Admin 13) all require Node.js >= 18.18.0, but nothing prevents running on an older version.

**Recommendation:** Add `engines.node` to `package.json` and a `.nvmrc` file.

### 3.5 LOW: Deprecated transitive dependencies

Found in the dependency tree (all transitive, not direct):

| Package | Issue |
|---------|-------|
| `inflight@1.0.6` | Memory leak, no longer maintained |
| `glob@7.2.3` (x3) | Deprecated, known vulnerabilities |
| `node-domexception@1.0.0` | Deprecated, use native DOMException |
| `sourcemap-codec@1.4.8` | Deprecated, use `@jridgewell/sourcemap-codec` |
| `source-map@0.8.0-beta.0` | Beta version in prod tree |

These are all upstream transitive dependencies. They'll resolve when parent packages update.

### 3.6 LOW: Explicit webpack dev dependency may be unnecessary

**File:** `package.json:48` -- `"webpack": "^5.105.1"`

Next.js bundles its own webpack. The `"build": "next build --webpack"` script forces webpack over Turbopack, but this shouldn't require an explicit dependency.

### 3.7 INFO: Firestore broad read access

All `read` operations on `messages`, `typing`, and `reactions` are allowed for **any signed-in user** (`if isSignedIn()`). Any authenticated user can read all messages and reactions across all conversations. This is an intentional design choice for a trusted 8-user group (documented in PLAN-QOL.md as P2-6), but worth reiterating as it would be a vulnerability for broader use.

---

## Summary

| Category | Critical | High | Medium | Low | Trivial |
|----------|----------|------|--------|-----|---------|
| Plan gaps | 0 | 0 | 0 | 1 (missing ReadReceipt debug trace) | 1 (wav vs mp3) |
| Potential bugs | 0 | 0 | 0 | 5 (typing debounce UX, interval overhead, reaction TOCTOU, Audio re-creation, missing reactions error state) | 2 (orphaned typing docs, read receipt retro-marking) |
| Dependencies | 1 (`latest` tag) | 1 (next-pwa maintenance) | 2 (ts-jest mismatch, no Node version enforcement) | 2 (deprecated transitive deps, unnecessary webpack dep) | 0 |

**Overall assessment:** The implementation is highly faithful to both plans. The two plan deviations are trivial. The most actionable finding is the `latest` tag on core dependencies in `package.json`, which should be pinned immediately.
