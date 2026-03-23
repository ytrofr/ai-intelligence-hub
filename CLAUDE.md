# AI Intelligence Hub

Node.js/Express application serving AI trend data from 22 sources via SQLite FTS5. Includes GitHub Discovery module with project-aware relevance scoring.

## Stack
- Node.js, Express, port 4444
- SQLite with FTS5 full-text search (better-sqlite3)
- Vanilla JS frontend (no framework)
- GitHub API (requires GITHUB_TOKEN in .env)

## Key Commands
- `node server.js` — Start server on port 4444
- `curl -X POST localhost:4444/api/fetch` — Fetch from all sources
- `curl localhost:4444/api/recommendations?project=ogas` — Get project recommendations

## Project Structure
- `server.js` — Express server + route mounting
- `modules/` — Source fetcher modules (BaseModule pattern)
  - `github.js` — Topic-based GitHub trending
  - `github-discovery.js` — 3-strategy project-aware discovery (tech-stack, curated-lists, rising-stars)
  - `changelog.js` — GitHub releases + docs
  - `rss.js`, `huggingface.js`, `mcp-registry.js`
- `config/sources.json` — 22 source definitions
- `config/projects.json` — 5 project tech stacks for discovery scoring
- `config/keywords.json` — 6 scoring categories
- `routes/` — API endpoints (items, fetch, sources, bookmarks, stats, search, recommendations)
- `database/` — SQLite schema + prepared statements
- `public/` — Vanilla JS dashboard
- `handoffs/` — Per-project adoption recommendations (gitignored)
- `data/hub.db` — SQLite database (gitignored)

## Discovery Module
- 3 strategies: tech-stack search (31 queries), curated list mining (3 sources), rising stars (by language)
- Weighted scoring: domain-specific deps = 5.0, generic deps (React/Tailwind) = 0.5
- Rate limit safe: ~80 API calls per 6hr cycle (0.7% of 5000/hr budget)
- REQUIRES `GITHUB_TOKEN` in `.env` — refuses to run without it

## Rules
- Never modify hub.db schema without migration
- All new sources extend BaseModule in modules/
- Keep API responses under 100ms
- GITHUB_TOKEN in .env only, never in code or commits
- handoffs/ and data/ are gitignored — internal context only
