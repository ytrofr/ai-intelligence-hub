# AI Intelligence Hub

**Track AI trends from 24 live sources in one dashboard, and turn them into per-project adoption decisions.** GitHub Trending, HuggingFace, MCP Servers, Claude Code Releases, Anthropic Skills & Cookbooks, arXiv, Google AI Blog, Simon Willison, and more — with full-text search and keyword scoring.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Port](https://img.shields.io/badge/Port-4444-blue.svg)]()
[![Sources](https://img.shields.io/badge/Sources-24-purple.svg)]()

---

## Quick Start

```bash
git clone https://github.com/ytrofr/ai-intelligence-hub.git
cd ai-intelligence-hub
npm install
npm --prefix web install
npm run build                                          # builds the front end into dist/
cp config/projects.example.json config/projects.json   # then edit with your own projects
node server.js
# Open http://localhost:4444
```

> The front end is a **build**, not a directory of pages. `dist/` is gitignored, so a fresh
> clone has no UI until `npm run build` produces one — the server says so on startup rather
> than serving 404s that read like a broken app. While working on it, `npm --prefix web run
> watch` rebuilds on save and `npm --prefix web run test:watch` is the fast component loop.
> There is deliberately no dev server: the app is served from the same origin as the API, so
> there is no proxy, no CORS and no second port.

> `config/projects.json` is gitignored — it holds your personal project portfolio. The repo ships `config/projects.example.json` as a template; copy it and customize the `projects` array. The `claude-ecosystem` entry works as-is. `config/radar/*.json` is gitignored for the same reason — see `config/radar/example.json` for the schema.

No paid services required. Most sources are free feeds/APIs; GitHub discovery wants a `GITHUB_TOKEN`. Every fetch reports per-source status honestly (`success|error|timeout|rate_limited`) — a dead feed is an error, never an empty success.

> **Optional**: Add a `GITHUB_TOKEN` in `.env` to increase GitHub API rate limit from 60/h to 5,000/h. See `.env.example`.

---

## Features

- **24 live sources** — GitHub Trending repos, HuggingFace models, MCP server registry, Claude Code releases and docs, Anthropic Skills Library, Claude Cookbooks, arXiv CS.AI, Google AI Blog, Simon Willison, MarkTechPost, The Gradient, Hacker News, Product Hunt, Anthropic Blog, OpenAI Blog, TechCrunch AI, MIT AI News, AI News
- **Full-Text Search** — SQLite FTS5 indexes all items for instant keyword search
- **Keyword Scoring** — Configurable categories with weighted keywords rank items by relevance
- **Bookmarks** — Save items for later with persistent bookmarks
- **Modular Architecture** — Add new sources by extending `BaseModule` (one file per source)
- **One design system** — React + shadcn/ui on a token contract a test pins, so a theme cannot silently revert to stock
- **Colour is never the only channel** — every verdict carries a shape and a word as well as a hue
- **A design-system page** — `/design` reads the live stylesheet and measures every ink/surface pair in the theme you are in
- **Self-Contained** — SQLite database, no external database or service dependencies

---

## Sources

| Source               | Type        | Refresh | What It Tracks                     |
| -------------------- | ----------- | ------- | ---------------------------------- |
| GitHub Trending      | github      | 60 min  | AI/LLM/MCP repos ranked by stars   |
| HuggingFace          | huggingface | 30 min  | Trending ML models                 |
| Hacker News          | rss         | 5 min   | Front page tech news               |
| Product Hunt         | rss         | 15 min  | New product launches               |
| AI News              | rss         | 60 min  | AI industry newsletter             |
| Anthropic Blog       | rss         | 60 min  | Official Anthropic announcements   |
| OpenAI Blog          | rss         | 60 min  | OpenAI research and updates        |
| MCP Servers          | mcp         | 30 min  | MCP server registry (glama.ai)     |
| TechCrunch AI        | rss         | 15 min  | AI category from TechCrunch        |
| MIT AI News          | rss         | 60 min  | MIT AI research                    |
| Claude Code Releases | changelog   | 60 min  | GitHub releases with version notes |
| Claude Code Docs     | changelog   | 360 min | 98 documentation pages             |
| Anthropic Skills     | changelog   | 360 min | Official skill library (16 skills) |
| Claude Cookbooks     | changelog   | 360 min | Agent patterns and notebooks       |
| arXiv CS.AI          | rss         | 60 min  | AI research papers                 |
| Simon Willison       | rss         | 60 min  | AI developer blog                  |
| Google AI Blog       | rss         | 60 min  | Google AI research and products    |
| MarkTechPost         | rss         | 60 min  | ML research summaries              |
| The Gradient         | rss         | 60 min  | In-depth AI research analysis      |

---

## Architecture

```
server.js (port 4444)
├── modules/           # Source fetchers (BaseModule pattern)
│   ├── base-module.js # Abstract base with normalize()
│   ├── github.js      # GitHub trending repos
│   ├── huggingface.js # HuggingFace models
│   ├── rss.js         # RSS/Atom feeds (12 sources)
│   ├── mcp-registry.js# MCP server registry
│   └── changelog.js   # Claude Code releases + docs
├── config/
│   ├── sources.json   # Source definitions (URL, type, refresh)
│   └── keywords.json  # Scoring categories and weights
├── database/          # SQLite with FTS5 full-text search
│   ├── db.js          # Database operations
│   └── schema.sql     # Table definitions
├── routes/            # Express API routes
│   ├── items.js       # List/filter items
│   ├── fetch.js       # Trigger source fetches
│   ├── sources.js     # Source management
│   ├── bookmarks.js   # Bookmark CRUD
│   ├── stats.js       # Dashboard statistics
│   └── search.js      # FTS5 search + suggestions
└── web/               # Frontend (React + Vite + Tailwind + shadcn/ui)
    ├── index.html     # the ONE html file
    ├── src/styles/    # tokens.css (the design contract) + the ramp
    ├── src/components/ui/    # shadcn-generated, never hand-edited
    ├── src/components/app/   # AppSidebar, PageShell, DataTable, StateChip …
    ├── src/features/  # one directory per destination
    └── src/lib/       # api.ts (the only fetch) + pure helpers
        ↓  npm run build
    dist/              # what Express serves (gitignored)
```

The front end has its own `package.json` on purpose rather than being a workspace: the
server ships three runtime dependencies and nothing in the UI toolchain may change that
tree.

---

## The app

Ten destinations plus the design system, all served from one bundle on 4444. `nav.ts` is the
single list the sidebar, the breadcrumbs and the router all read, so a nav entry cannot point
at a route that does not exist.

| Route | What it is |
| --- | --- |
| `/` | Items - everything the fetchers found, newest first |
| `/digests` | The written-up version, one per week |
| `/discovery` | What to look at next, and why |
| `/projects` | Every project, five numbers each |
| `/inventory` | Live dependency counts, read from the checkouts |
| `/p/:project` | What this project needs and what we have for it |
| `/p/:project/matrix` | Candidates ranked, with the gates each still owes |
| `/p/:project/stack` | Every repo we use, how it turned out, what it taught us |
| `/p/:project/radar` | Proposed, tried, adopted or refused |
| `/p/:project/ground-truth` | Every instrument, and when it last actually said something |
| `/design` | The design system: tokens as the browser resolves them, contrast measured, every shared component |

Every address the pre-rebuild HTML version used still resolves, `?project=` and all.

---

## API Reference

| Method | Endpoint                | Description                                    |
| ------ | ----------------------- | ---------------------------------------------- |
| GET    | `/api/items`            | List items (paginated, filtered)               |
| GET    | `/api/search`           | Full-text search (FTS5)                        |
| GET    | `/api/bookmarks`        | Saved items                                    |
| GET    | `/api/digest`           | Weekly digests; `/api/digest/:date` is markdown |
| GET    | `/api/recommendations`  | What to look at next, and why                  |
| GET    | `/api/projects-hub`     | Every project, five numbers each                |
| GET    | `/api/adoption-matrix`  | Candidates ranked, with the gates they owe     |
| GET    | `/api/ledger`           | Every repo used, how it turned out             |
| GET    | `/api/radar`            | The adoption queue; POST `/status` to move a row |
| GET    | `/api/ground-truth`     | Every instrument and when it last spoke        |
| GET    | `/api/inventory`        | Live dependency counts, read from the checkouts |
| GET    | `/api/tracked`          | Upstream repos being watched                   |
| GET    | `/api/sources`          | Configured sources and their last status       |
| POST   | `/api/fetch`            | Trigger a fetch                                |
| GET    | `/api/stats`            | Dashboard statistics                           |
| GET    | `/api/health`           | `healthy` or `degraded`, with the failing count |

---

## Adding a New Source

1. Create a module in `modules/` extending `BaseModule`
2. Implement the `fetch()` method returning normalized items
3. Register it in `modules/index.js`
4. Add source config to `config/sources.json`
5. Add its brand colour to `BRAND` in `web/src/components/app/SourceBadge.tsx` - the badge's ink is derived from it per theme, so a new source cannot ship unreadable

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Configuration

### Keyword Scoring

Edit `config/keywords.json` to customize scoring categories:

```json
{
  "categories": [
    {
      "id": "mcp",
      "label": "MCP & Tools",
      "keywords": ["mcp", "model context protocol", "tool-use"],
      "weight": 3
    }
  ]
}
```

### Source Configuration

Edit `config/sources.json` to add or modify sources:

```json
{
  "sources": [
    {
      "id": "github-trending",
      "name": "GitHub Trending",
      "type": "github",
      "url": "https://api.github.com/search/repositories",
      "refresh_minutes": 60
    }
  ]
}
```

---

## Requirements

- **Node.js 18+**
- No external databases (SQLite is embedded)
- No API keys required (all sources use free APIs)
- Optional: GitHub personal access token for higher rate limits

---

## FAQ

**Q: What port does the Intelligence Hub run on?**
A: Port 4444. This is hardcoded in `server.js` and does not conflict with other common development ports.

**Q: Do I need any API keys?**
A: No. Every source uses a free, unauthenticated API. Optionally add a `GITHUB_TOKEN` for higher GitHub rate limits (60/h free, 5,000/h with token).

**Q: How is data stored?**
A: SQLite with FTS5 (full-text search). The database is created automatically on first run. No setup needed.

**Q: Can I add my own sources?**
A: Yes. Create a module extending `BaseModule`, register it, and add config. See [CONTRIBUTING.md](CONTRIBUTING.md).

**Q: Is there a hosted version?**
A: No. This is a local-first tool designed to run on your machine. Your data stays on your machine.

---

## Built With

- [Express](https://expressjs.com/) — Web framework for Node.js
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Synchronous SQLite3 with FTS5 support
- [xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) — XML/RSS feed parser

The front end, whose dependencies are deliberately in their own `package.json` so none of
them can reach the server's three:

- [React](https://react.dev/) + [React Router](https://reactrouter.com/) — UI and routing
- [Vite](https://vitejs.dev/) — the build; no dev server, see Quick Start
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) — the design system
- [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/) — component tests

---

## License

[MIT](LICENSE)
