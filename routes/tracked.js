/**
 * GET /api/tracked — read-only view of the upstream tracker.
 *
 * The radar page joins its own view server-side; this endpoint exists for the
 * inventory skill and for anyone asking "what are we watching, and what has
 * moved?" without opening the database.
 */

const express = require("express");
const Database = require("better-sqlite3");
const { DB_PATH } = require("../database/db");
const { TrackedStore } = require("../database/tracked-store");
const { upstreamView } = require("../modules/upstream-view");

const router = express.Router();

router.get("/", (req, res) => {
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const store = new TrackedStore(db);
    const movedTo = new Map(
      db.prepare("SELECT repo, to_value FROM tracked_events WHERE event = 'renamed' ORDER BY id").all()
        .map((e) => [e.repo, e.to_value])
    );

    const rows = store.all().map((r) => ({
      repo: r.repo,
      projects: r.projects,
      role: r.role,
      stars: r.stars,
      last_checked_at: r.last_checked_at,
      last_error: r.last_error,
      upstream: upstreamView(r, { movedTo: movedTo.get(r.repo) }),
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
