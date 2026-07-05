# PLAN: Dependency Security Upgrade + resetDatabase Hardening

## Goal

Clear the critical `npm audit` findings by upgrading `firebase-admin` to v14 (plus in-range minor bumps), and fix `resetDatabase()` so it deletes all app collections in Firestore-safe batch chunks.

## Proposed Changes

### 1. Dependency upgrades

- `package.json` / `package-lock.json`:
  - `firebase-admin`: `^13.6.0` -> `^14.1.0` (major; clears critical transitive vulns in `protobufjs` and `fast-xml-parser`). v14 requires Node >= 20, which matches the existing `engines` policy (`>=20.10.0 <21`).
  - `npm update` for in-range minors: `firebase` 12.15, `next` 16.2.x, `eslint-config-next` 16.2.x, `react`/`react-dom` 19.2.7, `jest` 30.4.x, `@playwright/test` 1.61.x, `emoji-picker-react`, `@testing-library/react`, `firebase-tools` 14.27, `webpack` 5.108, etc.
  - Deliberately NOT taken (out-of-scope majors): `eslint` 10, `@eslint/js` 10, `globals` 17, `uuid` 11+, `firebase-tools` 15.

### 2. `resetDatabase()` fix (`src/lib/firestore.js`)

- Extend the deleted-collections list from `['users', 'messages', 'lastRead']` to also include `'typing'`, `'reactions'`, `'pushTokens'` (matches every collection the app writes; see `firestore.rules` and `PUSH_TOKENS_COLLECTION` in `src/lib/push-server.js`).
- Delete in chunks of 500 docs per batch (Firestore hard limit per `WriteBatch`); skip the commit entirely for empty collections.

### 3. Test updates (`__tests__/lib/firestore.test.js`)

- Update the `resetDatabase` unit test for the new collection list and skip-empty-commit behavior.
- Add a chunking regression test: >500 docs in one collection must produce multiple batch commits.

## Verification

- `npm run lint`
- `npm run test:unit` (full unit suite)
- `npx firebase emulators:exec --project=demo-secret-santa "npm run test:integration"` (exercises `resetDatabase` against the real emulator via `firestore_participants.test.js` and `init.test.js`)
- `npm run build` (confirm Next production build still succeeds after upgrades)
- `npm audit --omit=dev` (confirm criticals cleared)
