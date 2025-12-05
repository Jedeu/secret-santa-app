# DB Admin Skill

Database administration skill for the Secret Santa app.

## Quick Start

### Seed Database (Simple)
```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed_users.js
```

### Reset Database (Interactive)
```bash
./.claude/skills/db-admin/reset-helper.sh
```

Or manually:
```bash
curl -X POST http://localhost:3000/api/admin/reset \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

## Files

- **SKILL.md**: Complete skill definition and documentation
- **reset-helper.sh**: Interactive script for database reset
- **README.md**: This file

## Usage

Claude Code will automatically discover this skill when you ask questions like:
- "Reset the database"
- "Seed the database with test users"
- "Clear all data and start fresh"
- "Initialize the database"

You can also manually invoke with the Skill tool if needed.
