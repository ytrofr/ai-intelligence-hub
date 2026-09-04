/**
 * Projects hub — GET /api/projects-hub
 *
 * One tree for the whole page: project > slot > candidate > record. All four
 * levels come from THIS one fetch, so drilling in never waits on the network
 * and a level cannot disagree with the level above it.
 *
 * It adds no store. The two payloads it joins are the ones /api/ground-truth
 * and /api/adoption-matrix already serve, built by the same builders from the
 * same config, so a number here and a number there cannot drift. The join
 * itself lives in modules/projects-hub.js, which is pure and tested; this file
 * is IO only.
 *
 *   GET /api/projects-hub               -> every project
 *   GET /api/projects-hub?project=<id>  -> just that one, same shape
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const db = require("../database/db");
const { buildGroundTruth, validateFeatures } = require("../modules/ground-truth");
const { buildLedger } = require("../modules/ledger");
const { buildMatrix } = require("../modules/adoption-matrix");
const { buildHub } = require("../modules/projects-hub");
const { readAllRadarRows, readDepRepos, readProjects } = require("./lib/hub-sources");
const HuggingFaceModule = require("../modules/huggingface");

/** The cheap-run gate is the module's, not a second copy of it here. */
const hf = new HuggingFaceModule({ id: "huggingface", config: {} });

/** Stored HF rows, with metadata parsed. A row we cannot parse is skipped, not guessed. */
function readItems() {
  const rows = db.getItems({ sources: ["huggingface"], limit: 2000 });
  const out = [];
  for (const r of rows) {
    let metadata = r.metadata;
    if (typeof metadata === "string") {
      try {
        metadata = JSON.parse(metadata);
      } catch (_) {
        continue;
      }
    }
    out.push({ ...r, metadata: metadata || {} });
  }
  return out;
}

function readNearMisses() {
  try {
    return db.nearMissStore ? db.nearMissStore.all({ limit: 500 }) : [];
  } catch (err) {
    console.warn(`[projects-hub] near-miss log unreadable: ${err.message}`);
    return [];
  }
}

function load(project) {
  const projects = readProjects();
  // Fail closed on the real config BEFORE it is rendered — a slot naming an
  // undeclared feature must not reach the page silently.
  validateFeatures(projects);

  const { depRepos } = readDepRepos();
  const radarRows = readAllRadarRows();
  const { rows: ledgerRows, counts: ledgerCounts } = buildLedger({ radarRows, depRepos });

  const groundTruth = buildGroundTruth({
    projects,
    items: readItems(),
    nearMisses: readNearMisses(),
    ledgerRows,
    classify: (item) => (hf.isCheapRun(item) ? "runnable" : "needs-you"),
    refusal: (item) => hf.cheapRunRefusal(item),
  });

  // The matrix is built UNFILTERED even when one project is asked for, so the
  // population line still says "42 of 332" rather than shrinking to match the
  // view. A denominator that moves with the filter is not a denominator.
  const matrix = buildMatrix({ ledgerRows, projects, project: null });

  const hub = buildHub({ groundTruth, matrix, ledgerCounts, ledgerRows, now: Date.now() });

  if (project) {
    const one = hub.projects.find((p) => p.id === project);
    // An unknown project id is a 404 from the caller's point of view, not an
    // empty page that reads like "this project has nothing".
    if (!one) return null;
    return { ...hub, projects: [one], filtered_to: project };
  }
  return { ...hub, filtered_to: null };
}

router.get("/", (req, res) => {
  try {
    const data = load(req.query.project);
    if (!data) return res.status(404).json({ error: `no such project: ${req.query.project}` });
    res.json({ ...data, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error("Projects hub error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.load = load;
