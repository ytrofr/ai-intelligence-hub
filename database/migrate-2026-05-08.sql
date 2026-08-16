-- Migration: Add first_seen_at + weekly_runs (2026-05-08)
-- Plan: ~/.claude/plans/i-want-to-try-mighty-horizon.md
--
-- IDEMPOTENT — safe to run multiple times.
--
-- SQLite quirk: ALTER TABLE cannot use CURRENT_TIMESTAMP as DEFAULT (must be literal
-- constant). So we add the column nullable, backfill existing rows from fetched_at
-- (closest proxy for "first seen"), and rely on db.js to pass datetime('now') on INSERT.

-- 1. Add first_seen_at column (nullable, no default — backfilled below).
--    NOTE: re-running this on a column that already exists raises "duplicate column"
--    which sqlite3 surfaces but does not abort subsequent statements.
ALTER TABLE items ADD COLUMN first_seen_at TEXT;

-- 2. Backfill existing rows (3,828 as of 2026-05-08) — set first_seen_at = fetched_at.
UPDATE items SET first_seen_at = fetched_at WHERE first_seen_at IS NULL;

-- 3. weekly_runs ledger — one row per /api/digest/run invocation.
CREATE TABLE IF NOT EXISTS weekly_runs (
  run_date     TEXT PRIMARY KEY,    -- YYYY-MM-DD (digest filename suffix)
  item_count   INTEGER NOT NULL,
  channels_run TEXT NOT NULL,       -- comma-separated, e.g. "watchlist,perplexity,topic,awesome"
  runtime_ms   INTEGER NOT NULL,
  cost_usd     REAL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Index for digest queries.
CREATE INDEX IF NOT EXISTS idx_items_first_seen ON items(first_seen_at DESC);
