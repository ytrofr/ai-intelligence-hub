/**
 * Stack Ledger — GET /api/ledger
 *
 * One row per third-party repo: which projects use it, why, how it turned out,
 * and the rule it taught us. Merges two stores that already exist:
 *
 *   config/radar/<project>.json   decisions we made, with an authored reason
 *   config/ledger/deps.json       every package in every manifest, resolved to a
 *                                 repo slug by scripts/ledger-backfill.js
 *
 * The deps live in their OWN file rather than being upserted into the radar
 * configs, because the radar is a hand-curated decision surface and 359
 * mechanically-discovered rows would bury the ~104 decisions it exists to show.
 * The merge happens here, at read time, where modules/ledger.js owns it.
 *
 * Resolution is NOT done on this path: dep-resolve.js talks to npm and PyPI, so
 * it belongs in the backfill, not in a page load.
 *
 *   GET /api/ledger          -> { counts, rows, generated_at, deps_generated_at }
 *   GET /api/ledger/:owner/:name -> a single row, 404 if we do not use it
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { RadarStore } = require("./lib/radar-store");
const { buildLedger } = require("../modules/ledger");

const RADAR_DIR = path.join(__dirname, "..", "config", "radar");
const DEPS_FILE = path.join(__dirname, "..", "config", "ledger", "deps.json");
const store = new RadarStore(RADAR_DIR);

/** Every audited row from every radar config, with the reason intact. */
function readAllRadarRows() {
  const rows = [];
  for (const p of store.listProjects()) {
    if (p.id === "example") continue;
    try {
      const cfg = store.load(p.id);
      for (const r of cfg.audit || []) rows.push({ ...r, project: r.project || cfg.project || p.id });
    } catch (err) {
      // A single unreadable config must not empty the whole ledger.
      console.warn(`[ledger] unreadable radar config ${p.id}: ${err.message}`);
    }
  }
  return rows;
}

/**
 * Resolved dependencies, flattened to one entry per (repo, project).
 * Absent file is not an error — it means the backfill has not run yet, and the
 * ledger then honestly shows only the decisions.
 */
function readDepRepos() {
  if (!fs.existsSync(DEPS_FILE)) return { depRepos: [], generatedAt: null };
  try {
    const data = JSON.parse(fs.readFileSync(DEPS_FILE, "utf-8"));
    const depRepos = [];
    for (const d of data.deps || []) {
      for (const project of d.projects || []) depRepos.push({ repo: d.repo, project, pkg: d.pkg });
    }
    return { depRepos, generatedAt: data.generated_at || null };
  } catch (err) {
    console.warn(`[ledger] unreadable deps file: ${err.message}`);
    return { depRepos: [], generatedAt: null };
  }
}

function load() {
  const { depRepos, generatedAt } = readDepRepos();
  const { rows, counts } = buildLedger({ radarRows: readAllRadarRows(), depRepos });
  return { rows, counts, generated_at: new Date().toISOString(), deps_generated_at: generatedAt };
}

router.get("/", (_req, res) => {
  try {
    res.json(load());
  } catch (err) {
    console.error("Ledger error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:owner/:name", (req, res) => {
  try {
    const slug = `${req.params.owner}/${req.params.name}`;
    const row = load().rows.find((r) => r.repo === slug);
    if (!row) return res.status(404).json({ error: `not in the ledger: ${slug}` });
    res.json({ row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.readAllRadarRows = readAllRadarRows;
module.exports.readDepRepos = readDepRepos;
