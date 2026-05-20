# Verification — Hub Health Checks

**Scope**: ai-intelligence-hub
**Authority**: Pre-commit and session-start verification

---

## Quick Health Check

```bash
curl -sf localhost:4444/api/health | jq .
# Expected: {"status":"ok",...}
# NOTE: endpoint is /api/health — bare /health 404s on this Hub
```

## Pre-Commit Checks

1. `node --check server.js` — syntax OK
2. `curl -sf localhost:4444/api/recommendations?project=ogas` — API responds
3. No `.env` or API keys in staged files: `git diff --cached --name-only | grep -E '\.env$|secret|key'`

## Module Integrity

- `modules/github-discovery.js` — 22 sources, 5 projects, 31 queries
- SQLite FTS5 tables: `sources`, `items`, `recommendations`

## Source-Module Parity Check (session-start)

Catches enabled DB sources whose `type` has no module registered in `moduleTypes` — the failure class that produced `Unknown module type: custom` on nightly fetches (knowledge-harvest orphan, 2026-05-19).

```bash
cd ~/ai-intelligence-hub && node -e "
const db = require('better-sqlite3')('data/hub.db');
const { moduleTypes } = require('./modules');
const types = Object.keys(moduleTypes);
const enabled = db.prepare(\"SELECT id, type FROM sources WHERE enabled=1\").all();
const orphans = enabled.filter(s => !types.includes(s.type));
if (orphans.length) {
  console.error('ORPHAN sources (enabled, but type not in moduleTypes):');
  orphans.forEach(o => console.error('  -', o.id, '(type=' + o.type + ')'));
  process.exit(1);
}
console.log('OK:', enabled.length, 'enabled sources, all types registered (' + types.length + ' module types)');
"
```

**Action on orphan**: either `UPDATE sources SET enabled=0` (if integration not yet built) OR build the missing module (extend `BaseModule`, register in `moduleTypes`). Never leave an enabled source pointing at an unregistered type — every fetch errors.

---

**Last Updated**: 2026-05-19 (+source-module parity check; corrected /health → /api/health)
