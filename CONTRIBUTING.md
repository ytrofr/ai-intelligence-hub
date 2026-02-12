# Contributing to AI Intelligence Hub

Thank you for your interest in contributing! This guide helps you get started.

## How to Contribute

### Adding a New Source

The most impactful contribution is adding new AI trend sources:

1. Create a module in `modules/` extending `BaseModule` (see `modules/base-module.js`)
2. Implement the `fetch()` method returning normalized items
3. Register it in `modules/index.js`
4. Add source config to `config/sources.json`
5. Add badge CSS in `public/css/components.css`

### Reporting Issues

- Use [GitHub Issues](https://github.com/ytrofr/ai-intelligence-hub/issues)
- Check existing issues first
- Include your Node.js version and OS

### Pull Requests

1. Fork the repository and create your branch from `main`
2. Follow the existing modular architecture (routes, modules, database)
3. Test your changes: `npm start` and verify on `http://localhost:4444`
4. Keep PRs focused — one feature or fix per PR

## Development Setup

```bash
git clone https://github.com/ytrofr/ai-intelligence-hub.git
cd ai-intelligence-hub
npm install
node server.js
# Open http://localhost:4444
```

## Architecture

```
server.js          → Express entry point (port 4444)
modules/           → Source fetchers (BaseModule pattern)
config/            → Source definitions + keyword scoring
database/          → SQLite with FTS5 full-text search
routes/            → Express API routes
public/            → Frontend (vanilla JS, no build step)
```

## Code Style

- Vanilla JavaScript (no TypeScript, no build step)
- Express routes in `routes/` directory
- Database operations in `database/db.js`
- Each source module extends `BaseModule`
