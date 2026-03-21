# AI Intelligence Hub

Node.js/Express application serving AI trend data from multiple sources via SQLite FTS5.

## Stack
- Node.js, Express
- SQLite with FTS5 full-text search
- Vanilla JS frontend

## Key Commands
- `node server.js` — Start server on port 4444
- `npm run fetch` — Fetch latest data from all sources
- `npm test` — Run tests

## Project Structure
- `server.js` — Express server + API routes
- `data/hub.db` — SQLite database
- `public/` — Frontend assets
- `sources/` — Source fetcher modules

## Rules
- Never modify hub.db schema without migration
- All new sources need a fetcher in sources/
- Keep API responses under 100ms
