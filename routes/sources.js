/**
 * Sources Route - GET/PUT /api/sources
 * Manage data source configuration
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");

router.get("/", (req, res) => {
  try {
    const sources = db.getSources();
    res.json({ sources });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id/toggle", (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    db.toggleSource(id, enabled);
    res.json({ status: "updated", id, enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
