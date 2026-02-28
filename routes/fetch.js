/**
 * Fetch Route - POST /api/fetch
 * Triggers fetching from all enabled sources
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { createModule } = require("../modules");

router.post("/", async (req, res) => {
  try {
    const { sourceId } = req.body;
    const sources = db.getEnabledSources();
    const results = { fetched: 0, sources: {}, errors: [] };

    // Filter to specific source if requested
    const toFetch = sourceId
      ? sources.filter((s) => s.id === sourceId)
      : sources;

    const fetchPromises = toFetch.map(async (source) => {
      const module = createModule(source);
      if (!module)
        return {
          source: source.id,
          status: "error",
          error: "Unknown module type: " + source.type,
        };
      if (!module.canFetch(source.last_fetched_at)) {
        return { source: source.id, status: "rate_limited", items: 0 };
      }
      try {
        const items = await module.fetch();
        const count = db.upsertItems(items);
        db.updateSourceLastFetched(source.id);
        return { source: source.id, status: "success", items: count };
      } catch (err) {
        console.error(`Error fetching ${source.id}:`, err.message);
        return { source: source.id, status: "error", error: err.message };
      }
    });

    const settled = await Promise.allSettled(fetchPromises);
    for (const r of settled) {
      const val =
        r.status === "fulfilled"
          ? r.value
          : { source: "unknown", status: "error", error: r.reason?.message };
      if (val.status === "error") {
        results.errors.push({ source: val.source, error: val.error });
      } else {
        results.sources[val.source] = {
          status: val.status,
          items: val.items || 0,
        };
      }
      if (val.status === "success") results.fetched += val.items || 0;
    }

    res.json(results);
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
