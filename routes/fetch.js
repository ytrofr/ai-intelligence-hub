/**
 * Fetch Route - POST /api/fetch
 * Triggers fetching from all enabled sources (or one via {sourceId}).
 * Per-source wall-clock budget + honest status; see modules/fetch-runner.js.
 * Response: { fetched, sources:{id:{status,items,ms,error?}}, errors:[],
 *             sources_attempted, sources_failed, all_failed, duration_ms }
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { createModule } = require("../modules");
const { runSource, summarize } = require("../modules/fetch-runner");

router.post("/", async (req, res) => {
  const started = Date.now();
  try {
    const { sourceId } = req.body || {};
    const sources = db.getEnabledSources();
    const toFetch = sourceId ? sources.filter((s) => s.id === sourceId) : sources;
    if (sourceId && toFetch.length === 0) {
      return res.status(404).json({ error: `Unknown or disabled source: ${sourceId}` });
    }

    const keywords = db.getKeywords(); // once per fetch, shared by every source's ingest policy
    const results = await Promise.all(
      toFetch.map((source) => runSource(source, { db, createModule, keywords })),
    );
    const summary = summarize(results);
    summary.duration_ms = Date.now() - started;
    if (summary.all_failed) {
      console.error(`FETCH: network-down? (${summary.sources_failed}/${summary.sources_attempted} sources failed)`);
    } else if (summary.sources_failed) {
      console.warn(`FETCH: ${summary.sources_failed}/${summary.sources_attempted} sources failed: ${summary.errors.map((e) => e.source).join(", ")}`);
    }
    res.json(summary);
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
