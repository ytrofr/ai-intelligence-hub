/**
 * The stack inventory — one page saying what all nine projects are, what they
 * are built on, and what each has adopted.
 *
 * The point is the LAST column: repos adopted by more than one project. Without
 * it every project rediscovers what another already solved, which is the ask
 * this whole plan came from.
 *
 * Assembled at request time from config/projects.json (identity), the repos
 * themselves (live dependency counts) and config/radar/*.json (adoptions).
 * Nothing is stored, so nothing can go stale.
 */

const fs = require("fs");
const path = require("path");
const { readDeps } = require("./project-deps");

const ADOPTED = new Set(["accepted", "done"]);

function loadProfiles(configPath) {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const list = cfg.projects;
  return Array.isArray(list) ? list : Object.entries(list || {}).map(([id, v]) => ({ id, ...v }));
}

function loadRadar(radarDir) {
  const byProject = new Map();
  if (!fs.existsSync(radarDir)) return byProject;
  for (const f of fs.readdirSync(radarDir)) {
    if (!f.endsWith(".json") || f === "example.json") continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(radarDir, f), "utf-8"));
      const id = f.replace(/\.json$/, "");
      byProject.set(id, cfg.audit || []);
    } catch {
      byProject.set(f.replace(/\.json$/, ""), []);
    }
  }
  return byProject;
}

function buildInventory({ configPath, radarDir, readDepsFn = readDeps, exists = fs.existsSync } = {}) {
  const profiles = loadProfiles(configPath);
  const radar = loadRadar(radarDir);

  const adoptedBy = new Map(); // repo -> [project ids]
  const projects = profiles.map((p) => {
    // A project whose repo we cannot read reports "unknown", never 0 — zero
    // dependencies is a claim, and an unreadable path is not evidence for it.
    let deps = null;
    if (p.repoPath && exists(p.repoPath)) {
      try {
        deps = readDepsFn(p.repoPath).length;
      } catch {
        deps = null;
      }
    }

    const rows = radar.get(p.id) || [];
    const adopted = rows.filter((r) => ADOPTED.has(r.status)).map((r) => r.repo);
    for (const repo of adopted) {
      if (!adoptedBy.has(repo)) adoptedBy.set(repo, []);
      if (!adoptedBy.get(repo).includes(p.id)) adoptedBy.get(repo).push(p.id);
    }

    return {
      id: p.id,
      name: p.name || p.id,
      blurb: p.blurb || null,
      blurb_confirmed: p.blurb_confirmed === true,
      surface: p.surface || null,
      repoPath: p.repoPath || null,
      deps: deps === null ? "unknown" : deps,
      adopted,
      watching: rows.filter((r) => r.verdict === "WATCH" && r.status !== "rejected").length,
      proposed: rows.filter((r) => r.status === "proposed").length,
    };
  });

  const shared = [...adoptedBy.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([repo, ps]) => ({ repo, projects: ps.sort() }))
    .sort((a, b) => b.projects.length - a.projects.length || a.repo.localeCompare(b.repo));

  return {
    projects,
    shared,
    totals: {
      projects: projects.length,
      adoptions: adoptedBy.size,
      shared: shared.length,
      unconfirmed_blurbs: projects.filter((p) => p.blurb && !p.blurb_confirmed).length,
    },
  };
}

module.exports = { buildInventory };
