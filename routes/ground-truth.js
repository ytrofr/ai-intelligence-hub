/**
 * Ground truth — GET /api/ground-truth
 *
 * What checks each of our instruments, and what did it last say?
 *
 * Reads three stores that already exist and joins them at request time:
 *   config/projects.json   the slots — one instrument plus the shape of data
 *                          that can grade it (declared as data, not code)
 *   items                  what the HuggingFace feed has stored; an item binds
 *                          to a slot through metadata.matched_slots
 *   slot_near_miss         what matched a PROJECT but no instrument — the corpus
 *                          for the next slot, and the only place it exists
 *
 * The join and every count live in modules/ground-truth.js so they can be tested
 * with no config, no database and no network. This file is IO only.
 *
 *   GET /api/ground-truth  -> { counts, projects, generated_at }
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { buildGroundTruth, validateFeatures } = require("../modules/ground-truth");
const { buildLedger } = require("../modules/ledger");
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
    console.warn(`[ground-truth] near-miss log unreadable: ${err.message}`);
    return [];
  }
}

/** Same repo-keyed ledger the /api/ledger route serves, built the same way. */
function readLedgerRows() {
  try {
    const { depRepos } = readDepRepos();
    return buildLedger({ radarRows: readAllRadarRows(), depRepos }).rows;
  } catch (err) {
    console.warn(`[ground-truth] ledger unreadable: ${err.message}`);
    return [];
  }
}

/**
 * @param {string} [project] narrow to one project id, from ?project=
 *
 * The narrowing happens on the INPUT, not on the output: `countGroundTruth`
 * derives every count from the tree it is handed, so filtering the projects
 * list here gives a page whose headline and whose rows describe the same
 * population. Filtering the built payload instead would have left the counts
 * cross-project while the rows showed one project - a denominator that lies.
 *
 * The ledger rows are narrowed the same way, because `counts.funnel` and
 * `counts.parked_paid` are computed from them and would otherwise stay
 * ledger-wide on a page that says it is showing one project.
 */
function load(project) {
  const all = readProjects();
  const projects = project ? all.filter((p) => p.id === project) : all;
  // Fail closed on the real config BEFORE it is rendered — a slot naming an
  // undeclared feature, or a project with slots but no features[], must not
  // reach the page silently.
  validateFeatures(projects);
  const ledgerRows = project
    ? readLedgerRows().filter((r) => Array.isArray(r.projects) && r.projects.includes(project))
    : readLedgerRows();
  const built = buildGroundTruth({
    projects,
    items: readItems(),
    nearMisses: readNearMisses(),
    ledgerRows,
    // "needs-you" is the honest default: anything the cheap-run gate refuses
    // needs the operator to accept terms or rule on a card. The gate itself
    // fails closed, so an unknown lands here rather than in "runnable".
    classify: (item) => (hf.isCheapRun(item) ? "runnable" : "needs-you"),
    refusal: (item) => hf.cheapRunRefusal(item),
  });
  return { ...built, filtered_to: project || null, generated_at: new Date().toISOString() };
}

router.get("/", (req, res) => {
  try {
    const project = req.query.project ? String(req.query.project) : "";
    // An unknown id is a 404, never an empty tree - "this project has no
    // instruments" and "there is no such project" are different answers.
    if (project && !readProjects().some((p) => p.id === project)) {
      return res.status(404).json({ error: `no such project: ${project}` });
    }
    res.json(load(project));
  } catch (err) {
    console.error("Ground-truth error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.load = load;
