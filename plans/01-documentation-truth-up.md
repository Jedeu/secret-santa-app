# Plan 1: Documentation Truth-Up (Backlog §1, audit item 3)

## Goal

Make CLAUDE.md match the real code, remove/archive stale workflow artifacts, and add a human-facing README.md.

## Ground Truth (verified July 2026)

- **Real message schema** (`src/app/api/messages/send/route.js:223-232`):
  `{ id, fromId, toId, content, timestamp (ISO string), conversationId, clientMessageId?, clientCreatedAt? }`.
  Firestore rules additionally allow legacy fields `isSantaMsg`, `fromName`, `toName` on create. There is no `senderId`/`recipientId`/`message`/`isSantaAnonymous`/`read`, and no Firestore Timestamp type on messages.
- **`getConversationId(santaId, recipientId)`** (`src/lib/message-utils.js:10-13`) returns directional `santa_{santaId}_recipient_{recipientId}` — not a hash. Legacy format is sorted-join (`getLegacyConversationId`). `filterMessages(messages, currentUserId, otherUserId, targetConversationId)` is the real signature.
- **Real API routes** (9, not 4): `/api/init`, `/api/admin/assign`, `/api/admin/reset`, `/api/dev/assign`, `/api/dev/inject-message`, `/api/dev/seed`, `/api/messages/send`, `/api/push/register`, `/api/push/unregister`.
- **Firestore rules are hardened**, not "minimal": per-collection field allowlists, sender-identity checks on message create, lastRead ownership + read-receipt carve-out, typing/reactions validation, `allow delete: if false` everywhere.
- **Additional collections** undocumented in CLAUDE.md: `lastRead`, `typing`, `reactions`, push token storage (see `src/lib/push-server.js`).
- **Stale artifacts**: `PLAN-QOL.md`, `RESEARCH-FINDINGS.md` (both untracked, root, describe completed February work); `PROGRESS.md` and `PLAN.md` (tracked, describe the completed QoL/PWA effort).

## Proposed Changes

1. **`CLAUDE.md` — rewrite these sections against code:**
   - *Message Architecture*: correct field names (`fromId`/`toId`/`content`), ISO-string timestamps, directional conversationId format, legacy sorted-join format and the dual-routing logic, `filterMessages` signature.
   - *Data Model*: correct `messages` schema; add `lastRead`, `typing`, `reactions` collections.
   - *API Routes*: full list of 9 routes with one-line descriptions and auth requirements (Bearer ID token; admin check via `isAdmin()` in `src/lib/config.js` — no longer "hardcoded in multiple places").
   - *Important Notes*: replace "Firestore rules are minimal" with a summary of the hardened rules; keep the anonymity trade-off note (coordinate with Plan 4 item 4, which documents the trust model — do it once, here).
2. **Archive stale artifacts**: create `docs/archive/2026-02-qol/` and move `PLAN-QOL.md`, `RESEARCH-FINDINGS.md`, `PROGRESS.md`, `PLAN.md` into it (tracked files via `git mv`). Alternative: delete outright — git history preserves the tracked ones, but the two untracked files would be lost, so archiving is the safe default.
3. **Add `README.md`**: project purpose, tech stack, prerequisites (Node 20, Java for emulators), setup (`npm ci`, `npm run emulators`, `npm run dev`), test commands, deploy notes (env vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_FIREBASE_*`). Point contributors at CLAUDE.md for architecture depth — don't duplicate it.

## Verification

- `npm test` (unit suite) — `layout_metadata.test.js`, `package_scripts_build.test.js` guard files the archive move must not touch.
- Manual: grep CLAUDE.md for `senderId`, `isSantaAnonymous`, `hash of two user IDs`, `rules are minimal` — all should be gone.
- `git status` clean of root-level workflow artifacts.

## Risks / Notes

- Zero runtime risk; docs and file moves only.
- CLAUDE.md's own "Workflows & Guidelines" / RPI section references PLAN.md/PROGRESS.md as *conventions* — keep those references (they describe future planning files, not the archived ones).
