/**
 * Company inbox API (2026-11-03) - what big companies created, and what still waits
 * for a ruling. Source: company-orgs (modules/company-orgs.js).
 *
 *   GET  /api/companies/inbox            items above their floor with no ruling, oldest first
 *   GET  /api/companies/week?since=ISO   items that entered the inbox since `since`, any state
 *   GET  /api/companies/orgs             per-org last read, status and error
 *   GET  /api/companies/brief            the Monday one-pager, live, from the last digest's end to now (text/markdown)
 *   GET  /api/companies/recall           the last recall check (GitHub search vs company_repos)
 *   POST /api/companies/recall           run it now (loopback only; ~45 searches through the shared limiter)
 *   POST /api/companies/rule {repo,state,note?}  (loopback only) state: test|watch|adopted|skip|noise|new
 */
const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { requireLoopback } = require("./lib/net");

router.get("/inbox", (_req, res) => {
  const items = db.companies.inbox();
  res.json({ count: items.length, baseline: items.filter((i) => i.baseline).length, items });
});

router.get("/week", (req, res) => {
  const since = String(req.query.since || new Date(Date.now() - 7 * 86400000).toISOString());
  if (Number.isNaN(Date.parse(since))) return res.status(400).json({ error: "since must be an ISO date" });
  const items = db.companies.crossedSince(since);
  res.json({ since, count: items.length, items });
});

router.get("/brief", (_req, res) => {
  try {
    const { digestWindow } = require("../modules/digest-window");
    const today = new Date().toISOString().slice(0, 10);
    const window = digestWindow({ prev: db.getWeeklyRun(today) || db.getPreviousWeeklyRun(today), now: new Date() });
    res.type("text/markdown").send(require("../modules/monday-brief").assembleBrief({ db, window }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/orgs", (_req, res) => {
  const orgs = db.companies.orgs();
  res.json({ count: orgs.length, failing: orgs.filter((o) => o.last_status !== "ok").length, orgs });
});

router.get("/recall", (_req, res) => {
  const r = require("../modules/company-recall").readLastRecall();
  if (!r) return res.status(404).json({ error: "the recall check has not run yet" });
  res.json(r);
});

router.post("/recall", requireLoopback, async (_req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");
    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "companies.json"), "utf-8"));
    const { searchRepos } = require("../modules/github-theme-search");
    const r = await require("../modules/company-recall").runRecall({ db, registry, search: searchRepos });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/rule", requireLoopback, express.json(), (req, res) => {
  const { repo, state, note } = req.body || {};
  try {
    db.companies.rule(String(repo || ""), String(state || ""), note ? String(note).slice(0, 1000) : null);
    res.json({ ok: true, repo, state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
