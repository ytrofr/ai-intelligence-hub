#!/usr/bin/env node
/**
 * Rescore existing GitHub discovery items against the CURRENT project profiles
 * (config/projects.json + live repo deps) without any GitHub API calls.
 * Uses the stored metadata (repo_dependencies, topics, created_at) and the same
 * calculateRelevanceScore() the discovery module uses at fetch time.
 *
 *   node scripts/rescore-discovery.js            # dry run: prints what would change
 *   node scripts/rescore-discovery.js --apply    # writes metadata + score
 */
const path = require("path");
const Database = require("better-sqlite3");
const GitHubDiscoveryModule = require("../modules/github-discovery");

const APPLY = process.argv.includes("--apply");
const DB_PATH = path.join(__dirname, "..", "data", "hub.db");
const SOURCES = ["github-discovery-tech", "github-discovery-curated", "github-discovery-rising", "github-discovery-deps", "github-watchlist"];

const db = new Database(DB_PATH);
const mod = new GitHubDiscoveryModule({ id: "rescore", name: "rescore", type: "github-discovery", url: "", config: {} });
const { projects } = mod.loadProjects();
const projectIds = new Set(projects.map((p) => p.id));

const rows = db.prepare(`SELECT id, source, title, stars, score, published_at, metadata FROM items WHERE source IN (${SOURCES.map(() => "?").join(",")})`).all(...SOURCES);
const upd = db.prepare("UPDATE items SET metadata = @metadata, score = @score WHERE id = @id");

let changed = 0, gained = 0, byProject = {};
const tx = db.transaction((updates) => updates.forEach((u) => upd.run(u)));
const updates = [];
for (const r of rows) {
  let meta;
  try { meta = JSON.parse(r.metadata || "{}"); } catch { continue; }
  if (meta.discovery_strategy === "dependency-backed") continue; // own deps, forced overlap - leave
  const repoData = { topics: meta.topics || [], stargazers_count: r.stars || 0, created_at: meta.created_at || r.published_at, pushed_at: r.published_at };
  const analysis = { dependencies: (meta.repo_dependencies || []).map((d) => String(d).toLowerCase()), readmeLength: meta.readme_length || 0 };
  const strategy = meta.discovery_strategy || (r.source === "github-watchlist" ? "watchlist" : "tech-stack");
  const rel = mod.calculateRelevanceScore(repoData, analysis, { strategy });
  // preserve query-origin credits (not reconstructible from metadata)
  for (const old of meta.matched_projects || []) {
    if (old.viaQuery && projectIds.has(old.id) && !rel.matchedProjects.some((m) => m.id === old.id)) rel.matchedProjects.push(old);
  }
  const before = new Set((meta.matched_projects || []).map((m) => m.id));
  const after = new Set(rel.matchedProjects.map((m) => m.id));
  for (const id of after) if (!before.has(id)) { gained++; byProject[id] = (byProject[id] || 0) + 1; }
  const newMeta = { ...meta, matched_projects: rel.matchedProjects, match_reason: rel.matchReason,
    dependency_overlap: Math.max(...rel.matchedProjects.map((p) => p.overlap), 0), rescored_at: new Date().toISOString() };
  if (JSON.stringify(newMeta.matched_projects) !== JSON.stringify(meta.matched_projects || []) || Math.round(rel.score) !== Math.round(r.score)) {
    changed++;
    updates.push({ id: r.id, metadata: JSON.stringify(newMeta), score: rel.score });
  }
}
console.log(`rescore: ${rows.length} items scanned, ${changed} would change, ${gained} new project matches`, byProject);
if (APPLY) { tx(updates); console.log(`applied ${updates.length} updates`); } else console.log("dry run - pass --apply to write");
db.close();
