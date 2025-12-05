---
name: test-runner
description: Intelligently run unit or integration tests based on Firebase Emulator availability. Use when running tests to automatically select the appropriate test suite and avoid false negatives from missing backend services.
allowed-tools: [Bash, Read]
---

# Test Runner Skill

Intelligently executes the appropriate test suite based on environment availability.

## Overview

This skill prevents false test failures by detecting whether Firebase Emulators are running and executing the appropriate test suite:
- **Emulators running** → Run integration tests (`npm run test:integration`)
- **Emulators NOT running** → Run unit tests only (`npm run test:unit`)

## Test Suites

### Unit Tests
- **Command**: `npm run test:unit`
- **Path pattern**: All tests except `__tests__/integration/`
- **Dependencies**: None (uses mocks)
- **Speed**: Fast (~2-5 seconds)
- **When to use**: Quick validation, CI/CD, pre-commit checks

### Integration Tests
- **Command**: `npm run test:integration`
- **Path pattern**: `__tests__/integration/`
- **Dependencies**: Firebase Emulators (Firestore on port 8080, Auth on port 9099)
- **Speed**: Slower (~10-30 seconds)
- **When to use**: Full system validation, before deployment

### All Tests
- **Command**: `npm test`
- **Behavior**: Runs unit tests only (integration excluded by default in jest.config.js)

## Smart Test Execution

### Primary Command: Intelligent Test Runner

The skill uses this logic to select the appropriate test suite:

```bash
#!/bin/bash
# Check if Firebase Emulator is running on port 8080
if lsof -i :8080 > /dev/null 2>&1; then
    echo "✅ Firebase Emulators detected - running integration tests"
    npm run test:integration
else
    echo "⚠️  Emulators not detected, skipping integration tests"
    echo "Running unit tests only..."
    npm run test:unit
fi
```

### Alternative Detection Methods

**Using netcat (nc)**:
```bash
if nc -z 127.0.0.1 8080 2>/dev/null; then
    echo "✅ Emulator running"
else
    echo "❌ Emulator not running"
fi
```

**Using curl**:
```bash
if curl -f http://127.0.0.1:8080 > /dev/null 2>&1; then
    echo "✅ Emulator running"
else
    echo "❌ Emulator not running"
fi
```

**Best method**: `lsof` (most reliable, checks port binding)

## Usage Examples

### Example 1: Run tests (auto-detect)
**User**: "Run the tests"

**Claude executes**:
```bash
# Check emulator status
if lsof -i :8080 > /dev/null 2>&1; then
    npm run test:integration
else
    echo "⚠️  Emulators not detected, skipping integration tests"
    npm run test:unit
fi
```

### Example 2: Full test suite with emulators
**User**: "Run all tests including integration"

**Claude responds**:
1. Check if emulators running
2. If not: "Please start emulators with `npm run emulators`"
3. If yes: Execute `npm run test:integration`

### Example 3: Quick validation
**User**: "Quick test run"

**Claude executes**: `npm run test:unit` (fast, no dependencies)

### Example 4: Watch mode
**User**: "Run tests in watch mode"

**Claude executes**: `npm run test:watch`

## Error Handling

### Emulator Not Running (Integration Tests Requested)

```bash
if ! lsof -i :8080 > /dev/null 2>&1; then
    echo "❌ Firebase Emulators not running on port 8080"
    echo ""
    echo "To run integration tests:"
    echo "1. Start emulators: npm run emulators"
    echo "2. Then run: npm run test:integration"
    echo ""
    echo "Or run unit tests only: npm run test:unit"
    exit 1
fi
```

### Test Failures

When tests fail, the skill should:
1. Report the failure count
2. Show failed test names
3. Suggest relevant files to investigate
4. Offer to re-run specific tests

### Dependencies Missing

```bash
# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "❌ Dependencies not installed"
    echo "Run: npm install"
    exit 1
fi
```

## Port Checks

Firebase Emulators use multiple ports. For comprehensive checking:

```bash
# Check all emulator ports
FIRESTORE_RUNNING=$(lsof -i :8080 > /dev/null 2>&1 && echo "yes" || echo "no")
AUTH_RUNNING=$(lsof -i :9099 > /dev/null 2>&1 && echo "yes" || echo "no")
UI_RUNNING=$(lsof -i :4000 > /dev/null 2>&1 && echo "yes" || echo "no")

echo "Firestore Emulator (8080): $FIRESTORE_RUNNING"
echo "Auth Emulator (9099): $AUTH_RUNNING"
echo "Emulator UI (4000): $UI_RUNNING"

# For integration tests, Firestore (8080) is the minimum requirement
if [ "$FIRESTORE_RUNNING" = "yes" ]; then
    npm run test:integration
else
    echo "⚠️  Firestore Emulator not detected"
    npm run test:unit
fi
```

## Test File Organization

Understanding the test structure helps with selective test execution:

```
__tests__/
├── integration/                 # Requires emulators
│   ├── firestore_participants.test.js
│   └── init.test.js
├── unit/                        # No dependencies
│   ├── Chat_unread.test.js
│   ├── message_routing.test.js
│   ├── unread_logic.test.js
│   └── PublicFeed_grouping.test.js
├── api/                         # Mixed (some need emulators)
│   └── admin_reset_enhanced.test.js
└── lib/                         # Unit tests
    └── firestore.test.js
```

## Running Specific Tests

### Single test file
```bash
npm test __tests__/unit/message_routing.test.js
```

### Tests matching a pattern
```bash
npm test -- --testNamePattern="conversation ID"
```

### With coverage
```bash
npm test -- --coverage
```

## CI/CD Integration

For continuous integration environments where emulators aren't available:

```bash
# CI typically runs unit tests only
if [ "$CI" = "true" ]; then
    echo "CI environment detected - running unit tests"
    npm run test:unit
else
    # Local development - smart detection
    if lsof -i :8080 > /dev/null 2>&1; then
        npm run test:integration
    else
        npm run test:unit
    fi
fi
```

## Common Workflows

### Pre-commit Testing (Fast)
```bash
npm run test:unit
```

### Full Local Validation
```bash
# Terminal 1: Start emulators
npm run emulators

# Terminal 2: Run integration tests
npm run test:integration
```

### Development with Hot Reload
```bash
npm run test:watch
```

### Debugging Failed Tests
```bash
# Run with verbose output
npm test -- --verbose

# Run single failing test
npm test __tests__/integration/init.test.js
```

## Reference Files

- **Test configuration**: `jest.config.js`
- **Test setup**: `jest.setup.js`, `__tests__/setup.js`
- **Unit tests**: `__tests__/unit/`
- **Integration tests**: `__tests__/integration/`
- **Package scripts**: `package.json` (scripts section)

## Best Practices

1. **Always use smart detection**: Let the skill decide which tests to run
2. **Don't skip integration tests**: Run them locally before pushing
3. **Watch mode for development**: Use `npm run test:watch` while coding
4. **Check coverage**: Ensure new code has test coverage
5. **Run integration tests before PR**: Validate full system works

## Troubleshooting

### Tests hang indefinitely
- Check if emulators are running when not expected
- Kill orphaned processes: `lsof -ti :8080 | xargs kill -9`

### Integration tests fail with connection errors
- Verify emulators are running: `lsof -i :8080`
- Check emulator UI: http://localhost:4000
- Restart emulators if needed

### Jest cache issues
```bash
npm test -- --clearCache
```

### Module resolution errors
```bash
rm -rf node_modules package-lock.json
npm install
```
