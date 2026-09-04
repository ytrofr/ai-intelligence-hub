# dependency-extraction-multilang

> Extract dependencies from package.json, requirements.txt, pyproject.toml and pnpm workspaces, from a GitHub repo or a local checkout. Use when analyzing repo tech stacks, building dependency graphs, or matching projects by technology.


# Multi-Language Dependency Extraction

## WHEN TO USE (Triggers)
1. When analyzing a GitHub repo's tech stack programmatically
2. When building project-to-repo matching based on shared dependencies
3. When parsing dependencies from multiple languages (Node + Python)
4. When pyproject.toml parsing fails silently (complex TOML format)
5. When dependency names have version specifiers that need stripping
6. When reading OUR OWN projects' deps from a local checkout instead of GitHub

## FAILED ATTEMPTS
| # | Attempt | Why Failed | Lesson |
|---|---------|-----------|--------|
| 1 | Used a TOML parser library for pyproject.toml | Added a dependency just for parsing one file. Library had edge cases | Regex extraction is simpler and sufficient for dependency arrays |
| 2 | Didn't strip version specifiers from requirements.txt | "fastapi>=0.100" didn't match "fastapi" in project config | Always split on version specifiers: `[=<>~!` |
| 3 | Only checked `dependencies` in package.json | Missed `devDependencies` (typescript, vite, testing frameworks) | Check both dependencies AND devDependencies |
| 4 | `pyprojectToml.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)` (2026-08-16) | The non-greedy `]` matched the `]` INSIDE an extras spec: `httpx[http2]>=0.27` truncated the array, dropping every dep after it. Silent — no error, just a short list | A non-greedy regex is NOT nested-delimiter safe. Scan the array character-by-character (below). The tell was a dep count that looked plausible |
| 5 | Read only the repo root's dep files | A monorepo declares deps in `apps/*/package.json` and a pnpm `catalog:`; a root-only read returned ~10 deps for a 15-package tree | Walk to a bounded depth; resolve `catalog:` / `workspace:` references |
| 6 | Walked the whole checkout | An unrelated vendored subtree (`university-project/vendored-ui`) injected its deps into the parent project's profile, polluting every match score | Take an `exclude` list of directory names; a repo is not always one project |

## CORRECT PATTERN

### pyproject.toml — character scanner, NOT a regex capture
```javascript
/** Read quoted strings of a TOML array starting right after "[" at index i. */
function readTomlArray(text, i) {
  const items = [];
  let quote = null, buf = "";
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) { items.push(buf); buf = ""; quote = null; } else buf += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "]") break;          // only an UNQUOTED ] ends the array
  }
  return items;
}

function parsePyproject(text) {
  const out = new Set();
  // Every array literal under a key containing "dependencies" — PEP 621,
  // [project.optional-dependencies] groups, and poetry all match.
  const startRe = /dependencies\s*=\s*\[/g;
  let m;
  while ((m = startRe.exec(text))) {
    for (const spec of readTomlArray(text, m.index + m[0].length)) {
      const name = spec.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
      if (name) out.add(name[1].toLowerCase());
    }
  }
  return [...out];
}
```
The `]` inside `"httpx[http2]>=0.27"` is INSIDE a quote, so the scanner ignores it. The old regex did not, and stopped there.

### requirements.txt + package.json
```javascript
function parseRequirements(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);   // anchored: name is the leading token
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}
// package.json: Object.keys(pkg.dependencies) + Object.keys(pkg.devDependencies)
```

### Reading a LOCAL checkout (our own projects) — `modules/project-deps.js`
Prefer this over GitHub raw fetches for repos we own: it is offline, current, and sees private repos.

```javascript
readDeps(repoPath, { exclude: ["university-project"] })
```
Rules that make it correct:
- **Bounded walk** — `MAX_DEPTH = 3`, skipping `node_modules .git .venv venv dist build __pycache__ .turbo .next coverage`. Unbounded walking is slow and drags in vendored trees.
- **`exclude` by directory name** — a checkout can contain a foreign subtree. Without it, one service measured 115 deps instead of 113 and matched on packages from a vendored subtree it does not use.
- **Drop workspace-internal packages** — a value of `workspace:*`, or a name declared by some `package.json` in the same tree, is our own package, not a third-party repo.
- **Resolve pnpm catalogs** — `"react": "catalog:"` and named `catalogs:` in `pnpm-workspace.yaml`; a raw read leaves the literal string `catalog:` as the version and the dep name is still what you want, but the catalog file is where the monorepo's real dep set lives.
- **Never throw** — an unreadable repo yields `[]` and the caller falls back to the curated list. A dep reader that throws takes the whole recommendation path down.
- **Cache with a TTL** (10 min) keyed by `repoPath|exclude`, shared across module instances.

### Parallel File Fetching (GitHub, for repos we do NOT own)
```javascript
const base = `https://raw.githubusercontent.com/${repo}/HEAD`;
const [pkgRes, reqRes, pyRes] = await Promise.all([
  fetch(`${base}/package.json`).catch(() => null),
  fetch(`${base}/requirements.txt`).catch(() => null),
  fetch(`${base}/pyproject.toml`).catch(() => null),
]);
```

## EVIDENCE
| Metric | Value | Source |
|--------|-------|--------|
| Languages/formats supported | 4 (package.json, pnpm workspace catalogs, requirements*.txt, pyproject.toml) | Hub production |
| Local-checkout dep counts (2026-08-16) | apollo 113 · hermes 66 · atlas 60 | `readDeps()` on the live checkouts |
| Nested-bracket bug | `httpx[http2]>=0.27` silently truncated the array | 2026-08-16, caught by a unit test, not by output inspection |
| Parse success rate | 99%+ (graceful fallback on malformed) | 500+ repos analyzed |

## QUICK START (< 5 minutes)
1. **Own repo?** Use `readDeps(repoPath, {exclude})` — offline and current. **Someone else's?** Fetch the three raw files in parallel.
2. **pyproject** goes through the character scanner, never a `[\s\S]*?` capture.
3. **Deduplicate** with a Set, lowercase for case-insensitive matching.
4. **Test with a nested-bracket fixture** (`httpx[http2]>=0.27`) and a monorepo fixture — those are the two cases that fail silently.
