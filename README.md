# Secret Santa App

A private Secret Santa web app: participants sign in with Google, get assigned a
recipient, and exchange **anonymous** messages with both their Santa and the
person they're buying for. Includes a public feed, emoji reactions, typing
indicators, read receipts, and Web Push notifications.

Built with **Next.js** (App Router), **Firebase Auth**, **Cloud Firestore**, and
**Firebase Cloud Messaging**.

> Anonymity is a social convention enforced by the UI, not a hard security
> guarantee — see the "Important Notes" section of [`CLAUDE.md`](CLAUDE.md).

## Tech Stack

- **Next.js** (React, App Router) — UI and API routes
- **Firebase Auth** — Google OAuth sign-in
- **Cloud Firestore** — data store (real-time listeners)
- **Firebase Cloud Messaging** — Web Push notifications
- **Jest** — unit and integration tests
- **Firebase Emulator Suite** — local Auth + Firestore for development and tests

## Prerequisites

- **Node.js `>=22.13.0 <23`** (see `engines` in `package.json`)
- **Java 11+** — required to run the Firebase Emulators
- **Firebase CLI** — `npm install -g firebase-tools`

## Getting Started

```bash
# 1. Install dependencies (clean, lockfile-exact)
npm ci

# 2. Start the Firebase Emulators (Auth :9099, Firestore :8080, UI :4000)
npm run emulators

# 3. In a second terminal, start the dev server
npm run dev
```

The dev server runs at http://localhost:3000. The client and server Firebase SDKs
auto-detect development mode and connect to the emulators at `127.0.0.1` — no
production Firebase project is needed for local work.

To seed local data, POST to the dev routes (development only): `/api/init` or
`/api/dev/seed`. See the `db-admin` workflow / `src/lib/participants.js` for the
participant list.

## Testing

```bash
npm test              # Unit tests only (default; excludes integration)
npm run test:unit     # Unit tests explicitly
npm run test:integration  # Integration tests — REQUIRES emulators running
npm run test:watch    # Watch mode
```

Integration tests talk to the Firebase Emulators, so start `npm run emulators`
first. They are excluded from the default `npm test` run.

## Build & Lint

```bash
npm run build   # Production build
npm run lint    # ESLint
```

## Deployment

Production requires these environment variables:

**Server (Firebase Admin SDK):**

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

**Client (`NEXT_PUBLIC_*`, safe to expose):**

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY` — FCM Web Push public key

Push notifications run through Firebase Cloud Messaging using the server Admin
credentials, so there is no separate web-push private key.

Firestore security rules live in `firestore.rules` and are hardened
(per-collection field allowlists, sender-identity checks, delete disabled). Deploy
them alongside the app.

## Architecture

For architecture depth — the auth handshake, the conversationId message model,
the dual client/admin Firebase SDK split, Firestore listener optimizations, and
the full API route list — see [`CLAUDE.md`](CLAUDE.md). This README intentionally
does not duplicate it.

Historical planning docs from past efforts are archived under
[`docs/archive/`](docs/archive/).
