# Plan 2: UX Correctness Fixes (Backlog §2, audit item 4)

## Goal

Stop background tabs from falsely marking messages read, and make the typing indicator fire *while* the sender types instead of after they stop.

## Item A: Visibility-gate mark-as-read

### Ground Truth

- `src/components/Chat.js:94-99`: effect calls `updateLastReadTimestamp(...)` on every `messages` change with no visibility check.
- Two more ungated call sites in the same file: `checkIfRead()` (scroll handler, `Chat.js:111-125`) and the fits-in-viewport effect (`Chat.js:127-140`). The scroll handler is implicitly safe (no scrolling happens in a hidden tab) but the viewport effect fires on `messages` changes just like the first one.
- The correct gate already exists at `src/components/NotificationSoundRuntime.js:93`:
  `if (typeof document !== 'undefined' && document.visibilityState !== 'visible')`.

### Proposed Changes (`src/components/Chat.js`)

1. Extract a small helper `isDocumentVisible()` (same check as NotificationSoundRuntime).
2. Guard the mount/messages effect (line 94) and the fits-in-viewport effect (line 127): return early when not visible.
3. Add a `visibilitychange` listener effect: when the document becomes visible *and* the chat is mounted, call `updateLastReadTimestamp` (and update `lastReadRef`). Without this, messages that arrived while hidden would never be marked read until the next `messages` change.

### Tests

- Update/extend `__tests__/unit/Chat_unread.test.js` and `__tests__/unit/read-receipts.test.js`:
  - hidden document + new message ⇒ `updateLastReadTimestamp` NOT called;
  - document becomes visible ⇒ called once.
  - Use the same `document.visibilityState` mocking pattern as `__tests__/unit/NotificationSoundRuntime.test.js`.
- Check `__tests__/unit/unread_badge_clearing.test.js` still passes (badge clears on visible-tab arrival).

## Item B: Typing indicator debounce → throttle

### Ground Truth

- `src/lib/typing-client.js:21-49`: `setTyping` clears and re-arms a 2 s timer per call, so continuous typing produces zero writes until the user pauses — the indicator appears after they *stop*.
- `__tests__/unit/typing-client.test.js:34-50` enshrines this ("debounces typing writes to one write per 2 seconds", asserts `mockSetDoc` not called before the 2 s elapse).

### Proposed Changes (`src/lib/typing-client.js`)

Replace debounce with leading-edge throttle, per key:

- Track `lastWriteAt` in a `Map` alongside the pending-timeout map.
- `setTyping`: if `Date.now() - lastWriteAt >= TYPING_THROTTLE_MS` (keep 2000), write immediately and record `lastWriteAt`. Otherwise, if no trailing timeout is pending, schedule one for `lastWriteAt + TYPING_THROTTLE_MS` (keeps the doc's `typingAt` fresh during long typing runs); if one is already pending, do nothing.
- `clearTyping`: unchanged behavior — cancel pending timeout, clear `lastWriteAt` for the key, delete the doc.
- Net Firestore cost is unchanged: still ≤ 1 write per 2 s per conversation.

### Tests (`__tests__/unit/typing-client.test.js`)

- Rewrite test 1: first `setTyping` ⇒ `setDoc` called immediately (times = 1); rapid subsequent calls within 2 s ⇒ still 1; `advanceTimersByTime(2000)` ⇒ trailing write brings it to 2.
- Keep tests 2–3 (clearTyping cancels pending + deletes doc) — verify they pass with the new lastWriteAt reset.

## Verification

```
npx jest __tests__/unit/typing-client.test.js __tests__/unit/Chat_unread.test.js __tests__/unit/read-receipts.test.js __tests__/unit/unread_badge_clearing.test.js --runInBand
npm test
```
Manual smoke (optional): two browser profiles against emulators; background one tab, send from the other, confirm badge persists until the tab is foregrounded; confirm "is typing…" appears within ~0 s of typing starting.

## Risks

- The visibilitychange listener must not double-fire with the messages effect (both update `lastReadRef`; the existing 2 s debounce on the scroll path already tolerates this — writes are idempotent setDocs).
- jsdom defaults `visibilityState` to `'visible'`; existing tests keep passing without changes unless they assert call counts strictly.
