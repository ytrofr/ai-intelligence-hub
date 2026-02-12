# AI Intelligence Hub

**Track AI trends from 12 sources in one dashboard.** GitHub Trending, HuggingFace, MCP Servers, Claude Code Releases, and more — with full-text search and keyword scoring.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Port](https://img.shields.io/badge/Port-4444-blue.svg)]()
[![Sources](https://img.shields.io/badge/Sources-12-purple.svg)]()

---

## Quick Start

```bash
git clone https://github.com/ytrofr/ai-intelligence-hub.git
cd ai-intelligence-hub
npm install
node server.js
# Open http://localhost:4444
```

No external services required. All 12 sources use free, unauthenticated APIs.

> **Optional**: Add a `GITHUB_TOKEN` in `.env` to increase GitHub API rate limit from 60/h to 5,000/h. See `.env.example`.

---

## Features

- **12 AI Sources** — GitHub Trending repos, HuggingFace models, MCP server registry, Claude Code releases and docs, Hacker News, Product Hunt, Anthropic Blog, OpenAI Blog, TechCrunch AI, MIT AI News
- **Full-Text Search** — SQLite FTS5 indexes all items for instant keyword search
- **Keyword Scoring** — Configurable categories with weighted keywords rank items by relevance
- **Bookmarks** — Save items for later with persistent bookmarks
- **Modular Architecture** — Add new sources by extending `BaseModule` (one file per source)
- **Zero Build Step** — Vanilla JavaScript frontend, no bundler or framework required
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

---

## Architecture

```
server.js (port 4444)
├── modules/           # Source fetchers (BaseModule pattern)
│   ├── base-module.js # Abstract base with normalize()
│   ├── github.js      # GitHub trending repos
│   ├── huggingface.js # HuggingFace models
│   ├── rss.js         # RSS/Atom feeds (7 sources)
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
└── public/            # Frontend (vanilla JS)
    ├── index.html     # Single-page dashboard
    ├── css/           # Styles (variables, layout, components)
    └── js/            # App logic (api, filters, ui, icons)
```

---

## API Reference

| Method | Endpoint         | Description                     |
| ------ | ---------------- | ------------------------------- |
| GET    | `/`              | Dashboard UI                    |
| GET    | `/api/items`     | List items (paginated, filters) |
| POST   | `/api/fetch`     | Trigger fetch from sources      |
| GET    | `/api/sources`   | List configured sources         |
| GET    | `/api/bookmarks` | List bookmarked items           |
| GET    | `/api/stats`     | Dashboard statistics            |
| GET    | `/api/search`    | Full-text search (FTS5)         |
| GET    | `/api/health`    | Health check                    |

---

## Adding a New Source

1. Create a module in `modules/` extending `BaseModule`
2. Implement the `fetch()` method returning normalized items
3. Register it in `modules/index.js`
4. Add source config to `config/sources.json`
5. Add badge CSS in `public/css/components.css`

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
A: No. All 12 sources use free, unauthenticated APIs. Optionally add a `GITHUB_TOKEN` for higher GitHub rate limits (60/h free, 5,000/h with token).

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

---

## License

[MIT](LICENSE)
