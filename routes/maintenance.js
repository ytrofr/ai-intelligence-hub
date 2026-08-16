/**
 * Maintenance Route - POST /api/maintenance/prune?dryRun=1
 * Per-source retention from config/sources.json (retention_days). Loopback only.
 * Default is a DRY RUN; pass dryRun=0 to delete (hub-auto-fetch.sh does, with HUB_PRUNE=1).
 */
const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { prune } = require("../modules/retention");
const { isLoopback } = require("./lib/radar-store");

router.post("/prune", (req, res) => {
  if (!isLoopback(req.socket && req.socket.remoteAddress)) return res.status(403).json({ error: "local-only" });
  const dryRun = String(req.query.dryRun ?? req.body?.dryRun ?? "1") !== "0";
  try {
    const before = db.getStats().totalItems;
    const result = prune(db, db.getSources(), { dryRun });
    if (!dryRun && result.total > 0 && String(req.query.vacuum || "0") === "1") db.vacuum();
    const after = db.getStats().totalItems;
    console.log(`PRUNE${dryRun ? " (dry run)" : ""}: ${result.results.map((r) => `${r.source} -${r.would_delete ?? r.deleted}`).join(" · ")} · items ${before} -> ${after}`);
    res.json({ ...result, items_before: before, items_after: after });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
