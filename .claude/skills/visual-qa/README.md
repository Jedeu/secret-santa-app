# Visual QA Skill

Automated visual smoke testing for the Secret Santa app using Puppeteer.

## Quick Start

### Prerequisites
```bash
# Terminal 1: Start Firebase Emulators
npm run emulators

# Terminal 2: Start Development Server
npm run dev
```

### Run Visual QA

**Option 1: Helper Script (Recommended)**
```bash
./.claude/skills/visual-qa/run-visual-qa.sh
```

**Option 2: Direct npx**
```bash
npx puppeteer@latest node scripts/visual_qa.js
```

**Option 3: Add to package.json**
```json
{
  "scripts": {
    "qa:visual": "npx puppeteer@latest node scripts/visual_qa.js"
  }
}
```
Then run: `npm run qa:visual`

## What It Tests

1. ✅ App loads at localhost:3000
2. ✅ "Sign in with Google" button exists
3. ✅ Firebase Auth popup works
4. ✅ Sign in as jed.piezas@gmail.com succeeds
5. ✅ Santa tab appears after sign in
6. ✅ Screenshots captured for all states

## Screenshot Artifacts

All screenshots saved to `qa_artifacts/` with timestamps:
```
qa_artifacts/
├── 2025-12-04T10-30-00_01-landing-page.png
├── 2025-12-04T10-30-02_02-auth-popup.png
├── 2025-12-04T10-30-05_03-after-auth.png
├── 2025-12-04T10-30-06_05-santa-tab.png
└── 2025-12-04T10-30-09_99-final-state.png
```

## Files

- **SKILL.md**: Complete skill documentation
- **run-visual-qa.sh**: Prerequisite checker and test runner
- **README.md**: This file
- **../scripts/visual_qa.js**: The actual Puppeteer test script

## Usage with Claude Code

Claude will automatically discover this skill when you ask:
- "Run visual QA tests"
- "Take screenshots of the app"
- "Test the sign in flow"
- "Verify the UI is working"

## Why npx?

We use `npx puppeteer@latest` instead of installing Puppeteer as a dependency because:
- ✅ Keeps package.json clean
- ✅ Always uses latest version
- ✅ No 300MB+ download in node_modules
- ✅ Perfect for occasional testing

## Troubleshooting

### Server not running
```bash
npm run dev
```

### Emulator not running
```bash
npm run emulators
```

### User not initialized
Ensure test user has recipient assignment:
```bash
# Reset and seed database
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed_users.js

# Then assign recipients via admin panel or API
```

### Clear old screenshots
```bash
rm -rf qa_artifacts/*
```

## Example Output

```
🎨 Secret Santa Visual QA Runner
==================================

Checking prerequisites...

Checking dev server (localhost:3000)... ✅ Running
Checking Firebase Emulator (port 8080)... ✅ Running
Checking Auth Emulator (port 9099)... ✅ Running

==================================

Running visual QA tests...

🎨 Secret Santa Visual QA Smoke Test
=====================================

ℹ️  Launching headless browser...
ℹ️  Navigating to http://localhost:3000...
✅ App loaded successfully
✅ Screenshot saved: 2025-12-04T10-30-00_01-landing-page.png
...
✅ Santa tab found!

=====================================
Test Summary:
  Passed: 4
  Failed: 0
  Artifacts: /path/to/qa_artifacts
=====================================

✨ Visual QA tests passed!

Screenshots saved to: qa_artifacts/
```
