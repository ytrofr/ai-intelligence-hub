/**
 * Adoption Scorecard — GET /api/adoption-scorecard
 *
 * Per project: every candidate it ruled on, what was measured on ITS OWN data,
 * what was only estimated, what was never run, the operator's verdict, the
 * lesson. Built from the raw radar rows (routes/lib/hub-sources.js owns reading
 * them) by modules/adoption-scorecard.js — never from the merged ledger row,
 * which is how one project would end up wearing another's bench.
 *
 *   GET /api/adoption-scorecard               -> every project
 *   GET /api/adoption-scorecard?project=<id>  -> just that project
 */

const express = require("express");
const router = express.Router();
const { buildScorecard } = require("../modules/adoption-scorecard");
const { readAllRadarRows, readProjects } = require("./lib/hub-sources");

router.get("/", (req, res) => {
  try {
    res.json(buildScorecard({ radarRows: readAllRadarRows(), projects: readProjects(), project: req.query.project || null }));
  } catch (err) {
    console.error("Adoption scorecard error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
