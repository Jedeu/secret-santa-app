# Codebase bug sweep

Date: 2026-11-09 · Reviewed revision: `2275491` plus the existing working tree

## Summary

**22 bugs: 6 high, 15 medium, 1 low priority.** One additional credential-dependent risk needs confirmation.

A read-only agent performed the sweep using **`openai-codex/gpt-6.1-sol`, reasoning `high`**, confirmed from CLI response metadata. The primary reviewed its findings and performed the checks below. No application code was changed; existing user changes were left alone.

Prioritize participant authorization, message loss, account-switch delivery, assignment integrity, push initialization, and duplicate profiles before lower-priority UI defects.

### Verification and confidence

- **Existing unit suite:** `npm run test:unit -- --runInBand` — **39 suites, 184 tests passed** on Node **22.15.0**.
- **Lint:** `npm run lint` — **passed, exit 0**.
- **Firestore probes:** isolated, primary-started emulator using project `demo-bug-sweep`. Confirmed outsider reads/profile creation, one-sided assignments, unrelated profile mutation, and forged conversation metadata. Emulator shut down afterward.
- **Isolated source probes:** confirmed queue overwrite, wrong-account token use, incomplete Messaging configuration, duplicate initialization, stale auth completion, push ownership/opt-out defects, legacy routing/count discrepancies, sound initialization, and duplicate notification display paths. These used synthetic state and mocked boundaries, not production services.
- **React reproduction:** a temporary Jest test using the actual `ChatTabs` and `Chat` components confirmed draft carryover and delivery to the newly selected chat.
- **Not run:** production build, full integration suite, E2E/browser suites, actual FCM delivery, or deployed-system checks. Source-validated findings below are not claims of production reproduction.

The passing suites do not cover the reported concurrency and cross-account cases. All line references below refer to the reviewed source.

## High priority

### 1. Nonparticipants can bypass the UI authorization gate

**Files:** `firestore.rules:4–5,22–29,55–58,77–79`; `src/app/api/messages/send/route.js:201–215`

- **Trigger / actual:** Sign in with a nonparticipant account, then access Firestore directly despite the Access Denied screen. Rules permit reading users/messages and creating a profile whose email matches the token. That profile subsequently satisfies the send API's sender lookup.
- **Expected / impact:** Only admitted participants should access application data or join messaging and assignments. Currently, an authenticated outsider can do both.
- **Evidence:** **Emulator-reproduced.** `isSignedIn()` checks authentication only; profile creation does not enforce participant membership.
- **Fix direction:** Enforce authoritative admission in rules and server operations, not only `useUser`.

This is distinct from the documented social-anonymity model: it admits outsiders, not merely curious participants.

### 2. Completing one send can silently delete a newer queued message

**File:** `src/lib/message-outbox.js:293–295,325–353,383–390`

- **Trigger / actual:** Send A over a slow connection; enqueue B before A finishes. A's completion writes its stale pre-request queue snapshot over storage, deleting B. Failure/retry paths can overwrite newer queue changes too.
- **Expected / impact:** B must remain queued. Instead, it can disappear permanently without ever reaching the server.
- **Evidence:** **Isolated reproduction:** two queued items before A's response, zero afterward; B should have remained.
- **Fix direction:** Apply updates against current storage state; coordinate concurrent and cross-tab queue mutations.

### 3. An old account's queued content can send as the new account

**Files:** `src/lib/message-outbox.js:130–150,285–295,325–343,359–368`; `src/components/MessageOutboxRuntime.js:32–37`

- **Trigger / actual:** Start draining A's queue, then switch to B during an awaited request. Subsequent sends obtain B's token from `clientAuth.currentUser`, while still processing A's stored messages. Removing runtime event listeners does not cancel an active drain.
- **Expected / impact:** A's delivery must stop on an identity change. Instead, private queued content can be attributed to B and carry A's conversation metadata.
- **Evidence:** **Isolated reproduction:** an item owned by A was submitted with B's Bearer token.
- **Fix direction:** Bind queued items/drains to authenticated ownership, invalidate drains on auth changes, and recheck identity after awaits and before retries.

### 4. Assignment rules permit one-sided claims and profile tampering

**File:** `firestore.rules:32–59`

- **Trigger / actual:** A directly sets B's `gifterId` to A without updating A's recipient. A can repeat this for other unclaimed users. Conversely, A can select C without updating C. A claim update can also change B's name or add unrelated fields.
- **Expected / impact:** Assignments must remain reciprocal and exclusive, with tightly scoped changes. Current rules allow inconsistent pairings, reserving multiple recipients, and modifying another participant's profile.
- **Evidence:** **Emulator-reproduced:** one-sided writes, a changed target name, and an unexpected field were accepted. Rules check pre-write documents, not reciprocal post-write state, and lack an update-field restriction.
- **Fix direction:** Enforce reciprocal post-write invariants and exact changed-field allowlists. The UI transaction alone is insufficient.

### 5. Browser Firebase configuration cannot initialize Messaging

**Files:** `src/lib/firebase-client.js:12–17,27–31`; `src/lib/push-client.js:33–41`; `src/components/PushNotificationsRuntime.js:18–22`

- **Trigger / actual:** Configure the documented push environment variables and open a supported browser. The initialized Firebase app still omits `appId` and `messagingSenderId`; `getMessaging(apps[0])` requires them.
- **Expected / impact:** Push should initialize. Registration instead fails, and the uncaught synchronous foreground-listener initialization can also break the signed-in React tree.
- **Evidence:** **Source/installed-SDK reproduction:** with all relevant synthetic environment values present, the resulting app had only three configuration keys; the installed Messaging validator threw `missing-app-config-values: appId`.
- **Fix direction:** Include the required Messaging configuration and contain initialization failures.

### 6. First sign-in can create duplicate participant profiles

**Files:** `src/hooks/useUser.js:50–75`; `src/app/page.js:30`; `src/context/RealtimeMessagesContext.js:95`; `src/lib/firestore.js:76–91`

- **Trigger / actual:** An allowed participant signs in before being seeded. Home and the provider independently call `useUser`; both can observe an empty email query and create different UUID documents. Concurrent `ensureAllParticipants` calls have the same query-then-create race.
- **Expected / impact:** One participant needs one stable profile. Duplicate profiles split assignment state and make API sender lookup disagree with the UI.
- **Evidence:** **Isolated reproduction:** two hook instances created two documents for one synthetic identity.
- **Fix direction:** Share authentication state and enforce atomic identity-to-profile uniqueness, while preserving the UUID-based user model.

## Medium priority

### 7. An old profile fetch can restore a signed-out user

**File:** `src/hooks/useUser.js:50–58,113–124`

- **Trigger / actual:** Delay A's profile lookup, sign out or switch accounts, then resolve the old lookup. Its unconditional state updates restore A or overwrite the new user.
- **Expected / impact:** Auth transitions must invalidate stale requests. Otherwise, UI identity, assignments, and listeners can reference the wrong account.
- **Evidence:** **Isolated reproduction:** A's profile became user state after the sign-out callback cleared it.
- **Fix direction:** Use an auth-generation/current-identity check around asynchronous work and clear stale state on transitions.

### 8. Admin reset strands other signed-in clients on deleted UUIDs

**Files:** `src/hooks/useUser.js:142–158`; `src/app/api/admin/reset/route.js:28–32`; `src/lib/firestore.js:101–115`

- **Trigger / actual:** Keep another participant's browser open while the admin resets. Reset recreates profiles with new UUIDs, but the other browser's listener ignores deletion of its original profile.
- **Expected / impact:** Open clients should recover to the new profile. Instead, stale IDs and assignments remain, breaking chat destinations and assignment updates until reload.
- **Evidence:** **Source-validated:** the listener handles only existing documents; only the initiating UI requests a refresh.
- **Fix direction:** Detect deletion/reset completion and safely re-resolve the current participant's profile.

### 9. Message conversation metadata is not validated

**Files:** `src/app/api/messages/send/route.js:180–182,215–229`; `firestore.rules:63–79`

- **Trigger / actual:** Submit a message from A to B with a conversation ID for another pair or false role relationship. The API accepts arbitrary routing strings; direct-write rules also permit mismatched metadata.
- **Expected / impact:** Routing must match endpoints and valid assignments. Otherwise, a successful send can disappear from its intended DM, pollute an unrelated feed thread, or imply a false Santa role.
- **Evidence:** **Emulator-reproduced for direct writes; source-validated API path.** The relevant checks establish sender identity and recipient existence, not routing integrity.
- **Fix direction:** Derive or validate directional routing from authoritative assignments, including direct-write compatibility rules.

### 10. Push-token ownership does not follow account changes

**Files:** `src/lib/push-client.js:17–29,149–181`; `src/lib/push-server.js:71–79`

- **Trigger / actual:** Register as A, then sign in as B in the same browser. The device token is unchanged, so synchronization skips registering it for B. The same cache prevents recovery after server registration deletion/reset.
- **Expected / impact:** Registration should reconcile with the current user. Instead, B misses notifications and the device can continue receiving A's notifications.
- **Evidence:** **Isolated reproduction:** synchronization after switching to B issued no registration request. The cache stores a token, not its owner or registration validity.
- **Fix direction:** Reconcile ownership on auth/reset transitions and define sign-out behavior.

Latent until finding 5 is fixed.

### 11. Disabling notifications is undone on reload

**Files:** `src/lib/push-client.js:136–141,149–181`; `src/components/PushNotificationsControl.js:40–50`

- **Trigger / actual:** Disable notifications, then remount/reload. Disable clears the token cache, but browser permission remains granted. Startup sync obtains the token and registers it again.
- **Expected / impact:** An explicit opt-out should persist. Notifications instead resume; the control also mistakes browser permission for application-level enabled state.
- **Evidence:** **Isolated reproduction:** unregister was immediately followed by register during simulated startup sync.
- **Fix direction:** Persist desired enabled state separately from permission and token caching, and share it between controls/runtime.

Latent until finding 5 is fixed.

### 12. Delayed read-marker writes acknowledge unseen messages

**File:** `src/lib/lastReadClient.js:99–126`

- **Trigger / actual:** View a chat at T, switch away, then receive a message before the two-second debounce completes. The persisted marker uses execution-time `serverTimestamp()`, covering the unseen message.
- **Expected / impact:** Read boundaries should describe observed messages. The current implementation can suppress unread badges and issue false read receipts.
- **Evidence:** **Source-validated:** observation time is captured locally but not persisted. Closing the page before the timer also loses pending markers; `flushPendingWrites()` has no application caller.
- **Fix direction:** Persist a stable observed-message boundary and define safe pending-write lifecycle behavior.

### 13. Your unread markers do not synchronize across devices/tabs

**Files:** `src/hooks/useRealtimeMessages.js:130–161`; `src/lib/lastReadClient.js:53–55`; `src/context/RealtimeMessagesContext.js:21–31`

- **Trigger / actual:** Read a conversation on device B while A remains open. A keeps its cached marker and does not clear the badge.
- **Expected / impact:** Remote reads should update unread counts. Current subscriptions for those counts are an in-process event bus; the Firestore receipt subscription watches the other participant, not the current user.
- **Evidence:** **Source-validated:** own markers are fetched for priming but not remotely subscribed for unread updates.
- **Fix direction:** Subscribe to the user's relevant markers and propagate changes into the count calculation.

### 14. Legacy history disappears for some nonmutual assignments

**Files:** `src/lib/message-utils.js:74–85`; compare `src/components/PublicFeed.js:11–20`

- **Trigger / actual:** A nonmutual pair has a Santa ID sorting after the recipient ID. A legacy message lacks both `conversationId` and `isSantaMsg`. Canonical sorting assigns it to the opposite, inactive direction.
- **Expected / impact:** Existing history should appear in the actual chat. It instead disappears from both participants' DM views, even when the feed can infer the relationship.
- **Evidence:** **Isolated reproduction:** the actual conversation returned zero messages for a synthetic legacy row that should belong to it.
- **Fix direction:** Resolve unambiguous assignments before using canonical routing for genuinely ambiguous cycles.

### 15. Mutual pairs get duplicate/phantom legacy unread badges

**File:** `src/hooks/useRealtimeMessages.js:178–185,204–211`

- **Trigger / actual:** A and B are mutual partners. A legacy incoming message lacks a conversation ID. Both unread filters accept it, ignoring the role/canonical logic used by rendering.
- **Expected / impact:** Only the owning chat should show unread. Both badges can increment, including a chat where the message is absent.
- **Evidence:** **Isolated reproduction:** recipient and Santa unread counts were both 1, while only one rendered conversation contained the message.
- **Fix direction:** Share directional legacy resolution between rendering and unread calculations.

### 16. An unsent draft follows you into the other chat

**Files:** `src/components/ChatTabs.js:37–65`; `src/components/Chat.js:68,189–205`

- **Trigger / actual:** Type in Recipient, switch directly to Santa, and press Send. The unkeyed `Chat` instance retains its draft while its destination changes.
- **Expected / impact:** Drafts should stay scoped to their original conversation or clear. Content can accidentally reach the wrong person or role.
- **Evidence:** **React/Jest reproduction against actual components:** the recipient draft remained after switching and was enqueued to the Santa destination.
- **Fix direction:** Key chat instances by identity/conversation, or explicitly store per-conversation drafts.

### 17. Admin controls are miswired or unreachable

**Files:** `src/app/page.js:145–155,187`; `src/components/Sidebar.js:103–123`; `src/components/AdminPanel.js:77–118`

- **Trigger / actual:** Click desktop sidebar Reset. It invokes `refreshUser`, not the reset API, and performs no reset. Separately, the only rendered `AdminPanel` uses its compact variant, which omits Start Exchange.
- **Expected / impact:** Advertised reset should perform the confirmed authenticated action; assignment should be reachable through the admin UI. Desktop reset is ineffective and the existing assignment control is not exposed.
- **Evidence:** **Source-validated:** callback wiring and all current `AdminPanel` call sites.
- **Fix direction:** Wire the intended admin actions into reachable controls, retaining refresh as a completion callback.

### 18. Public-feed read history leaks between local accounts

**File:** `src/components/PublicFeed.js:56–68,181–190,214–224`

- **Trigger / actual:** Read threads as A, then sign in as B in the same browser. Both accounts use `publicFeedLastViewed`; hydration preserves the newer local timestamps over B's actual remote history.
- **Expected / impact:** B should have independent read state. Threads B never read can appear already read.
- **Evidence:** **Source-validated:** the local-storage key is not user-scoped, and state is not reset for a user change.
- **Fix direction:** Scope persisted and in-memory feed history by user, including an explicit legacy-key migration policy.

### 19. Messages viewed inside an open feed thread remain unread

**File:** `src/components/PublicFeed.js:204–228,304–305`

- **Trigger / actual:** Open a thread, receive and view a new message, then return to the thread list. The marker only advanced on the initial thread click.
- **Expected / impact:** Viewed messages should not retain unread badges. The list instead counts the newly viewed messages as unread.
- **Evidence:** **Source-validated:** rendering new messages in the selected thread does not advance its read boundary.
- **Fix direction:** Mark actually viewed updates in the selected thread, respecting page visibility.

### 20. Sound stays inactive if mounted after messages finish loading

**File:** `src/components/NotificationSoundRuntime.js:39–63`

- **Trigger / actual:** Mount the runtime with an authenticated user and `allMessagesLoading=false`; then receive a new message in an eligible visible standalone window. Initialization waits for a loading true-to-false transition that never occurs.
- **Expected / impact:** The first loaded state should establish a silent baseline; subsequent messages should chime. Sound instead stays inactive for that mount.
- **Evidence:** **Isolated reproduction:** zero plays after an already-loaded mount; the normal loading-transition control played once. The provider can finish before `AuthGuard` mounts the runtime.
- **Fix direction:** Initialize from the first usable loaded snapshot, including already-loaded mounts.

### 21. Background push has two notification-display owners

**Files:** `src/lib/push-server.js:184–202`; `worker/index.js:25–36`

- **Trigger / actual:** Receive a notification-payload push with no visible window. Firebase Messaging displays the notification, then the custom background callback calls `showNotification` again, with a different tag.
- **Expected / impact:** One incoming message should produce one notification, not two distinct notifications.
- **Evidence:** **Installed-SDK/worker path reproduction:** executing the installed SDK's background dispatch with the actual worker callback resulted in two display calls. Actual browser/FCM delivery was not exercised.
- **Fix direction:** Choose SDK automatic display or data-only custom display, not both.

Latent until finding 5 is fixed. This was conditional in the agent handoff; inspecting and probing the installed SDK confirmed the duplicate code path.

## Low priority

### 22. Emulator utility scripts target the wrong project namespace

**Files:** `scripts/wipe_db.js:5–8`; `scripts/check_all_data.js:5–8`; `scripts/check_messages.js:5–8`; `scripts/test_message_routing.js:6–9`; compare `src/lib/firebase-client.js:16`

- **Trigger / actual:** Populate the app's development emulator, then use one of these utilities. They initialize `demo-secret-santa`, whereas the app uses `xmasteak-app`.
- **Expected / impact:** Utilities should inspect or modify the application's emulator data. Instead, diagnostics can appear empty, injected messages are invisible, and the wipe leaves the app's data intact.
- **Evidence:** **Source-validated configuration mismatch.** These utilities were not executed against existing data.
- **Fix direction:** Share explicit emulator-project configuration while preserving emulator-only safeguards.

## Additional conditional risk — not counted above

### Development sends can potentially reach real FCM

**Files:** `src/lib/firebase.js:6–10,20–23`; `src/lib/push-server.js:184–202`

Auth and Firestore are redirected to emulators, but Messaging dispatch has no equivalent development guard or stub. With suitable application-default credentials and real tokens placed in emulator storage, local messages could produce real notifications. Neither credentials nor live FCM were inspected or exercised, so the necessary conditions are **unconfirmed**.

**Recommendation:** Disable/stub development push by default and require explicit authorization/opt-in for real dispatch.

## Scope and exclusions

The agent inspected substantive application source in `src/`, Firestore rules, worker source, Firebase/index and Next/PWA configuration, package/CI/test configuration, utilities, and relevant tests across authentication, assignment/reset, routing, unread/read receipts, outbox, push, reactions, typing, and selected E2E flows.

Generated assets, secrets, participant data/logs, and deployed systems were excluded. The primary additionally inspected the installed Messaging implementation for narrowly scoped validation. The documented participant social-anonymity convention and fail-open push policy were not treated as defects. No findings above imply that deployed rules or production data were checked.
