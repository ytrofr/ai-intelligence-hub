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
      source, // forgiving alias for `sources`
      search,
      q, // forgiving alias for `search`
      dateFrom,
      dateTo,
      scoreMin,
      scoreMax,
      starsMin,
      starsMax,
      bookmarksOnly,
      sortBy = "score",
      sortOrder = "DESC",
      limit = 100,
      offset = 0,
    } = req.query;

    const effectiveSources = sources || source;
    const effectiveSearch = search || q;
    const sourceList = effectiveSources
      ? effectiveSources.split(",").filter(Boolean)
      : null;

    const items = db.getItems({
      sources: sourceList,
      search: effectiveSearch,
      dateFrom,
      dateTo,
      scoreMin: scoreMin !== undefined ? parseFloat(scoreMin) : undefined,
      scoreMax: scoreMax !== undefined ? parseFloat(scoreMax) : undefined,
      starsMin: starsMin !== undefined ? parseInt(starsMin) : undefined,
      starsMax: starsMax !== undefined ? parseInt(starsMax) : undefined,
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
        const diff = sortOrder === "ASC" ? scoreA - scoreB : scoreB - scoreA;
        if (diff !== 0) return diff;
        // Date tiebreaker: newest first within same score
        return new Date(b.published_at || 0) - new Date(a.published_at || 0);
      });
    }

    res.json({
      items: scoredItems,
      count: scoredItems.length,
      total: db.getStats().totalItems,
      filters: {
        sources: sourceList,
        search: effectiveSearch,
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
