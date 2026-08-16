/**
 * Adoption Radar - GET /api/radar?project=<id>
 * Joins the hand-curated per-project verdicts (config/radar/<project>.json,
 * ADOPT/WATCH/SKIP + status) with live repo data from the Hub index. Repos are
 * deduped by title (max stars across sources) and split into top-tier
 * (>= starThreshold) and sub-threshold tiers. Also surfaces uncurated
 * high-star repos matching topic keywords for review.
 *
 *   GET  /api/radar/projects              -> [{id,title,rows,updated}]
 *   GET  /api/radar?project=apollo          -> radar payload
 *   POST /api/radar/status {project,repo,status,outcome?,evidence?,lesson?}  (loopback only)
 *                          done|rejected REQUIRE evidence + lesson
 *   POST /api/radar/row    {project,repo,topic,verdict,why,outcome?,evidence?,lesson?} (loopback only)
 *   /api/hermes-radar is mounted on the same router with project forced to apollo.
 */

const express = require("express");
const fs = require("fs");
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
const path = require("path");
const Database = require("better-sqlite3");
const { RadarStore } = require("./lib/radar-store");
const { upstreamView } = require("../modules/upstream-view");
const { TrackedStore } = require("../database/tracked-store");
const { requireLoopback } = require("./lib/net");
const { DB_PATH } = require("../database/db");

const CONFIG_DIR = path.join(__dirname, "..", "config", "radar");
const VERDICT_RANK = { ADOPT: 0, WATCH: 1, SKIP: 2 };
const store = new RadarStore(CONFIG_DIR);

router.get("/projects", (req, res) => {
  res.json({ projects: store.listProjects() });
});

router.post("/status", requireLoopback, (req, res) => {
  try {
    // Closing a row (done|rejected) requires evidence + lesson — see radar-store.
    const { project, repo, status, outcome, evidence, lesson } = req.body || {};
    res.json({ ok: true, row: store.setStatus(project, repo, status, { outcome, evidence, lesson }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/row", requireLoopback, (req, res) => {
  try {
    const { project, ...input } = req.body || {};
    res.json({ ok: true, row: store.upsertRow(project, input) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/", (req, res) => {
  let db;
  try {
    const project = req.forcedProject || req.query.project || "apollo";
    const config = store.load(project);
    const threshold = config.starThreshold || 20000;

    // Read-only connection — WAL mode allows concurrent reads with the main process
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const repoStmt = db.prepare(`
      SELECT title, MAX(stars) AS stars, MIN(url) AS url, MAX(description) AS description
      FROM items WHERE title = ? AND source LIKE 'github%' GROUP BY title
    `);

    // Only this project's repos, not the whole pool — apollo is the largest at 56
    // of 257 tracked. This route holds its own READ-ONLY handle, so the store is
    // constructed on it rather than reaching for the writable singleton.
    const trackedStore = new TrackedStore(db);
    const tracked = trackedStore.getMany(config.audit.map((a) => a.repo));
    // Where a moved repo went — the destination lives in the event log, and a
    // rename that cannot say where it went is not actionable.
    const movedTo = trackedStore.movedToMap();

    const auditedRepos = config.audit.map((entry) => {
      const row = repoStmt.get(entry.repo);
      const stars = row ? row.stars : null;
      return {
        ...entry,
        rationale: entry.why, // back-compat for the old page field
        stars,
        url: row ? row.url : `https://github.com/${entry.repo}`,
        description: row ? row.description : "",
        inIndex: !!row,
        tier: stars !== null && stars >= threshold ? "top" : "sub",
        // Upstream state where the adopt/skip decision is actually made. A repo
        // we do not track says "not tracked" rather than implying health.
        upstream: upstreamView(tracked.get(entry.repo), { movedTo: movedTo.get(entry.repo), staleDays }),
      };
    });

    const sortRepos = (a, b) =>
      (VERDICT_RANK[a.verdict] ?? 9) - (VERDICT_RANK[b.verdict] ?? 9) || (b.stars || 0) - (a.stars || 0);

    const topics = (config.topics || []).map((topic) => {
      const repos = auditedRepos.filter((r) => r.topic === topic.id).sort(sortRepos);
      return { id: topic.id, label: topic.label, blurb: topic.blurb, count: repos.length,
        top: repos.filter((r) => r.tier === "top"), sub: repos.filter((r) => r.tier === "sub") };
    });
    const knownTopics = new Set((config.topics || []).map((t) => t.id));
    const uncategorized = auditedRepos.filter((r) => !knownTopics.has(r.topic)).sort(sortRepos);
    if (uncategorized.length) topics.push({ id: "general", label: "General", blurb: "", count: uncategorized.length,
      top: uncategorized.filter((r) => r.tier === "top"), sub: uncategorized.filter((r) => r.tier === "sub") });

    // Uncurated high-star repos matching any topic keyword — review queue
    const curatedTitles = new Set(config.audit.map((a) => a.repo));
    const keywords = (config.topics || []).flatMap((t) => t.keywords.map((k) => ({ topic: t.id, kw: k.toLowerCase() })));
    const highStar = db.prepare(`
        SELECT title, MAX(stars) AS stars, MIN(url) AS url, MAX(description) AS description
        FROM items WHERE stars >= ? AND source LIKE 'github%' GROUP BY title ORDER BY stars DESC
      `).all(threshold);
    const needsReview = [];
    for (const r of highStar) {
      if (curatedTitles.has(r.title)) continue;
      const hay = `${r.title} ${r.description || ""}`.toLowerCase();
      const hit = keywords.find((k) => hay.includes(k.kw));
      if (hit) needsReview.push({ ...r, topic: hit.topic, matchedKeyword: hit.kw });
    }
    db.close();

    const count = (pred) => auditedRepos.filter(pred).length;
    res.json({
      project: config.project,
      title: config.title || config.project,
      subtitle: config.subtitle,
      updated: config.updated,
      starThreshold: threshold,
      verdicts: config.verdicts,
      generatedAt: new Date().toISOString(),
      summary: {
        curated: auditedRepos.length,
        adopt: count((r) => r.verdict === "ADOPT"),
        watch: count((r) => r.verdict === "WATCH"),
        skip: count((r) => r.verdict === "SKIP"),
        accepted: count((r) => r.status === "accepted"),
        done: count((r) => r.status === "done"),
        rejected: count((r) => r.status === "rejected"),
        topTier: count((r) => r.tier === "top"),
        subTier: count((r) => r.tier === "sub"),
        needsReview: needsReview.length,
      },
      topics,
      needsReview,
    });
  } catch (error) {
    if (db) { try { db.close(); } catch (_e) { /* closed */ } }
    console.error("Radar error:", error.message);
    res.status(error.message.startsWith("unknown project") ? 404 : 500).json({ error: error.message });
  }
});

module.exports = router;
