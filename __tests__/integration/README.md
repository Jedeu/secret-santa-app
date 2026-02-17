# Integration Tests

These tests require the Firebase Emulator to be running and test the full integration with Firebase services.

## Running Integration Tests

### 1. Start Firebase Emulators
```bash
npm run emulators
```
The integration Jest config expects Firestore/Auth emulators on `127.0.0.1:8080` and `127.0.0.1:9099`.

### 2. Run Integration Tests (in another terminal)
```bash
npm run test:integration
```

## Tests Included

- **firestore_participants.test.js**: Tests participant initialization and management with real Firestore
- **init.test.js**: Tests the `/api/init` endpoint that seeds participant data
- **firestore-rules-lastRead.test.js**: Validates scoped `lastRead` read rules (DM allowed, `publicFeed_*` denied cross-user)
- **firestore-rules-typing.test.js**: Validates `typing` ID integrity and auth-match write constraints
- **firestore-rules-reactions.test.js**: Validates `reactions` create/delete/update constraints and message existence

## Test Data Management

Integration tests use the Firebase Emulator, which provides automatic data isolation:
- Each emulator session starts fresh with an empty database
- No need for manual database resets between tests
- The emulator maintains its own in-memory data separate from production

## Why Separate from Unit Tests?

Integration tests are slower and require external services (Firebase Emulator). By separating them:
- **CI runs faster** with just unit tests
- **Developers can choose** when to run full integration tests
- **Unit tests provide quick feedback** during development
