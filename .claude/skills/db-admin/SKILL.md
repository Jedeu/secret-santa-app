---
name: db-admin
description: Reset and seed the Secret Santa database for testing. Use when you need to clear all data and start fresh, or populate the database with initial participant data.
allowed-tools: [Bash, Read]
---

# Database Admin Skill

Manages database operations for the Secret Santa app including reset and seed operations.

## Prerequisites

- **Firebase Emulators running**: `npm run emulators` must be active
- **Server running**: Development server at `localhost:3000` (via `npm run dev`)
- **For reset operations**: Valid Firebase auth token for admin user (jed.piezas@gmail.com)

## Operations

### 1. Seed Database (Recommended First Step)

Seeds the database with all participants from the hardcoded list.

**When to use**:
- Initial setup after starting emulators
- After a database reset
- When participant documents are missing

**Command**:
```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed_users.js
```

**Expected output**:
```
🔥 Connected to Firestore Emulator at 127.0.0.1:8080
🌱 Seeding users...
✅ Created user: Jed (jed.piezas@gmail.com)
✅ Created user: Natalie (ncammarasana@gmail.com)
...
✨ Seeding complete!
```

**Error handling**:
- If emulator not running: Script will fail to connect
- If users exist: Will skip with "ℹ️ User already exists" message

### 2. Reset Database (Destructive Operation)

Deletes ALL data (users, messages, assignments) and re-initializes participants.

**When to use**:
- Need to completely clear test data
- Want to restart Secret Santa assignments
- Testing from a clean slate

**Method**: POST request to `/api/admin/reset`

**Requirements**:
- Admin authentication token from Firebase Auth
- Server must be running at localhost:3000

**Getting the auth token**:

Option A - From Browser Console (if logged in):
```javascript
// Run in browser console while logged into the app
const token = await firebase.auth().currentUser.getIdToken();
console.log(token);
```

Option B - From the emulator (development only):
The Firebase Auth emulator accepts development tokens. Create a helper script if needed.

**Command with token**:
```bash
curl -X POST http://localhost:3000/api/admin/reset \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

**Expected response** (success):
```json
{
  "success": true,
  "message": "Database reset and participants re-initialized"
}
```

**Expected response** (error - server not running):
```
curl: (7) Failed to connect to localhost port 3000: Connection refused
```

**Expected response** (error - unauthorized):
```json
{
  "error": "Unauthorized: Admin access required"
}
```

## Common Workflows

### Initial Setup Workflow
```bash
# 1. Start emulators (in one terminal)
npm run emulators

# 2. Start dev server (in another terminal)
npm run dev

# 3. Seed the database
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed_users.js
```

### Fresh Start Workflow (with reset)
```bash
# 1. Ensure server is running (localhost:3000)
# 2. Get auth token from browser console
# 3. Reset database
curl -X POST http://localhost:3000/api/admin/reset \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json"

# Note: Reset endpoint automatically re-seeds participants
```

### Quick Re-seed (without reset)
```bash
# Use when you just need to ensure all participants exist
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed_users.js
```

## Error Handling

### Server Not Running
```bash
# Check if server is running
curl -f http://localhost:3000 > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Server not running at localhost:3000"
  echo "Start with: npm run dev"
  exit 1
fi
```

### Emulator Not Running
```bash
# Check if Firestore emulator is running
lsof -i :8080 > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Firebase Emulator not running on port 8080"
  echo "Start with: npm run emulators"
  exit 1
fi
```

## Implementation Details

### Reset Operation (API Route)
- **File**: `src/app/api/admin/reset/route.js`
- **Auth**: Verifies Firebase ID token and checks for admin email (jed.piezas@gmail.com)
- **Actions**:
  1. Calls `resetDatabase()` to delete all collections
  2. Calls `ensureAllParticipants()` to recreate participant documents
- **Side effects**: Deletes users, messages, and all assignments

### Seed Operation (Script)
- **File**: `scripts/seed_users.js`
- **Auth**: None required (direct Firestore access)
- **Actions**: Creates user documents for all participants in `PARTICIPANTS` array
- **Idempotent**: Checks if user exists before creating, skips duplicates

## Security Notes

- Reset endpoint requires admin authentication (jed.piezas@gmail.com)
- Seed script requires direct Firestore access (emulator or production)
- Never expose auth tokens in commits or logs
- Development tokens from emulator should not be used in production

## Reference Files

- Reset API: `src/app/api/admin/reset/route.js`
- Seed script: `scripts/seed_users.js`
- Participants list: `src/lib/participants.js`
- Firestore operations: `src/lib/firestore.js`
