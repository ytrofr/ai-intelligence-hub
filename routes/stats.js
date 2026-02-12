/**
 * Stats Route - GET /api/stats
 * Dashboard statistics
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");

router.get("/", (req, res) => {
  try {
    const stats = db.getStats();
    const sources = db.getSources();

    res.json({
      ...stats,
      sourcesCount: sources.length,
      enabledSources: sources.filter((s) => s.enabled).length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
