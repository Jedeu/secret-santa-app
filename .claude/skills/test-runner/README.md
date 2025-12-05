# Test Runner Skill

Intelligent test runner that automatically selects the appropriate test suite based on Firebase Emulator availability.

## Quick Start

### Automatic Test Selection (Recommended)
```bash
./.claude/skills/test-runner/run-tests.sh
```

This will:
1. ✅ Check if Firebase Emulators are running
2. ✅ Run integration tests if emulators detected
3. ✅ Run unit tests only if emulators not detected
4. ✅ Display clear status and results

### Manual Test Commands

**Unit tests only** (fast, no dependencies):
```bash
npm run test:unit
```

**Integration tests** (requires emulators):
```bash
npm run test:integration
```

**Watch mode** (for development):
```bash
npm run test:watch
```

**All tests** (runs unit tests by default):
```bash
npm test
```

## How It Works

The test runner checks if Firestore Emulator is running on port 8080:
- **Emulators running** → Runs `npm run test:integration`
- **Emulators NOT running** → Runs `npm run test:unit` with warning

This prevents false negatives from running integration tests without the required backend services.

## Example Output

### With Emulators Running
```
🧪 Secret Santa Test Runner
================================

Checking Firebase Emulator status...

✅ Firestore Emulator (port 8080): Running
✅ Auth Emulator (port 9099): Running
✅ Emulator UI (port 4000): Running

================================

✅ Emulators detected - running INTEGRATION tests
Command: npm run test:integration

[Test output...]
✨ All tests passed!
```

### Without Emulators
```
🧪 Secret Santa Test Runner
================================

Checking Firebase Emulator status...

⚠️  Firestore Emulator (port 8080): Not running
⚠️  Auth Emulator (port 9099): Not running
⚠️  Emulator UI (port 4000): Not running

================================

⚠️  Emulators not detected - running UNIT tests only

To run integration tests:
  1. Start emulators: npm run emulators
  2. Run this script again

Command: npm run test:unit

[Test output...]
✨ All tests passed!
```

## Files

- **SKILL.md**: Complete skill definition for Claude Code
- **run-tests.sh**: Intelligent test runner script
- **README.md**: This file

## Integration with Claude Code

Claude Code will automatically discover this skill when you ask:
- "Run the tests"
- "Test the code"
- "Run integration tests"
- "Run unit tests"
- "Check if tests pass"

The skill will intelligently select the appropriate test suite based on your environment.

## Adding to package.json (Optional)

You can add this to your `package.json` scripts for easier access:

```json
{
  "scripts": {
    "test:smart": "./.claude/skills/test-runner/run-tests.sh"
  }
}
```

Then run with: `npm run test:smart`
