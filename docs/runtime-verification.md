# Local runtime verification

Project-specific notes for the **primary assistant** performing browser and
emulator checks. These are ordinary documentation, not an agent skill or an
instruction to run them automatically. Delegates may read relevant notes but do
not execute these procedures; see [AGENTS.md](../AGENTS.md).

**Re-verify on use:** selectors and UI observations below were preserved from an
earlier verification recipe. They were not runtime-tested during this cleanup.
Check them against the running app rather than assuming they are current.

## Safety and setup

- Use local Firebase emulators, not production. `.firebaserc` defaults to
  `xmasteak-app`, which is not a `demo-` project ID.
- Inspect ports 8080 (Firestore), 9099 (Auth), 4000 (emulator UI), and 3000 (app).
  Do not stop or reuse processes you did not start without user authorization.
- Seed, assign, and reset operations mutate data. Use an isolated emulator stack
  you started for the test, or get authorization to change the existing stack.
  A server being on localhost does not prove its database is emulated.
- `scripts/seed_users.js` can connect to production if the emulator host is
  absent and production credentials are present. Prefer the development-only
  seed route below; if using that script, explicitly set
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and verify the target first.
- Do not copy real credentials, auth tokens, or participant data into reports.

Use the supported Node version from `.nvmrc`, then start these in separate
terminals and wait until both emulators and the app are ready:

```bash
npm run emulators
npm run dev                 # next dev --webpack; http://localhost:3000
```

Only on the isolated or authorized development stack, create participants and
assignments before checking chats:

```bash
curl -fsS -X POST http://127.0.0.1:3000/api/dev/seed
curl -fsS -X POST http://127.0.0.1:3000/api/dev/assign
```

Assignment shuffles can change existing pairings. Do not run them against a
shared emulator merely to inspect its current state.

## Automated checks versus manual browser checks

Use explicit commands; report which suites actually ran:

```bash
npm run lint
npm run test:unit
npm run test:integration    # requires the emulator stack
npm run test:e2e            # requires emulators; Playwright manages the dev server
```

Before E2E, check whether Playwright would reuse an existing local server and
whether its tests would mutate existing emulator data. See
[`playwright.config.ts`](../playwright.config.ts) and
[`e2e/messaging.spec.ts`](../e2e/messaging.spec.ts).

Playwright is the declared browser-test dependency. Its configuration captures
screenshots on failure and traces on the first retry. Use its existing tooling
for extra screenshots as needed; no separate browser package is required.

The suite uses `/dev/login` for authenticated flows, including a two-user message
send and delivery check. That development shortcut does **not** verify the
Google sign-in popup. Some other E2E checks are conditional or structural, so a
passing suite does not demonstrate every flow below works.

## Discover current assignments

On the Firestore emulator only, inspect users through its local REST API:

```bash
curl -fsS -H 'Authorization: Bearer owner' \
  'http://127.0.0.1:8080/v1/projects/xmasteak-app/databases/(default)/documents/users?pageSize=50'
```

The `owner` value is an emulator bypass, not a production credential. Inspect
results locally without copying participant identities into logs or reports.

User documents have `recipientId` and `gifterId`:

- User X's **Santa** tab chats with X's gifter.
- That gifter's **Recipient** tab chats with X.
- Both views use `santa_{gifterId}_recipient_{X.id}`.

Look up the actual pairings after an assignment shuffle; do not assume a fixed
recipient. User document IDs are UUIDs, not Firebase Auth UIDs.

## Google sign-in through the Auth emulator

Use a clean browser context and confirm Auth is connected to the local emulator
before signing in:

1. Click **Sign in with Google** and capture the newly opened popup.
2. In a fresh emulator, choose **Add new account**; otherwise select the intended
   local test account.
3. Historical selector gotcha: the email field is `#email-input` with
   `type="text"`, **not** `type="email"`. The display-name field is
   `#display-name-input`. Inspect the current fields before filling them; mixing
   them up previously produced `ACCESS_DENIED`.
4. Use an authorized participant's local test identity, then submit **Sign in**.
5. Wait for the popup to close and the app to show the **Santa** tab. Confirm the
   expected assigned-user state rather than treating a fixed delay as success.

For repeatable automated app checks, `/dev/login` is the existing development
shortcut; use the popup procedure when validating the Google sign-in path itself.

### Reset isolated Auth-emulator accounts, only when intentional

The following deletes **all accounts** in the named local Auth emulator. Use it
only when a clean account state is necessary and the emulator is disposable or
the user has authorized that reset. It does not reset Firestore documents.

```bash
curl -fsS -X DELETE \
  'http://127.0.0.1:9099/emulator/v1/projects/xmasteak-app/accounts' \
  -H 'Authorization: Bearer owner'
```

## Multi-user chat observations

Use two isolated browser contexts or browser instances, not two tabs sharing the
same auth session. Sign in as an assigned Santa and recipient. Only the active
chat tab is mounted, so switch to the intended view before checking it.

Historical observables to confirm against the current UI:

- **Typing:** body text contains `is typing` while the other user types.
- **Unread:** `[aria-label$="unread messages"]`; tab badge labels are
  `"Santa: N unread messages"`, while the chat-header badge is
  `"N unread messages"`.
- **Read receipts:** sender-side `[aria-label="Read"]` (double check) versus
  `[aria-label="Delivered"]` (single check). Inspect the newest own message,
  rather than assuming every matching indicator refers to it.
- **Delivery:** confirm the send API accepts the message and that it reaches the
  other user's view. Optimistic rendering on the sender alone is insufficient.

To exercise visibility-sensitive unread/read behavior, the earlier recipe used
this synthetic event in the page under test:

```javascript
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => 'hidden',
});
document.dispatchEvent(new Event('visibilitychange'));
```

To simulate visible again, replace the getter with one returning `'visible'` and
dispatch the event again. Reload afterward to remove the override. This is a
synthetic check, not a substitute for testing a genuinely backgrounded tab.

## Console and notification expectations

- Headless browsers may show **Notifications unavailable**; this does not verify
  production push notifications.
- The earlier signed-in checks expected **zero console errors**. Investigate
  Firestore, permission/rules, or other runtime errors rather than dismissing
  them as expected emulator noise.
- Record unexpected behavior and the exact checks run. Do not label historical
  recipe details as verified until they have been checked in the current app.
