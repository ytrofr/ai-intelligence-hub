/**
 * Project Deps - read a project's REAL dependencies from its repo checkout.
 *
 * Sources: package.json (deps + devDeps), pnpm-workspace.yaml (catalog +
 * named catalogs), requirements*.txt, pyproject.toml (PEP 621 + optional +
 * poetry). Walks to a bounded depth, skips node_modules/.git/venv/dist.
 * Workspace-internal packages (values "workspace:*" or names declared by a
 * package.json in the tree) are dropped - they are not third-party repos.
 *
 * Never throws: an unreadable repo yields [] and the caller falls back to
 * the curated list in config/projects.json. Zero dependencies (no TOML/YAML
 * lib) - our own repos are regular enough for line/regex parsing.
 */

const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "dist", "build", "__pycache__", ".turbo", ".next", "coverage"]);
const DEP_FILE = /^(package\.json|requirements[^/]*\.txt|pyproject\.toml|pnpm-workspace\.yaml)$/;
const MAX_DEPTH = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const _cache = new Map(); // repoPath|exclude -> { at, deps }

function walk(root, maxDepth, excludeDirs = new Set()) {
  const found = [];
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !excludeDirs.has(e.name) && depth < maxDepth) visit(path.join(dir, e.name), depth + 1);
      } else if (DEP_FILE.test(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  visit(root, 0);
  return found;
}

function parseRequirements(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}

/** Read quoted strings of a TOML array starting right after "[" at index i. */
function readTomlArray(text, i) {
  const items = [];
  let quote = null, buf = "";
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) { items.push(buf); buf = ""; quote = null; } else buf += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "]") break;
  }
  return items;
}

function parsePyproject(text) {
  const out = new Set();
  // Every array literal under a key containing "dependencies" (PEP 621 + optional groups).
  // Scanned char-by-char because specs like "httpx[http2]>=0.27" contain "]".
  const startRe = /dependencies\s*=\s*\[/g;
  let m;
  while ((m = startRe.exec(text))) {
    for (const spec of readTomlArray(text, m.index + m[0].length)) {
      const name = spec.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
      if (name) out.add(name[1].toLowerCase());
    }
  }
  // Optional-dependencies groups: name = ["pkg>=1", ...] under [project.optional-dependencies]
  const optBlock = text.match(/\[project\.optional-dependencies\]([\s\S]*?)(\n\[|$)/);
  if (optBlock) {
    for (const q of optBlock[1].match(/"([^"]+)"|'([^']+)'/g) || []) {
      const name = q.slice(1, -1).match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
      if (name) out.add(name[1].toLowerCase());
    }
  }
  // Poetry table: [tool.poetry.dependencies] key = "^1"
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
  if (poetry) {
    for (const line of poetry[1].split("\n")) {
      const k = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/);
      if (k && k[1].toLowerCase() !== "python") out.add(k[1].toLowerCase());
    }
  }
  return [...out];
}

function parsePnpmCatalog(text) {
  const out = new Set();
  let inCatalog = false;
  for (const raw of text.split("\n")) {
    if (/^\S/.test(raw)) inCatalog = /^catalogs?:/.test(raw); // top-level key switch
    else if (inCatalog) {
      const m = raw.match(/^\s+'?("?)(@?[A-Za-z0-9][A-Za-z0-9._\/-]*)\1'?\s*:\s*\S/);
      if (m) out.add(m[2].toLowerCase());
    }
  }
  return [...out];
}

function parsePackageJson(text) {
  const names = new Set();
  let ownName = null;
  try {
    const pkg = JSON.parse(text);
    ownName = pkg.name || null;
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, ver] of Object.entries(pkg[key] || {})) {
        if (String(ver).startsWith("workspace:")) continue;
        names.add(name.toLowerCase());
      }
    }
  } catch {
    /* unparseable package.json - skip */
  }
  return { names: [...names], ownName };
}

function readDeps(repoPath, { exclude = [] } = {}) {
  if (!repoPath) return [];
  const cacheKey = `${repoPath}|${exclude.join(",")}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.deps;
  const deps = new Set();
  const internal = new Set();
  for (const file of walk(repoPath, MAX_DEPTH, new Set(exclude))) {
    let text;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const base = path.basename(file);
    if (base === "package.json") {
      const { names, ownName } = parsePackageJson(text);
      names.forEach((n) => deps.add(n));
      if (ownName) internal.add(ownName.toLowerCase());
    } else if (base === "pyproject.toml") parsePyproject(text).forEach((n) => deps.add(n));
    else if (base === "pnpm-workspace.yaml") parsePnpmCatalog(text).forEach((n) => deps.add(n));
    else parseRequirements(text).forEach((n) => deps.add(n));
  }
  for (const n of internal) deps.delete(n);
  const list = [...deps].sort();
  _cache.set(cacheKey, { at: Date.now(), deps: list });
  return list;
}

/** Union of curated (first, wins ordering) and live deps, all lowercased. */
function mergeProjectDeps(curated = [], live = []) {
  const out = [];
  const seen = new Set();
  for (const d of [...curated, ...live]) {
    const k = String(d).toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

module.exports = { readDeps, parseRequirements, parsePyproject, parsePnpmCatalog, parsePackageJson, mergeProjectDeps };
