/**
 * Bookmarks Route - CRUD for saved items
 */

const express = require("express");
const router = express.Router();
const db = require("../database/db");

// Get all bookmarks
router.get("/", (req, res) => {
  try {
    const bookmarks = db.getBookmarks();
    res.json({ bookmarks, count: bookmarks.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add bookmark
router.post("/", (req, res) => {
  try {
    const { itemId, note, tags } = req.body;
    if (!itemId) {
      return res.status(400).json({ error: "itemId required" });
    }
    db.addBookmark(itemId, note, tags);
    res.json({ status: "added", itemId });
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      return res.json({
        status: "already_bookmarked",
        itemId: req.body.itemId,
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update bookmark
router.patch("/:itemId", (req, res) => {
  try {
    const { itemId } = req.params;
    const { note, tags, reviewed } = req.body;
    db.updateBookmark(itemId, { note, tags, reviewed });
    res.json({ status: "updated", itemId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove bookmark
router.delete("/:itemId", (req, res) => {
  try {
    const { itemId } = req.params;
    db.removeBookmark(itemId);
    res.json({ status: "removed", itemId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
