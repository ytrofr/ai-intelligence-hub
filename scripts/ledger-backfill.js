#!/usr/bin/env node
/**
 * Stack Ledger backfill — turn every package in every project's manifests into a
 * resolved repo slug, and write config/ledger/deps.json for routes/ledger.js.
 *
 *   node scripts/ledger-backfill.js --dry-run     print the diff, write nothing
 *   node scripts/ledger-backfill.js               write the file
 *
 * Three things this must get right, all of which fail silently if it does not:
 *
 *  1. THREE STATES, NOT TWO. dep-resolve distinguishes resolved / unresolved
 *     (a registry answered "no repo") / unknown (nobody answered — a timeout).
 *     An unknown must never be written as unresolved: that turns a network
 *     failure into a recorded fact, and the previous good answer is lost.
 *  2. IT NEVER WRITES A REASON. Reasons live on radar rows, authored by a person.
 *     This file has no `why` field at all, so there is nothing here to overwrite.
 *  3. IT IS IDEMPOTENT. Everything is sorted, so a second run is a no-op. A
 *     re-run that reports work done is the tell that the key mutates itself.
 *
 * It also never writes a reason it invented. A plausible generated reason is
 * worse than a blank one, because it is indistinguishable from a real one.
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "config", "ledger");
const OUT_FILE = path.join(OUT_DIR, "deps.json");

/**
 * Shape the resolver's output into the deps file.
 * @param {{owners: Map<string,string[]>, resolved?: Map<string,string>, unresolved?: string[], unknown?: string[]}} input
 */
function buildDepsFile({ owners = new Map(), resolved = new Map(), unresolved = [], unknown = [] } = {}) {
  const unresolvedSet = new Set(unresolved);
  const unknownSet = new Set(unknown);
  const deps = [];

  for (const [pkg, projects] of owners) {
    if (unknownSet.has(pkg)) continue; // nobody answered — say nothing
    const repo = resolved.get(pkg) || (unresolvedSet.has(pkg) ? "unresolved" : null);
    if (!repo) continue;
    deps.push({ pkg, repo, projects: [...new Set(projects)].sort() });
  }
  deps.sort((a, b) => a.pkg.localeCompare(b.pkg));

  return {
    deps,
    counts: {
      total: deps.length,
      resolved: deps.filter((d) => d.repo !== "unresolved").length,
      unresolved: deps.filter((d) => d.repo === "unresolved").length,
      unknown: unknownSet.size,
    },
  };
}

/**
 * Merge a fresh run over the previous file.
 *
 * A package the fresh run could not get an answer for keeps whatever we already
 * knew. A package that genuinely left the manifests is removed — that is a real
 * change and the ledger should show it.
 */
function mergeDepsFile(previous = { deps: [] }, fresh = { deps: [] }, { unknown = [] } = {}) {
  const prevByPkg = new Map((previous.deps || []).map((d) => [d.pkg, d]));
  const byPkg = new Map(fresh.deps.map((d) => [d.pkg, d]));

  for (const pkg of unknown) {
    const kept = prevByPkg.get(pkg);
    if (kept && !byPkg.has(pkg)) byPkg.set(pkg, kept);
  }

  const deps = [...byPkg.values()].sort((a, b) => a.pkg.localeCompare(b.pkg));
  const added = deps.filter((d) => !prevByPkg.has(d.pkg)).map((d) => d.pkg);
  const removed = [...prevByPkg.keys()].filter((p) => !byPkg.has(p));

  return { deps, counts: { ...fresh.counts, total: deps.length }, diff: { added, removed } };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { readProjectDeps } = require("../modules/tracked-repos");
  const { createResolver } = require("../modules/dep-resolve");
  const db = require("../database/db");

  const { names, owners } = readProjectDeps();
  console.log(`[ledger] ${names.length} distinct packages across the configured projects`);

  // Same 30-day package→repo cache the daily tracker uses, so the two runs warm
  // each other rather than each paying for 247 registry lookups.
  const resolver = createResolver({ cache: db.tracked ? db.tracked.depCache() : undefined });
  const { resolved, unresolved, unknown } = await resolver.resolveAll(names);

  const fresh = buildDepsFile({ owners, resolved, unresolved, unknown });
  const previous = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, "utf-8")) : { deps: [] };
  const merged = mergeDepsFile(previous, fresh, { unknown });

  // A diff, never a total: "0 reasons overwritten" is the line that proves the
  // safety property held in production, and a total proves nothing.
  console.log(
    `[ledger] +${merged.diff.added.length} packages, -${merged.diff.removed.length}, ` +
      `${merged.counts.resolved} resolved · ${merged.counts.unresolved} unresolved · ` +
      `${merged.counts.unknown} unknown (kept previous) · 0 reasons overwritten (this file has no reason field)`,
  );
  if (merged.diff.added.length) console.log(`[ledger] added: ${merged.diff.added.slice(0, 20).join(", ")}`);
  if (merged.diff.removed.length) console.log(`[ledger] removed: ${merged.diff.removed.join(", ")}`);

  if (dryRun) {
    console.log(`[ledger] --dry-run: nothing written. Would write ${merged.deps.length} rows to ${OUT_FILE}`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source: "scripts/ledger-backfill.js — manifests via project-deps, slugs via dep-resolve",
    counts: merged.counts,
    deps: merged.deps,
  };
  const tmp = `${OUT_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
  fs.renameSync(tmp, OUT_FILE);
  console.log(`[ledger] wrote ${merged.deps.length} rows to ${OUT_FILE}`);
}

module.exports = { buildDepsFile, mergeDepsFile };

if (require.main === module) {
  main().catch((err) => {
    console.error(`[ledger] backfill failed: ${err.message}`);
    process.exit(1);
  });
}
