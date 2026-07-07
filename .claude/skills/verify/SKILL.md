# Verify (project recipe)

Runtime-verification recipe for this app: how to build, launch, sign in
programmatically, and drive multi-user chat flows. Learned during E2E
verification; reuse instead of cold-starting.

## Launch

```bash
npm run emulators          # Firestore :8080, Auth :9099 (wait for both)
npx next dev --webpack     # NOT `npm run dev` — Next 16 defaults to Turbopack
                           # and hard-errors on this repo's webpack config
```

Wait until `curl -s localhost:3000` responds, then seed:

```bash
curl -X POST localhost:3000/api/dev/seed     # create users from participants list
curl -X POST localhost:3000/api/dev/assign   # random circular santa assignment
```

## Discover assignments (who is whose santa)

Firestore emulator REST with owner bypass:

```bash
curl -H "Authorization: Bearer owner" \
  "http://127.0.0.1:8080/v1/projects/xmasteak-app/databases/(default)/documents/users?pageSize=50"
```

Each user doc has `recipientId` / `gifterId`. User X's **Santa tab** chats with
their gifter; the gifter's **Recipient tab** chats with X. Same conversationId:
`santa_{gifterId}_recipient_{X.id}`.

## Programmatic sign-in (Puppeteer, emulator auth popup)

- Click `button ::-p-text(Sign in with Google)`; catch popup via
  `browser.once('targetcreated', ...)`.
- Fresh emulator: click `::-p-text(Add new account)`.
- **Gotcha:** the emulator's email field is `input#email-input` with
  `type="text"`, NOT `type="email"`. Use `#email-input` and
  `#display-name-input` by id, or you'll type the display name into the email
  field and get ACCESS_DENIED.
- Submit: `button ::-p-text(Sign in)`. Then wait for
  `button ::-p-text(Santa)` on the main page.
- Reset accounts between runs:
  `curl -X DELETE http://127.0.0.1:9099/emulator/v1/projects/xmasteak-app/accounts -H "Authorization: Bearer owner"`

## Multi-user flows

Launch two separate `puppeteer.launch()` browsers (isolated auth). Only the
active tab's Chat is mounted (ChatTabs renders one). Useful observables:

- Typing indicator: body text contains `is typing`.
- Unread badges: `[aria-label$="unread messages"]` — tab badge label is
  `"Santa: N unread messages"`, chat-header badge is `"N unread messages"`.
- Read receipts (sender side): `[aria-label="Read"]` (✓✓) vs
  `[aria-label="Delivered"]` (✓); last one in DOM = newest own message.
- Simulate tab hide/show:
  `Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'})`
  then `document.dispatchEvent(new Event('visibilitychange'))`.

## Known noise

- Headless shows "Notifications unavailable" (no push in headless) — expected.
- A signed-in session should produce **zero** console errors; treat any
  `[Firestore]`/rules error as a finding, not noise.
