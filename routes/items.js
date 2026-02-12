/**
 * Items Route - GET /api/items
 * Returns items with advanced filtering, sorting, and FTS5 search
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");

router.get("/", (req, res) => {
  try {
    const {
      sources,
      search,
      dateFrom,
      dateTo,
      scoreMin,
      scoreMax,
      bookmarksOnly,
      sortBy = "score",
      sortOrder = "DESC",
      limit = 100,
      offset = 0,
    } = req.query;

    const sourceList = sources ? sources.split(",").filter(Boolean) : null;

    const items = db.getItems({
      sources: sourceList,
      search,
      dateFrom,
      dateTo,
      scoreMin: scoreMin !== undefined ? parseFloat(scoreMin) : undefined,
      scoreMax: scoreMax !== undefined ? parseFloat(scoreMax) : undefined,
      bookmarksOnly: bookmarksOnly === "true",
      sortBy,
      sortOrder,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    // Apply keyword scoring
    const keywords = db.getKeywords();
    const scoredItems = items.map((item) => ({
      ...item,
      relevanceScore: calculateRelevance(item, keywords),
    }));

    // If not sorting by score, skip re-sorting
    if (sortBy === "score") {
      scoredItems.sort((a, b) => {
        const scoreA = (a.score || 0) + (a.relevanceScore || 0);
        const scoreB = (b.score || 0) + (b.relevanceScore || 0);
        return sortOrder === "ASC" ? scoreA - scoreB : scoreB - scoreA;
      });
    }

    res.json({
      items: scoredItems,
      count: scoredItems.length,
      total: db.getStats().totalItems,
      filters: {
        sources: sourceList,
        search,
        dateFrom,
        dateTo,
        scoreMin,
        scoreMax,
        bookmarksOnly: bookmarksOnly === "true",
        sortBy,
        sortOrder,
      },
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: error.message });
  }
});

function calculateRelevance(item, keywords) {
  let score = 0;
  const text = `${item.title} ${item.description}`.toLowerCase();

  for (const kw of keywords) {
    if (text.includes(kw.keyword.toLowerCase())) {
      score += kw.weight * 10;
    }
  }

  return score;
}

module.exports = router;
