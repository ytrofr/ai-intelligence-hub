/**
 * Search Route - Search suggestions and saved searches
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");

// GET /api/search/suggestions?q=prefix
router.get("/suggestions", (req, res) => {
  try {
    const { q = "" } = req.query;
    const suggestions = db.getSearchSuggestions(q);
    res.json({ suggestions });
  } catch (error) {
    console.error("Error getting suggestions:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/search/recent
router.get("/recent", (req, res) => {
  try {
    const recent = db.getRecentSearches();
    res.json({ searches: recent });
  } catch (error) {
    console.error("Error getting recent searches:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/search/saved
router.get("/saved", (req, res) => {
  try {
    const saved = db.getSavedSearches();
    res.json({ searches: saved });
  } catch (error) {
    console.error("Error getting saved searches:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/search/saved
router.post("/saved", (req, res) => {
  try {
    const { name, query, filters, sortBy } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    db.saveSearch(name, query, filters, sortBy);
    res.json({ success: true, message: "Search saved" });
  } catch (error) {
    console.error("Error saving search:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/search/saved/:id
router.delete("/saved/:id", (req, res) => {
  try {
    const { id } = req.params;
    db.deleteSavedSearch(parseInt(id));
    res.json({ success: true, message: "Search deleted" });
  } catch (error) {
    console.error("Error deleting saved search:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
