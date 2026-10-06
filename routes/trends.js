/**
 * GitHub Trends - GET /api/trends?theme=&period=7|30&min_gain=&include_ruled=1&include_other=1
 *
 * What is gaining stars now, by theme, ranked by velocity. Every number is
 * built by routes/lib/trends-builder.js, the same builder the weekly digest's
 * "Trending by theme" section calls, so the page and the digest cannot
 * disagree. This file is IO + query validation only.
 *
 * A bad parameter is a 400 naming the parameter, never a silently-defaulted
 * answer: "period=14" quietly served as 7 would be a different question
 * answered under the reader's label.
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { buildTrends, PERIODS } = require("./lib/trends-builder");
const { loadThemes, OTHER } = require("../modules/themes");

/** Pure: req.query -> {opts} | {error}. Exported for the test. */
function parseQuery(q = {}, themeIds = []) {
  const opts = {};
  if (q.period !== undefined && q.period !== "") {
    const p = Number(q.period);
    if (!PERIODS.includes(p)) return { error: `period must be one of ${PERIODS.join("|")}, got ${q.period}` };
    opts.period = p;
  }
  if (q.min_gain !== undefined && q.min_gain !== "") {
    const g = Number(q.min_gain);
    if (!Number.isInteger(g) || g < 0) return { error: `min_gain must be a non-negative integer, got ${q.min_gain}` };
    opts.minGain = g;
  }
  if (q.theme) {
    const t = String(q.theme);
    if (![...themeIds, OTHER].includes(t)) return { error: `unknown theme: ${t}` };
    opts.theme = t;
  }
  opts.includeRuled = q.include_ruled === "1" || q.include_ruled === "true";
  opts.includeOther = q.include_other === "1" || q.include_other === "true";
  return { opts };
}

router.get("/", (req, res) => {
  try {
    const themes = loadThemes();
    const parsed = parseQuery(req.query, themes.map((t) => t.id));
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    // db.snapshots.db is the hub's one better-sqlite3 handle (items + star_snapshots).
    res.json(buildTrends(db.snapshots.db, { ...parsed.opts, themes }));
  } catch (err) {
    console.error("Trends error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.parseQuery = parseQuery;
