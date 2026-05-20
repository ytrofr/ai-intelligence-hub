/**
 * SIGMA Radar Route - GET /api/sigma-radar
 * Joins the curated SIGMA adoption audit (config/sigma-radar.json) with live
 * repo data from the Hub index. Repos are deduped by title (max stars across
 * sources) and split into top-tier (>= starThreshold) and sub-threshold tiers.
 * Also surfaces uncurated high-star repos matching topic keywords for review.
 */

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const CONFIG_PATH = path.join(__dirname, "..", "config", "sigma-radar.json");
const DB_PATH = path.join(__dirname, "..", "data", "hub.db");

const VERDICT_RANK = { ADOPT: 0, WATCH: 1, SKIP: 2 };

router.get("/", (req, res) => {
  let db;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    const threshold = config.starThreshold || 20000;

    // Read-only connection — WAL mode allows concurrent reads with the main process
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

    // Deduped single-repo lookup: max stars across all github sources
    const repoStmt = db.prepare(`
      SELECT title, MAX(stars) AS stars, MIN(url) AS url, MAX(description) AS description
      FROM items
      WHERE title = ? AND source LIKE 'github%'
      GROUP BY title
    `);

    // Enrich each curated audit entry with live index data
    const auditedRepos = config.audit.map((entry) => {
      const row = repoStmt.get(entry.repo);
      const stars = row ? row.stars : null;
      return {
        ...entry,
        stars,
        url: row ? row.url : `https://github.com/${entry.repo}`,
        description: row ? row.description : "",
        inIndex: !!row,
        tier: stars !== null && stars >= threshold ? "top" : "sub",
      };
    });

    // Group curated repos by topic, sorted verdict-first then star-desc
    const sortRepos = (a, b) =>
      (VERDICT_RANK[a.verdict] ?? 9) - (VERDICT_RANK[b.verdict] ?? 9) ||
      (b.stars || 0) - (a.stars || 0);

    const topics = config.topics.map((topic) => {
      const repos = auditedRepos
        .filter((r) => r.topic === topic.id)
        .sort(sortRepos);
      return {
        id: topic.id,
        label: topic.label,
        blurb: topic.blurb,
        count: repos.length,
        top: repos.filter((r) => r.tier === "top"),
        sub: repos.filter((r) => r.tier === "sub"),
      };
    });

    // Uncurated high-star repos matching any topic keyword — review queue
    const curatedTitles = new Set(config.audit.map((a) => a.repo));
    const keywords = config.topics.flatMap((t) =>
      t.keywords.map((k) => ({ topic: t.id, kw: k.toLowerCase() })),
    );

    const highStar = db
      .prepare(`
        SELECT title, MAX(stars) AS stars, MIN(url) AS url, MAX(description) AS description
        FROM items
        WHERE stars >= ? AND source LIKE 'github%'
        GROUP BY title
        ORDER BY stars DESC
      `)
      .all(threshold);

    const needsReview = [];
    for (const r of highStar) {
      if (curatedTitles.has(r.title)) continue;
      const hay = `${r.title} ${r.description || ""}`.toLowerCase();
      const hit = keywords.find((k) => hay.includes(k.kw));
      if (hit) {
        needsReview.push({ ...r, topic: hit.topic, matchedKeyword: hit.kw });
      }
    }

    db.close();

    res.json({
      project: config.project,
      subtitle: config.subtitle,
      updated: config.updated,
      starThreshold: threshold,
      verdicts: config.verdicts,
      generatedAt: new Date().toISOString(),
      summary: {
        curated: auditedRepos.length,
        adopt: auditedRepos.filter((r) => r.verdict === "ADOPT").length,
        watch: auditedRepos.filter((r) => r.verdict === "WATCH").length,
        skip: auditedRepos.filter((r) => r.verdict === "SKIP").length,
        topTier: auditedRepos.filter((r) => r.tier === "top").length,
        subTier: auditedRepos.filter((r) => r.tier === "sub").length,
        needsReview: needsReview.length,
      },
      topics,
      needsReview,
    });
  } catch (error) {
    if (db) {
      try {
        db.close();
      } catch (_e) {
        /* already closed */
      }
    }
    console.error("SIGMA Radar error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
