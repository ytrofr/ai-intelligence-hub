/**
 * GET /api/tracked — read-only view of the upstream tracker.
 *
 * The radar page joins its own view server-side; this endpoint exists for the
 * inventory skill and for anyone asking "what are we watching, and what has
 * moved?" without opening the database.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { DB_PATH } = require("../database/db");
const { TrackedStore } = require("../database/tracked-store");
const { upstreamView } = require("../modules/upstream-view");

/**
 * The staleness window the TRACKER is configured with. Hardcoding a second copy
 * in the view means tuning `stale_days` in config would move the digest's alarms
 * and leave the page's label behind — a config edit that appears to work and
 * only half applies, with nothing to signal the gap.
 */
function configuredStaleDays() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "sources.json"), "utf-8"));
    const list = Array.isArray(cfg) ? cfg : cfg.sources || [];
    const src = list.find((s) => s.id === "tracked-repos");
    const n = Number(src && src.config && src.config.stale_days);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined; // the view's own default stands
  }
}

const router = express.Router();
const staleDays = configuredStaleDays();

router.get("/", (req, res) => {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const store = new TrackedStore(db);
    const movedTo = store.movedToMap();

    const rows = store.all().map((r) => ({
      repo: r.repo,
      projects: r.projects,
      role: r.role,
      stars: r.stars,
      last_checked_at: r.last_checked_at,
      last_error: r.last_error,
      upstream: upstreamView(r, { movedTo: movedTo.get(r.repo), staleDays }),
    }));

    const since = req.query.since || new Date(Date.now() - 7 * 86400000).toISOString();
    const events = store.eventsSince(since);
    const checked = store.lastRunCount();

    res.json({
      checked,
      tracked: rows.length,
      // Stated even when zero: "0 alarms" is a result, an absent field is not.
      alarms: events.filter((e) => e.severity === "ALARM").length,
      since,
      events,
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (db) db.close();
  }
});

module.exports = router;
