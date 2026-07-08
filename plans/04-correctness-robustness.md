# Plan 4: Correctness / Robustness Backlog (Backlog §4, audit section 2)

Four independent items; land as separate commits (or PRs) in the order below — item 2 (email normalization) slightly simplifies item 1's lookup.

## Item 1: Duplicate-user race in `useUser`

### Ground Truth

- `src/hooks/useUser.js:49-85`: query users by email → if empty, `setDoc(doc(firestore, 'users', uuidv4()), …)`. Two devices signing in simultaneously both see an empty query and create two docs for one email. Nothing (code or rules) enforces email uniqueness.
- Rules constraint (`firestore.rules`, `isAllowedUserCreate`): `data.id == docId`, `data.email == token.email`, `recipientId`/`gifterId` must be null on create. Updates are only allowed via the two assignment paths — a second `setDoc` on an existing doc is **denied**, which is exactly the failure mode we want.

### Proposed Fix: deterministic doc ID derived from email

Client-side transactions can't run queries, so query-then-create can't be made atomic. Instead make both racers compute the **same** doc ID so the race collapses to create-vs-create on one document:

1. Add `getDeterministicUserId(email)` in `src/lib/message-utils.js` or a new `src/lib/user-id.js`: `uuidv5(email.toLowerCase(), APP_NAMESPACE)` (uuid v5 is in the already-installed `uuid` package; if Plan 6's uuid-drop lands first, derive a UUID-shaped string from `crypto.subtle`/`crypto.createHash` SHA-1 of the email instead — coordinate).
2. In `useUser.fetchUserData`:
   - Keep the existing email query as the primary lookup (existing users have random UUIDs — a deterministic-ID lookup would miss them, so **no migration needed**).
   - On the create path, use `newId = getDeterministicUserId(email)` instead of `uuidv4()`.
   - If `setDoc` fails with `permission-denied` (the loser of the race hitting the update-rules wall), re-run the email query and adopt the winner's doc instead of surfacing `CREATE_FAILED`.
3. Rules unchanged — deterministic v5 UUIDs still satisfy every existing constraint.

### Tests

- `__tests__/unit/useUser_realtime.test.js`: add a case where `setDoc` rejects with `permission-denied` and a re-query returns the winner's doc ⇒ hook resolves to that user, no error.
- Unit test that `getDeterministicUserId` is stable and case-insensitive.

## Item 2: Email casing normalization

### Ground Truth

- `useUser.js:34` stores `firebaseUser.email` verbatim; `/api/messages/send/route.js:207` and push routes query `where('email', '==', senderEmail.toLowerCase())`; rules compare `== request.auth.token.email` exactly. It works today only because Google returns lowercase.

### Proposed Fix

- `src/hooks/useUser.js`: `const email = firebaseUser.email?.toLowerCase();` at the top of `fetchUserData` — one normalization point covering the participant check, the query, and the stored doc.
- Verify `src/lib/participants.js` lookups compare case-insensitively (emails in the hardcoded list are lowercase; make `getParticipantName`/`getParticipantEmail` lowercase their input if they don't already).
- Rules: no change — `request.auth.token.email` from Google is lowercase, and now stored docs are too.
- No data migration: existing docs were created from Google-lowercased emails.

### Tests

- Unit test: mixed-case `firebaseUser.email` ⇒ stored doc + participant check use lowercase.

## Item 3: Admin assign endpoint tramples self-selection

### Ground Truth

- `src/app/api/admin/assign/route.js:26-54`: unconditionally shuffles and overwrites every user's `recipientId`/`gifterId`; existing conversations (keyed `santa_{id}_recipient_{id}`) are orphaned.
- **Dependency**: Plan 5 may delete this endpoint entirely. Resolve Plan 5 first; only implement this if the endpoint survives.

### Proposed Fix (if endpoint is kept)

- After `getAllUsers()`, check `users.some(u => u.recipientId || u.gifterId)`. If true and `body.force !== true`, return 409 `{ error: 'Assignments already exist. Pass { "force": true } to reshuffle.' }`.
- `src/components/AdminPanel.js` `handleAssign`: on 409, show a second `confirm()` and retry with `force: true`.

### Tests

- `__tests__/admin_ui.test.js` + an API-level test (pattern from `__tests__/api/send_message_api.test.js`): existing assignments + no force ⇒ 409; force ⇒ 200.

## Item 4: Document the anonymity trust model

### Ground Truth

- Rules allow any signed-in participant to `read` all `users` and `messages` docs — unmasking your Santa via DevTools is trivial; there's no pairing check on send (any participant can message anyone). Accepted trade-off for 8 friends.

### Proposed Change

- Add a short "Anonymity & Trust Model" subsection to CLAUDE.md (fold into Plan 1's rewrite — single edit): state the reads-are-open design, why (client-side filtering + free-tier read optimization), and that a real fix requires server-side identity stripping (all reads through API routes) — out of scope unless the participant set grows.

## Verification

```
npm test
npx firebase emulators:exec --project=demo-secret-santa "npm run test:integration"   # rules interactions for item 1
```

## Risks

- Item 1: the `permission-denied` recovery path must not loop — re-query once, then surface the original error.
- Item 3: none if Plan 5 deletes the endpoint; otherwise low.
