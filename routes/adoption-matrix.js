/**
 * Adoption Matrix — GET /api/adoption-matrix
 *
 * "What should we adopt next" as one concise table: effort, effect, time,
 * impact, risk and the score they roll up to, plus what it touches and what
 * to do about it. Built from the same two inputs the Stack Ledger already
 * reads (routes/ledger.js owns reading them; this route calls its exported
 * helpers rather than re-reading config/radar and config/ledger itself),
 * merged the same way (modules/ledger.js buildLedger), then reshaped by
 * modules/adoption-matrix.js into a decision surface instead of a full list.
 *
 *   GET /api/adoption-matrix               -> every project's table
 *   GET /api/adoption-matrix?project=<id>  -> just that project's table
 */

const express = require("express");
const router = express.Router();
const { buildLedger } = require("../modules/ledger");
const { buildMatrix } = require("../modules/adoption-matrix");
const { readAllRadarRows, readDepRepos, readProjects } = require("./lib/hub-sources");

function load(project) {
  const { depRepos } = readDepRepos();
  const { rows } = buildLedger({ radarRows: readAllRadarRows(), depRepos });
  return buildMatrix({
    ledgerRows: rows,
    projects: readProjects(),
    project: project || null,
  });
}

router.get("/", (req, res) => {
  try {
    res.json(load(req.query.project));
  } catch (err) {
    console.error("Adoption matrix error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
