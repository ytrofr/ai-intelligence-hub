/**
 * GET /api/inventory — what all nine projects are, and what they share.
 * Assembled per request; nothing stored, so nothing goes stale.
 */

const express = require("express");
const path = require("path");
const { buildInventory } = require("../modules/inventory");

const router = express.Router();
const CONFIG = path.join(__dirname, "..", "config", "projects.json");
const RADAR = path.join(__dirname, "..", "config", "radar");

router.get("/", (req, res) => {
  try {
    res.json(buildInventory({ configPath: CONFIG, radarDir: RADAR }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
