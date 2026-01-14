---
name: ops-runner
description: Handle project operations, build validation, and PWA asset generation. Use for lint checks, Next.js builds, and PWA asset management.
allowed-tools: [Bash, Read]
---

# Ops Runner Skill

Handles project operations, build validation, and PWA asset generation.

## Overview

This skill provides three core operations for maintaining code quality and PWA readiness:
- **Lint**: Verify code syntax and style with ESLint
- **Build**: Verify the Next.js production build succeeds
- **PWA Assets**: Generate or validate PWA icons and manifest

## Commands

### Run via Script

```bash
# Run ESLint
.claude/skills/ops-runner/run-ops.sh lint

# Run Next.js Build
.claude/skills/ops-runner/run-ops.sh build

# Generate/Check PWA assets
.claude/skills/ops-runner/run-ops.sh pwa
```

### Direct Commands

```bash
# Lint
npm run lint

# Build
npm run build

# PWA asset check (if manifest exists)
test -f public/manifest.json && echo "Manifest OK" || echo "Manifest missing"
```

## Command Details

### 1. Lint (`lint`)

Runs ESLint to check for code quality issues.

**Command**: `npm run lint`

**Expected Output**:
```
✅ Lint passed - no errors found
```

**On Failure**:
```
❌ Lint failed
[Error details from ESLint]

Fix the errors above before proceeding.
```

**Common Issues**:
- Unused variables: Remove or prefix with `_`
- Missing imports: Add required import statements
- Formatting: Run `npm run lint -- --fix` for auto-fixable issues

### 2. Build (`build`)

Runs the Next.js production build to verify the app compiles correctly.

**Command**: `npm run build`

**Expected Output**:
```
✅ Build succeeded
   Creating an optimized production build...
   Compiled successfully
```

**On Failure**:
```
❌ Build failed
[Error details from Next.js]

Review the errors above. Common causes:
- Import errors (missing modules)
- TypeScript errors (if using TS)
- Dynamic code issues (server/client mismatch)
```

**When to Run**:
- After modifying `next.config.js`
- After adding/removing dependencies
- After PWA configuration changes
- Before deployment

### 3. PWA Assets (`pwa`)

Validates or generates PWA assets (manifest, icons).

**Validation Checks**:
1. `public/manifest.json` exists and is valid JSON
2. `public/icons/` directory exists
3. Required icon sizes present (192x192, 512x512)
4. Apple touch icon exists

**Commands**:
```bash
# Check manifest exists and is valid JSON
if [ -f public/manifest.json ]; then
    if node -e "JSON.parse(require('fs').readFileSync('public/manifest.json'))"; then
        echo "✅ manifest.json is valid"
    else
        echo "❌ manifest.json has invalid JSON"
    fi
else
    echo "❌ manifest.json missing"
fi

# Check icons directory
if [ -d public/icons ]; then
    echo "✅ Icons directory exists"
    ls -la public/icons/
else
    echo "❌ Icons directory missing"
fi
```

**Icon Generation** (if ImageMagick available):
```bash
# Create placeholder icons with theme color
convert -size 192x192 xc:'#e94560' public/icons/icon-192x192.png
convert -size 512x512 xc:'#e94560' public/icons/icon-512x512.png
convert -size 180x180 xc:'#e94560' public/icons/apple-touch-icon.png
```

**Fallback** (if ImageMagick not available):
```bash
# Create minimal valid PNG files using base64-encoded 1x1 PNG
# The agent should note that proper icons need to be added later
echo "⚠️ ImageMagick not available - placeholder icons created"
echo "TODO: Replace with proper icon designs"
```

## Usage Examples

### Example 1: Quick Lint Check
**User**: "Check the code"

**Claude executes**:
```bash
.claude/skills/ops-runner/run-ops.sh lint
```

### Example 2: Full Build Validation
**User**: "Verify the build works"

**Claude executes**:
```bash
.claude/skills/ops-runner/run-ops.sh build
```

### Example 3: PWA Readiness Check
**User**: "Check PWA assets"

**Claude executes**:
```bash
.claude/skills/ops-runner/run-ops.sh pwa
```

### Example 4: Full Ops Check (All Three)
**User**: "Run all checks"

**Claude executes**:
```bash
.claude/skills/ops-runner/run-ops.sh lint && \
.claude/skills/ops-runner/run-ops.sh build && \
.claude/skills/ops-runner/run-ops.sh pwa
```

## Integration with Ralph Wiggum Loop

When running in autonomous loop mode, this skill should be used:

1. **After every code change**: Run `lint`
2. **After config changes**: Run `build`
3. **After PWA file changes**: Run `pwa`

The loop should halt and attempt fixes if any operation fails.

## Error Recovery

### Lint Failures
```bash
# Auto-fix what can be fixed
npm run lint -- --fix

# Then re-run to see remaining issues
npm run lint
```

### Build Failures
1. Check the error output for the specific file/line
2. Common fixes:
   - Missing dependencies: `npm install <package>`
   - Import errors: Check file paths and exports
   - Server/client mismatch: Add `'use client'` directive

### PWA Asset Issues
1. Create missing directories: `mkdir -p public/icons`
2. Generate placeholder icons (see commands above)
3. Validate manifest JSON structure

## Reference Files

- **ESLint config**: `eslint.config.mjs`
- **Next.js config**: `next.config.js`
- **PWA manifest**: `public/manifest.json`
- **PWA icons**: `public/icons/`
- **Package scripts**: `package.json` (scripts section)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - operation completed without errors |
| 1 | Failure - lint/build/pwa check failed |
| 2 | Invalid command - unrecognized operation |

## Best Practices

1. **Always lint after editing**: Catch issues immediately
2. **Build before committing**: Ensure production readiness
3. **Validate PWA after manifest changes**: Prevent broken installs
4. **Fix errors immediately**: Don't accumulate technical debt
5. **Run all ops before PR**: Full validation before merge
