-- AI Intelligence Hub Database Schema
-- SQLite with FTS5 for full-text search

-- Items table: All fetched items from all sources
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  author TEXT,
  stars INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  metadata TEXT -- JSON blob for source-specific data
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title,
  description,
  content='items',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, description)
  VALUES (NEW.rowid, NEW.title, NEW.description);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description)
  VALUES('delete', OLD.rowid, OLD.title, OLD.description);
END;

-- Bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL UNIQUE,
  note TEXT,
  tags TEXT, -- JSON array
  created_at TEXT NOT NULL,
  reviewed INTEGER DEFAULT 0
);

-- Keywords table for scoring
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  keyword TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  UNIQUE(category, keyword)
);

-- Source configuration
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  rate_limit_minutes INTEGER DEFAULT 60,
  last_fetched_at TEXT,
  config TEXT -- JSON blob for source-specific config
);

-- Search history for autocomplete suggestions
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL UNIQUE,
  count INTEGER DEFAULT 1,
  last_used_at TEXT NOT NULL
);

-- Saved searches
CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  query TEXT,
  filters TEXT, -- JSON: {sources, dateRange, scoreMin, bookmarksOnly}
  sort_by TEXT DEFAULT 'score',
  created_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_score ON items(score DESC);
CREATE INDEX IF NOT EXISTS idx_items_stars ON items(stars DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_item ON bookmarks(item_id);
CREATE INDEX IF NOT EXISTS idx_search_history_count ON search_history(count DESC);
CREATE INDEX IF NOT EXISTS idx_search_history_recent ON search_history(last_used_at DESC);
