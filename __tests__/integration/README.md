# Integration Tests

These tests require the Firebase Emulator to be running and test the full integration with Firebase services.

## Running Integration Tests

### 1. Start Firebase Emulators
```bash
npm run emulators
```

### 2. Run Integration Tests (in another terminal)
```bash
npm run test:integration
```

## Tests Included

- **firestore_participants.test.js**: Tests participant initialization and management with real Firestore
- **init.test.js**: Tests the `/api/init` endpoint that seeds participant data

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
