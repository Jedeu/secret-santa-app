# Plan: Chat QoL Features (Reactions, Read Receipts, Typing Indicator, Sound)

## Context

The Secret Santa app has solid core messaging but lacks modern chat UX polish. Four user-facing improvements will bring it up to par with apps like iMessage/WhatsApp. With only 8 users, we can use simple Firestore patterns without worrying about scale.

## Review Decisions (resolved)

These were the key review findings that were accepted and are now reflected in the implementation sections below.

### P1 — Must fix before implementation

**[P1-1] Clock skew in read receipts.**  
Decision: write `lastReadAt` with Firestore `serverTimestamp()` and normalize to ISO string at the `lastReadClient.js` read boundary.

**[P1-2] `lastRead` visibility and public-feed leakage.**  
Decision: keep owner reads, and allow any signed-in user to read DM `lastRead` docs only; keep `publicFeed_*` owner-only.

**[P1-3] ID-to-payload integrity for new collections.**  
Decision: enforce deterministic ID checks in rules for both `typing` and `reactions`.

**[P1-4] Cross-user read for non-existent `lastRead` docs.**  
Decision: use path-based `lastReadId` checks (not `resource.data`) so reads work before first write.

**[P1-5] Message timestamp type mismatch.**  
Decision: keep message timestamps as ISO strings; read-receipt comparison uses ISO string ordering (`otherLastReadAt >= msg.timestamp`), not `.toMillis()`.

**[P1-6] Backward compatibility for `lastRead` consumers.**  
Decision: all downstream consumers remain unchanged by normalizing `lastReadAt` to ISO string in `lastReadClient.js`.

**[P1-7] Pending `serverTimestamp()` null handling.**  
Decision: null-safe normalization must never overwrite cache with `null`; fallback to cached value or epoch.

**[P1-8] Chime scope correctness.**  
Decision: trigger chime only for newly arrived messages addressed to `currentUserId`.

### P2 — Should fix

**[P2-1] Chime dependency on push subscription.**  
Decision: decouple sound from push and drive it from `allMessages` updates.

**[P2-2] Audio rejection and burst deduplication.**  
Decision: `audio.play().catch(() => {})` with 1s suppression window.

**[P2-3] Typing cleanup completeness.**  
Decision: clear typing on submit, blur, empty input, visibility hidden, and unmount.

**[P2-4] Dev observability.**  
Decision: add dev-only `console.debug` traces for receipt, typing, reaction, and sound events.

**[P2-5] Initial snapshot false-positive chimes.**  
Decision: use `allMessagesLoading` transition as hydration baseline before enabling chime logic.

**[P2-6] Participant-scoped vs app-scoped DM `lastRead` reads.**  
Decision: intentionally app-scoped (any signed-in user) for this private 8-user app.

**[P2-7] Typing payload hardening.**  
Decision: add `hasOnly(['userId', 'conversationId', 'typingAt'])` in typing rules.

### P3 — Nice to have

**[P3-1] Feature-specific tests.**  
Decision: add new unit/integration coverage listed in Verification.

**[P3-2] Terminology consistency.**  
Decision: use "ISO string comparison" wording consistently across the document.

---

## Features Overview

| # | Feature | Effort | Key Files |
|---|---------|--------|-----------|
| 1 | Read Receipts | Small | Chat.js, firestore.rules, lastReadClient.js |
| 2 | In-App Sound | Small | NotificationSoundRuntime.js (new), page.js |
| 3 | Typing Indicator | Medium | Chat.js, firestore.rules, new hook + lib |
| 4 | Message Reactions | Medium-Large | Chat.js, PublicFeed.js, firestore.rules, new components + lib |

---

## Feature 1: Read Receipts (Delivery Checkmarks)

**Goal:** Show WhatsApp-style checkmarks on sent messages: `✓` = delivered, `✓✓` = read.

### Data Model
No new collections. Uses existing `lastRead` collection. The key change: User A needs to **read** User B's lastRead document to know if B read A's messages.

### Security Rule Change (amended per P1-2, P1-4, P2-6)
`firestore.rules` — relaxation of `lastRead` read rule. Allow any signed-in user to read DM lastRead docs, but NOT `publicFeed_*` docs. Uses a **path-based check** (doc ID pattern) instead of `resource.data` so it works even before the document exists (critical for initial read-receipt listeners). Note: this is intentionally broader than strict participant-scoping — for an 8-user private app, all signed-in users are trusted. The only sensitive data protected is publicFeed view timestamps (which stay owner-only).

```
// BEFORE:
match /lastRead/{lastReadId} {
  allow read: if isAllowedLastReadRead(lastReadId);

// AFTER:
match /lastRead/{lastReadId} {
  // Owner can read their own docs via isAllowedLastReadRead.
  // Any signed-in user can read DM lastRead docs (needed for read receipts).
  // Path-based check: works even for non-existent docs (before first write).
  // publicFeed_* docs stay owner-only to avoid leaking view timestamps.
  allow read: if isAllowedLastReadRead(lastReadId)
    || (isSignedIn() && lastReadId.matches('^[^_]+_.+$')
        && !lastReadId.matches('^[^_]+_publicFeed_.*$'));
```

### Timestamp Fix (amended per P1-1, P1-5, P1-6, P1-7)
Change `lastReadClient.js` to write Firestore `serverTimestamp()` but **normalize back to ISO strings at the read boundary**, so all downstream consumers are unaffected:
- Import `serverTimestamp` from `firebase/firestore`
- `updateLastReadTimestamp()`: write `lastReadAt: serverTimestamp()` instead of `new Date().toISOString()`
- `flushPendingWrites()`: same — use `serverTimestamp()` in the `setDoc` call
- Optimistic cache: still stores `new Date().toISOString()` (best local approximation; overwritten when the server-resolved value arrives via the listener)
- `subscribeToLastRead` callback: convert Firestore Timestamp to ISO string before caching/returning, with **null-safe guard** (P1-7) to prevent `serverTimestamp()` pending writes from clobbering the cache:
  ```javascript
  const raw = snapshot.data()?.lastReadAt;
  const fallback = lastReadCache.get(key) || new Date(0).toISOString();
  const normalized = raw?.toDate
    ? raw.toDate().toISOString()
    : (typeof raw === 'string' && raw ? raw : fallback);
  // Never store null/undefined in cache
  lastReadCache.set(key, normalized);
  callback(normalized);
  ```
- `getLastReadTimestamp`: same null-safe conversion on the `snapshot.data().lastReadAt` read path
- `getCachedTimestamp()` continues returning ISO strings — **zero changes** to `useRealtimeUnreadCounts`, `PublicFeed`, or any other consumer
- Firestore rule for `lastReadAt`: update to accept `timestamp` type instead of `string` (the stored value is now a Firestore Timestamp)
- **Why not change message timestamps too?** `route.js:228` writes `timestamp: new Date().toISOString()` and all existing code (formatRelativeTime, unread counts, PublicFeed grouping, outbox) treats it as a string. Migrating message timestamps is out of scope and high-risk for zero benefit — read receipts only need lastRead to be authoritative, not messages.

### New Hook: `useOtherUserLastRead` in `src/hooks/useRealtimeMessages.js`
Subscribe to the other user's lastRead document for the current conversation. Uses existing `subscribeToLastRead` from `lastReadClient.js`.

```javascript
export function useOtherUserLastRead(otherUserId, conversationId) → string|null  // ISO 8601 string (normalized from Firestore Timestamp at read boundary)
```

### UI Changes (amended per P1-4): `src/components/Chat.js`
- After the timestamp span (line 312-321), add a checkmark indicator for sent messages
- Logic: if message is in Firestore (not outbox) and `fromId === currentUser.id`:
  - `otherLastReadAt >= msg.timestamp` → blue `✓✓` ("Read") — pure ISO string comparison (lexicographically sortable)
  - Otherwise → gray `✓` ("Delivered")
- Outbox/pending messages show no checkmarks (they already show "Sending...")
- Style: `fontSize: '10px'`, inline after timestamp, blue (`var(--accent)`) for read, muted for delivered

---

## Feature 2: In-App Notification Sound (Mobile/PWA Only)

**Goal:** Play a subtle chime when a new message arrives while the app is open **on mobile (PWA standalone mode only)** — not on the website in a browser tab. Mute toggle saved to localStorage.

### Standalone Detection
Reuse the existing `detectStandaloneMode()` pattern from `src/components/PushNotificationsControl.js` (line 18-25):
```javascript
window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true
```
Extract this into a shared utility or duplicate inline. Sound only plays when `isStandalone === true`.

### Sound File
Add a small notification sound: `public/sounds/notification.mp3` (a short, pleasant chime ~0.5s). We'll generate or source a small royalty-free sound.

### Mute Toggle State: `src/app/page.js`
- Add state: `const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('soundEnabled') !== 'false')`
- Pass `soundEnabled` and `setSoundEnabled` as props to the relevant components
- Default: **enabled** (sound on)
- Only render the toggle in mobile header (not desktop sidebar) since it's a mobile-only feature

### Mute Toggle UI: `src/app/page.js`
- Small speaker icon button in the **mobile header only** (next to push toggle)
- Toggles between speaker-on / speaker-off icon
- Updates localStorage on toggle
- Hidden on desktop (not applicable since sound is PWA-only)

### Sound Playback (amended per P2-1, P2-2, P2-5, P1-6): New `src/components/NotificationSoundRuntime.js`
**Decoupled from push.** Instead of hooking into `PushNotificationsRuntime.js`, create a new component that:
- Props: `soundEnabled`, `currentUserId`
- Subscribes to `allMessages` from `RealtimeMessagesContext`
- **Initial hydration guard (P2-5):** Also subscribes to `allMessagesLoading` from context. Uses `isHydratedRef = useRef(false)`. When `allMessagesLoading` transitions from `true` to `false` (first snapshot complete — whether empty or not), sets `prevMessagesRef.current = allMessages` and flips `isHydratedRef.current = true` without playing a chime. This correctly handles both "app has existing messages" and "app has zero messages" — in both cases, the first snapshot is treated as baseline, not as new activity.
- **Recipient filter (P1-6):** On subsequent updates, diffs `allMessages` against `prevMessagesRef.current` to find new messages. Only triggers chime if `newMsgs.some(m => m.toId === currentUserId && m.fromId !== currentUserId)`. This prevents chimes for messages between other users.
- Chime gated on: recipient-filtered new messages exist AND `soundEnabled` AND `isStandalone` AND `document.visibilityState === 'visible'`
- Audio error handling: `audio.play().catch(() => {})` (silent fail)
- Dedup: tracks `lastChimeTimeRef`, suppresses chimes within 1s of each other
- Mounted in `page.js` alongside other runtime components

---

## Feature 3: Typing Indicator

**Goal:** Show "[Name] is typing..." or "Santa is typing..." in the chat header area. Works in both Recipient and Santa chats.

### Data Model: New `typing` collection
Ephemeral documents that auto-expire client-side.

```
Document ID: `${conversationId}_${userId}`
Fields: {
  userId: string,
  conversationId: string,
  typingAt: string  // ISO 8601 timestamp
}
```

### Security Rules (amended per P1-3, P2-7): `firestore.rules`
```
match /typing/{typingId} {
  allow read: if isSignedIn();
  allow create, update: if isSignedIn()
    && request.resource.data.keys().hasOnly(['userId', 'conversationId', 'typingAt'])
    && request.resource.data.userId is string
    && request.resource.data.conversationId is string
    && request.resource.data.typingAt is string
    && authMatchesUser(request.resource.data.userId)
    && typingId == (request.resource.data.conversationId + '_' + request.resource.data.userId);
  allow delete: if isSignedIn()
    && resource.data.userId is string
    && authMatchesUser(resource.data.userId);
}
```

### New Library: `src/lib/typing-client.js`
```javascript
// Write typing status (debounced — max 1 write per 2s)
export function setTyping(userId, conversationId) → void

// Clear typing status (delete document)
export function clearTyping(userId, conversationId) → void
```
- Uses client SDK (`firebase-client.js`) with `setDoc` / `deleteDoc`
- Debounced: only writes to Firestore every 2 seconds while user is actively typing
- Does NOT need its own listener — the hook handles that

### New Hook: `src/hooks/useTypingIndicator.js`
```javascript
export function useTypingIndicator(conversationId, otherUserId) → boolean
```
- Creates an `onSnapshot` listener on `doc(firestore, 'typing', ${conversationId}_${otherUserId})`
- Returns `true` if document exists AND `typingAt` is within the last 5 seconds
- Uses a 5-second interval timer to auto-expire stale typing indicators
- Cleanup: unsubscribes on unmount

### UI Changes (amended per P2-3): `src/components/Chat.js`
- Import `setTyping`, `clearTyping` from typing-client
- On input `onChange`: call `setTyping(currentUser.id, conversationId)` (internally debounced). If input value is empty, call `clearTyping` instead.
- On form submit (sendMessage): call `clearTyping(currentUser.id, conversationId)`
- On input `onBlur`: call `clearTyping(currentUser.id, conversationId)`
- On `document.visibilitychange` → hidden: call `clearTyping` (via useEffect listener)
- On unmount: call `clearTyping` in cleanup
- Import `useTypingIndicator` hook
- Below the chat header (line 252), show a small animated "typing..." indicator when `isOtherTyping` is true:
  ```
  {isOtherTyping && (
    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '4px 0' }}>
      {isSantaChat ? 'Santa' : otherUser.name} is typing...
    </div>
  )}
  ```

---

## Feature 4: Message Reactions

**Goal:** Users can add emoji reactions to any message. Click a message to open a quick reaction picker (6 common emojis). Reactions show as chips below the bubble.

### Data Model: New `reactions` collection
```
Document ID: `${messageId}_${userId}_${emoji}`
Fields: {
  messageId: string,
  userId: string,
  emoji: string,       // e.g. "👍"
  createdAt: string    // ISO 8601
}
```
The deterministic doc ID prevents duplicate reactions and makes toggle trivial (create/delete).

### Security Rules (amended per P1-3): `firestore.rules`
```
match /reactions/{reactionId} {
  allow read: if isSignedIn();
  allow create: if isSignedIn()
    && request.resource.data.keys().hasOnly(['messageId', 'userId', 'emoji', 'createdAt'])
    && request.resource.data.messageId is string
    && request.resource.data.userId is string
    && request.resource.data.emoji is string
    && request.resource.data.emoji.size() <= 4
    && request.resource.data.createdAt is string
    && authMatchesUser(request.resource.data.userId)
    && reactionId == (request.resource.data.messageId + '_' + request.resource.data.userId + '_' + request.resource.data.emoji)
    && exists(/databases/$(database)/documents/messages/$(request.resource.data.messageId));
  allow delete: if isSignedIn()
    && resource.data.userId is string
    && authMatchesUser(resource.data.userId);
  allow update: if false;
}
```

### New Library: `src/lib/reactions-client.js`
```javascript
export async function toggleReaction(messageId, userId, emoji) → { action: 'added'|'removed' }
```
- Uses `getDoc` to check existence, then `setDoc` or `deleteDoc`
- Imports from `firebase-client.js` (client SDK)

### Real-Time Reactions: Extend `src/context/RealtimeMessagesContext.js`
Add a second singleton listener on the `reactions` collection (same pattern as `allMessages`):
- New state: `allReactions` (array of reaction docs)
- New ref: `reactionsListenerRef`, `reactionsListenerCreatedRef`
- Exposed in context value as `allReactions`
- Same StrictMode protection, auth gating, and cleanup pattern

### New Component: `src/components/ReactionPicker.js`
Quick-select bar with 6 emojis:
```javascript
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎄'];
```
- Small floating bar positioned near the clicked message
- Dark background (`var(--surface-highlight)`), rounded, subtle shadow
- Dismiss on selection or click outside
- Calls `onSelect(emoji)` callback

### New Component: `src/components/ReactionChips.js`
Shared component for displaying reactions below a message:
```javascript
export default function ReactionChips({ messageId, allReactions, currentUserId, onToggle })
```
- Groups reactions by emoji, counts users per emoji
- Each chip: emoji + count, highlighted border if current user reacted
- Clicking a chip calls `onToggle(emoji)` (toggles reaction)
- `onToggle` is null in PublicFeed (read-only display)

### UI Changes: `src/components/Chat.js`
- Add state: `reactionPickerMessageId` to track which message has picker open
- On message bubble click/tap: show `ReactionPicker` positioned near that bubble
- Below each message bubble: render `ReactionChips` with reactions for that message
- Get `allReactions` from `useRealtimeMessagesContext()`
- Helper function to aggregate reactions per message from the flat array

### UI Changes: `src/components/PublicFeed.js`
- In thread view (line 354-368), render `ReactionChips` below each message
- Read-only: `onToggle={null}` (no reaction picker in public feed)
- Get `allReactions` from context

---

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `src/lib/typing-client.js` | Debounced typing status writes/clears |
| `src/lib/reactions-client.js` | Toggle reaction (create/delete) |
| `src/hooks/useTypingIndicator.js` | Real-time typing status subscription |
| `src/components/ReactionPicker.js` | 6-emoji quick reaction bar |
| `src/components/ReactionChips.js` | Shared reaction display chips |
| `src/components/NotificationSoundRuntime.js` | Chime playback (decoupled from push, uses allMessages listener) |
| `public/sounds/notification.mp3` | Notification chime sound file |

### Modified Files
| File | Changes |
|------|---------|
| `firestore.rules` | Scoped lastRead read rule (DM only, not publicFeed_*); add `typing` and `reactions` rules with ID integrity checks |
| `src/lib/lastReadClient.js` | Write Firestore `serverTimestamp()`, normalize to ISO string at read boundary (subscribe/get). All consumers unchanged. |
| `src/hooks/useRealtimeMessages.js` | Add `useOtherUserLastRead` hook (returns ISO string, normalized at lastReadClient boundary) |
| `src/context/RealtimeMessagesContext.js` | Add `allReactions` singleton listener to context |
| `src/components/Chat.js` | Read receipt checkmarks (ISO string comparison), typing indicator (with blur/visibility cleanup), reaction picker + chips |
| `src/components/PublicFeed.js` | Add reaction chips display (read-only) in thread view |
| `src/app/page.js` | Add sound mute toggle state + UI button (mobile header only); mount NotificationSoundRuntime |

---

## Implementation Order

1. **Read Receipts** — smallest scope, validates lastRead rule change
2. **In-App Sound** — independent, quick win
3. **Typing Indicator** — new collection + hook + UI, medium complexity
4. **Message Reactions** — largest scope, builds on patterns from earlier features

---

## Verification

### Automated Tests (amended per P3-1)

**Existing tests (must not regress):**
```bash
npm test
npx jest __tests__/unit/PublicFeed_grouping.test.js
npx jest __tests__/unit/unread_counts_client_filter.test.js
```

**New unit tests to add:**
| Test File | Coverage |
|-----------|----------|
| `__tests__/unit/typing-client.test.js` | Debounce: only 1 write per 2s; clearTyping deletes doc; mock timers |
| `__tests__/unit/reactions-client.test.js` | toggleReaction: creates on first call, deletes on second; deterministic doc ID |
| `__tests__/unit/read-receipts.test.js` | Checkmark rendering: `✓` when no lastRead, `✓✓` when lastRead >= msg timestamp (ISO string comparison), no checkmark for outbox messages |
| `__tests__/unit/lastReadClient-normalization.test.js` | Boundary normalization: Firestore Timestamp → ISO string on subscribe; legacy string passthrough; optimistic cache write as ISO string |
| `__tests__/unit/NotificationSoundRuntime.test.js` | Chime plays on new message for current user; suppressed when muted/not standalone/not visible; dedup within 1s; no chime on initial hydration; no chime for messages to other users |

**New integration tests (with emulators):**
| Test File | Coverage |
|-----------|----------|
| `__tests__/integration/firestore-rules-typing.test.js` | Typing rules: create with matching ID succeeds, mismatched ID rejected, cross-user read allowed, cross-user write rejected |
| `__tests__/integration/firestore-rules-reactions.test.js` | Reaction rules: create with valid message ref succeeds, mismatched ID rejected, delete own reaction allowed, delete other's rejected, update always rejected |
| `__tests__/integration/firestore-rules-lastRead.test.js` | Scoped read: own doc readable, other user's DM doc readable, other user's publicFeed_* doc NOT readable |

```bash
# Run new integration tests
npm run emulators  # separate terminal
npm test:integration
```

### Manual Tests
1. **Read Receipts**: Send message from User A → see `✓` → open as User B → see `✓✓` on User A's screen
2. **Sound**: Open app as PWA → receive message → hear chime → toggle mute → no chime → open in browser tab → no chime (not standalone)
3. **Typing**: Type in chat → other user sees "typing..." → stop typing → indicator disappears after 5s → blur input → indicator clears immediately → switch tabs → indicator clears
4. **Reactions**: Click message → pick emoji → chip appears → click chip again → reaction removed → check PublicFeed shows chips (read-only)

### Dev Observability (amended per P2-4)
In dev mode (`NODE_ENV=development`), console logs for:
- `[ReadReceipt] status=read/delivered msgId=... otherLastRead=...`
- `[Typing] set/clear userId=... convId=...`
- `[Reaction] added/removed msgId=... emoji=...`
- `[Sound] played/suppressed reason=...`
