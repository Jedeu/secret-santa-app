---
name: visual-qa
description: Perform visual smoke testing of the Secret Santa app using headless browser automation. Use when you need to verify the UI is working correctly, test the sign-in flow, or capture screenshots of the app state.
allowed-tools: [Bash, Read, Write]
---

# Visual QA Skill

Automated visual smoke testing using Puppeteer to verify the Secret Santa app's UI and authentication flow.

## Overview

This skill performs end-to-end visual testing by:
1. Launching a headless browser
2. Navigating to the app at localhost:3000
3. Automating the Firebase Emulator Auth sign-in flow
4. Verifying the Santa tab appears
5. Capturing screenshots with timestamps in `qa_artifacts/`

## Prerequisites

- **Development server running**: `npm run dev` (localhost:3000)
- **Firebase Emulators running**: `npm run emulators`
- **User initialized**: Test user (jed.piezas@gmail.com) should already have recipient assignment
- **Puppeteer**: Installed via npx (no package.json modification needed)

## Usage

### Quick Run (Recommended)

```bash
npx puppeteer@latest node scripts/visual_qa.js
```

This uses `npx` to download and run Puppeteer without adding it to package.json, keeping dependencies clean.

### Via Helper Script

```bash
./.claude/skills/visual-qa/run-visual-qa.sh
```

The helper script:
- Checks if server and emulators are running
- Runs the visual QA script via npx
- Reports results and screenshot locations

### Via npm Script (Optional)

Add to `package.json`:
```json
{
  "scripts": {
    "qa:visual": "npx puppeteer@latest node scripts/visual_qa.js"
  }
}
```

Then run: `npm run qa:visual`

## What It Tests

### 1. App Loading
- Navigates to http://localhost:3000
- Verifies page loads successfully
- Takes screenshot of landing page

### 2. Sign In Button
- Locates "Sign in with Google" button
- Verifies button is present and clickable

### 3. Firebase Auth Flow
- Clicks sign in button
- Detects auth popup window
- Attempts to sign in as jed.piezas@gmail.com
- Handles both existing account and new account flows

### 4. Post-Auth Navigation
- Waits for auth to complete
- Takes screenshot after authentication
- Handles recipient selection screen if needed

### 5. Tab Verification
- Looks for Santa tab (🎅 Santa)
- Looks for Recipient tab (🎁 Recipient)
- Looks for Public Feed tab (🎄 Public Feed)
- Captures screenshots of each tab

## Screenshot Artifacts

All screenshots are saved to `qa_artifacts/` with timestamp prefixes:

```
qa_artifacts/
├── 2025-12-04T10-30-00_01-landing-page.png
├── 2025-12-04T10-30-02_02-auth-popup.png
├── 2025-12-04T10-30-05_03-after-auth.png
├── 2025-12-04T10-30-06_05-santa-tab.png
├── 2025-12-04T10-30-07_06-recipient-tab.png
├── 2025-12-04T10-30-08_07-public-feed-tab.png
└── 2025-12-04T10-30-09_99-final-state.png
```

## Expected Output

### Successful Run

```
🎨 Secret Santa Visual QA Smoke Test
=====================================

ℹ️  Launching headless browser...
ℹ️  Navigating to http://localhost:3000...
✅ App loaded successfully
✅ Screenshot saved: 2025-12-04T10-30-00_01-landing-page.png
ℹ️  Looking for "Sign in with Google" button...
✅ Sign in button found
ℹ️  Clicking "Sign in with Google" button...
ℹ️  Auth popup detected
✅ Auth popup opened
✅ Auth popup screenshot saved
ℹ️  Attempting to sign in as jed.piezas@gmail.com...
ℹ️  Found existing test account, clicking it...
✅ Clicked existing account
✅ Authentication completed
ℹ️  Looking for Santa tab...
✅ Santa tab found!
✅ Santa tab screenshot captured
✅ Recipient tab screenshot captured
✅ Public Feed tab screenshot captured
✅ Screenshot saved: 2025-12-04T10-30-09_99-final-state.png
ℹ️  Browser closed

=====================================
Test Summary:
  Passed: 4
  Failed: 0
  Artifacts: /path/to/qa_artifacts
=====================================
```

## Error Handling

### Server Not Running

```
❌ Failed to load app - is the dev server running?
❌ Start with: npm run dev
```

### Emulator Not Running

The script will attempt auth but may fail. Ensure emulators are running:
```bash
npm run emulators
```

### Sign In Button Not Found

```
❌ Sign in button not found
```

Possible causes:
- Already authenticated (clear cookies)
- App error preventing UI render
- Page structure changed

### Auth Popup Timeout

```
❌ Failed to detect auth popup
```

Possible causes:
- Firebase emulator not running
- Popup blocked by browser
- Network issues

### Tabs Not Found

```
⚠️  Santa tab not found - user may need to be assigned a recipient first
```

Solution: Ensure test user has recipient assignment via admin panel or seed script.

## Limitations & Notes

### First-Time User Flow

If the test user has never signed in before, they'll see the recipient selection screen. The script will detect this and take a screenshot, but won't automatically select a recipient.

**Solution**: Run the admin assign command first:
```bash
# Via API with auth token
curl -X POST http://localhost:3000/api/admin/assign \
  -H "Authorization: Bearer TOKEN"
```

### Emulator Auth Persistence

Firebase Emulator auth state persists between runs. If you want to test fresh sign-in:
1. Stop emulators
2. Clear emulator data
3. Restart emulators

### Screenshot File Size

Full-page screenshots can be large (500KB - 2MB each). Monitor `qa_artifacts/` directory size.

## Headless vs Headed Mode

### Headless (Default)
- Fast, no GUI
- Suitable for CI/CD
- Currently configured: `headless: 'new'`

### Headed (Debugging)
To watch the test run, modify `scripts/visual_qa.js`:
```javascript
browser = await puppeteer.launch({
    headless: false,  // Change from 'new' to false
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

## Integration with CI/CD

For continuous integration:

```yaml
# .github/workflows/visual-qa.yml
- name: Run Visual QA
  run: |
    npm run emulators &
    npm run dev &
    sleep 5
    npx puppeteer@latest node scripts/visual_qa.js
```

**Note**: Requires headless environment with browser support.

## Customization

### Change Test User

Edit `scripts/visual_qa.js`:
```javascript
const TEST_EMAIL = 'your.email@example.com';
```

### Adjust Timeouts

```javascript
const TIMEOUT = 30000; // Increase for slower environments
```

### Add More Tests

Extend the script to test:
- Message sending
- Recipient selection
- Admin functions
- Public feed interactions

## Troubleshooting

### Puppeteer Download Issues

If npx fails to download Puppeteer:
```bash
# Set environment variable for custom download location
export PUPPETEER_SKIP_DOWNLOAD=false
npx puppeteer@latest node scripts/visual_qa.js
```

### waitForXPath Deprecation

Modern Puppeteer versions may deprecate `waitForXPath`. Alternative:
```javascript
await page.waitForSelector('button:has-text("Sign in with Google")');
```

### Memory Issues

For long-running tests or multiple runs:
```bash
# Clear artifacts periodically
rm -rf qa_artifacts/*
```

## Reference Files

- **Test script**: `scripts/visual_qa.js`
- **Helper script**: `.claude/skills/visual-qa/run-visual-qa.sh`
- **Artifacts directory**: `qa_artifacts/` (created automatically)
- **App page**: `src/app/page.js` (for UI selectors)

## Best Practices

1. **Run after deployment**: Verify UI changes didn't break core flows
2. **Keep artifacts**: Use screenshots for bug reports and documentation
3. **Clean regularly**: Delete old screenshots to save disk space
4. **Test in CI**: Automate visual QA in your deployment pipeline
5. **Update selectors**: Keep XPath/selectors in sync with UI changes
