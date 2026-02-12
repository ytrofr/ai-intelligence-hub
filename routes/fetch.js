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

    for (const source of toFetch) {
      try {
        const module = createModule(source);
        if (!module) {
          results.errors.push({
            source: source.id,
            error: "Unknown module type",
          });
          continue;
        }

        // Check rate limit
        if (!module.canFetch(source.last_fetched_at)) {
          results.sources[source.id] = { status: "rate_limited", items: 0 };
          continue;
        }

        // Fetch items
        const items = await module.fetch();
        const count = db.upsertItems(items);

        // Update last fetched timestamp
        db.updateSourceLastFetched(source.id);

        results.sources[source.id] = { status: "success", items: count };
        results.fetched += count;
      } catch (err) {
        console.error(`Fetch error for ${source.id}:`, err.message);
        results.errors.push({ source: source.id, error: err.message });
        results.sources[source.id] = { status: "error", error: err.message };
      }
    }

    res.json(results);
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
