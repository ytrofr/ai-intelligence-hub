/**
 * Database Operations Module
 * Handles all SQLite operations with FTS5 hybrid search
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "hub.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Run schema
const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
db.exec(schema);

// Additive migrations for existing DBs: CREATE TABLE IF NOT EXISTS never adds
// columns, so backfill any missing ones here (idempotent, runs on every boot).
function ensureColumns(table, columns) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}
ensureColumns("sources", {
  last_status: "TEXT",
  last_error: "TEXT",
  last_item_count: "INTEGER",
  last_run_at: "TEXT",
});

// Prepared statements
const stmts = {
  // first_seen_at is set on INSERT only — omitted from UPDATE SET so it's preserved
  // across upserts. This is the cross-run dedup signal for weekly digest.
  upsertItem: db.prepare(`
    INSERT INTO items (id, source, title, url, description, author, stars, score, published_at, fetched_at, metadata, first_seen_at)
    VALUES (@id, @source, @title, @url, @description, @author, @stars, @score, @published_at, @fetched_at, @metadata, @first_seen_at)
    ON CONFLICT(id) DO UPDATE SET
      title = @title,
      description = @description,
      stars = @stars,
      score = @score,
      published_at = @published_at,
      fetched_at = @fetched_at,
      metadata = @metadata
  `),

  // Digest query: items first seen on/after a given ISO date, with star floor filter.
  // Star floor: established (>=1000) OR rising-star (>=200 AND created in last 90d via metadata).
  getItemsFirstSeenSince: db.prepare(`
    SELECT i.*
    FROM items i
    WHERE i.first_seen_at >= @since
      AND (
        i.stars >= 1000
        OR (
          i.stars >= 200
          AND COALESCE(json_extract(i.metadata, '$.created_at'), i.published_at) >= @ninetyDaysAgo
        )
      )
    ORDER BY i.score DESC
    LIMIT @limit
  `),

  insertWeeklyRun: db.prepare(`
    INSERT OR REPLACE INTO weekly_runs (run_date, item_count, channels_run, runtime_ms, cost_usd)
    VALUES (@run_date, @item_count, @channels_run, @runtime_ms, @cost_usd)
  `),

  // Basic item queries with sorting
  getItemsBase: db.prepare(`
    SELECT i.*, b.id as bookmark_id, b.note as bookmark_note
    FROM items i
    LEFT JOIN bookmarks b ON i.id = b.item_id
  `),

  // FTS5 full-text search
  searchFTS: db.prepare(`
    SELECT i.*, b.id as bookmark_id, b.note as bookmark_note,
           bm25(items_fts, 2.0, 1.0) as fts_rank
    FROM items_fts
    JOIN items i ON items_fts.rowid = i.rowid
    LEFT JOIN bookmarks b ON i.id = b.item_id
    WHERE items_fts MATCH @query
    ORDER BY fts_rank
    LIMIT @limit
  `),

  // Resilient fallback when an FTS5 query errors (e.g. exotic operator chars):
  // a REAL term-filtered LIKE search — never silently return unrelated items.
  searchLike: db.prepare(`
    SELECT i.*, b.id as bookmark_id, b.note as bookmark_note
    FROM items i
    LEFT JOIN bookmarks b ON i.id = b.item_id
    WHERE i.title LIKE @like ESCAPE '\\' OR i.description LIKE @like ESCAPE '\\'
    ORDER BY i.stars DESC, i.score DESC
    LIMIT @limit
  `),

  getItemCount: db.prepare("SELECT COUNT(*) as count FROM items"),
  getItemCountBySource: db.prepare(
    "SELECT source, COUNT(*) as count FROM items GROUP BY source",
  ),

  addBookmark: db.prepare(`
    INSERT INTO bookmarks (item_id, note, tags, created_at)
    VALUES (@item_id, @note, @tags, @created_at)
  `),

  removeBookmark: db.prepare("DELETE FROM bookmarks WHERE item_id = @item_id"),

  getBookmarks: db.prepare(`
    SELECT b.*, i.title, i.url, i.source, i.description, i.stars, i.score, i.published_at
    FROM bookmarks b
    JOIN items i ON b.item_id = i.id
    ORDER BY b.created_at DESC
  `),

  updateBookmark: db.prepare(`
    UPDATE bookmarks SET note = @note, tags = @tags, reviewed = @reviewed
    WHERE item_id = @item_id
  `),

  upsertKeyword: db.prepare(`
    INSERT INTO keywords (category, keyword, weight)
    VALUES (@category, @keyword, @weight)
    ON CONFLICT(category, keyword) DO UPDATE SET weight = @weight
  `),

  getKeywords: db.prepare("SELECT * FROM keywords"),

  upsertSource: db.prepare(`
    INSERT INTO sources (id, name, type, url, enabled, rate_limit_minutes, config)
    VALUES (@id, @name, @type, @url, @enabled, @rate_limit_minutes, @config)
    ON CONFLICT(id) DO UPDATE SET
      name = @name, type = @type, url = @url, enabled = @enabled,
      rate_limit_minutes = @rate_limit_minutes, config = @config
  `),

  getSources: db.prepare("SELECT * FROM sources"),
  getEnabledSources: db.prepare("SELECT * FROM sources WHERE enabled = 1"),
  updateSourceLastFetched: db.prepare(
    "UPDATE sources SET last_fetched_at = @last_fetched_at WHERE id = @id",
  ),
  toggleSource: db.prepare(
    "UPDATE sources SET enabled = @enabled WHERE id = @id",
  ),
  updateSourceStatus: db.prepare(
    `UPDATE sources SET last_status = @last_status, last_error = @last_error,
       last_item_count = @last_item_count, last_run_at = @last_run_at WHERE id = @id`,
  ),
  sourceStatusSummary: db.prepare(
    `SELECT COUNT(*) AS sources_total,
       SUM(CASE WHEN last_status IN ('error','timeout') THEN 1 ELSE 0 END) AS sources_failed_last_run,
       MAX(last_run_at) AS last_fetch_at
     FROM sources WHERE enabled = 1`,
  ),
  failedSources: db.prepare(
    `SELECT id, last_status, last_error, last_run_at FROM sources
     WHERE enabled = 1 AND last_status IN ('error','timeout') ORDER BY id`,
  ),

  clearOldItems: db.prepare(`
    DELETE FROM items WHERE fetched_at < datetime('now', @days || ' days')
    AND id NOT IN (SELECT item_id FROM bookmarks)
  `),
  // Per-source retention (2026-08-16): age by first_seen_at when known, else fetched_at
  clearOldItemsBySource: db.prepare(`
    DELETE FROM items WHERE source = @source
    AND COALESCE(first_seen_at, fetched_at) < datetime('now', @days || ' days')
    AND id NOT IN (SELECT item_id FROM bookmarks)
  `),
  countOldItemsBySource: db.prepare(`
    SELECT COUNT(*) AS n FROM items WHERE source = @source
    AND COALESCE(first_seen_at, fetched_at) < datetime('now', @days || ' days')
    AND id NOT IN (SELECT item_id FROM bookmarks)
  `),

  // Search history
  upsertSearchHistory: db.prepare(`
    INSERT INTO search_history (query, count, last_used_at)
    VALUES (@query, 1, @last_used_at)
    ON CONFLICT(query) DO UPDATE SET
      count = count + 1,
      last_used_at = @last_used_at
  `),

  getSearchSuggestions: db.prepare(`
    SELECT query, count FROM search_history
    WHERE query LIKE @prefix || '%'
    ORDER BY count DESC, last_used_at DESC
    LIMIT 10
  `),

  getRecentSearches: db.prepare(`
    SELECT query, count FROM search_history
    ORDER BY last_used_at DESC
    LIMIT 10
  `),

  // Saved searches
  saveSearch: db.prepare(`
    INSERT INTO saved_searches (name, query, filters, sort_by, created_at)
    VALUES (@name, @query, @filters, @sort_by, @created_at)
  `),

  getSavedSearches: db.prepare(`
    SELECT * FROM saved_searches ORDER BY created_at DESC
  `),

  deleteSavedSearch: db.prepare(`DELETE FROM saved_searches WHERE id = @id`),
};

/**
 * Build dynamic query for advanced filtering
 */
function buildAdvancedQuery(options) {
  const {
    search,
    sources,
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
  } = options;

  let query = `
    SELECT i.*, b.id as bookmark_id, b.note as bookmark_note
    FROM items i
    LEFT JOIN bookmarks b ON i.id = b.item_id
    WHERE 1=1
  `;
  const params = {};

  // Source filter
  if (sources && sources.length > 0) {
    query += ` AND i.source IN (SELECT value FROM json_each(@sources))`;
    params.sources = JSON.stringify(sources);
  }

  // Date range filter
  if (dateFrom) {
    query += ` AND i.published_at >= @dateFrom`;
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    query += ` AND i.published_at <= @dateTo`;
    params.dateTo = dateTo;
  }

  // Score filter
  if (scoreMin !== undefined) {
    query += ` AND i.score >= @scoreMin`;
    params.scoreMin = scoreMin;
  }
  if (scoreMax !== undefined) {
    query += ` AND i.score <= @scoreMax`;
    params.scoreMax = scoreMax;
  }

  // Stars filter (GitHub repo star count)
  if (starsMin !== undefined) {
    query += ` AND i.stars >= @starsMin`;
    params.starsMin = starsMin;
  }
  if (starsMax !== undefined) {
    query += ` AND i.stars <= @starsMax`;
    params.starsMax = starsMax;
  }

  // Bookmarks only filter
  if (bookmarksOnly) {
    query += ` AND b.id IS NOT NULL`;
  }

  // Sort options
  const sortColumns = {
    score: "i.score",
    date: "i.published_at",
    stars: "i.stars",
    recent: "i.fetched_at",
    title: "i.title",
  };
  const sortColumn = sortColumns[sortBy] || "i.score";
  const order = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
  query += ` ORDER BY ${sortColumn} ${order}, i.published_at DESC`;

  // Pagination
  query += ` LIMIT @limit OFFSET @offset`;
  params.limit = limit;
  params.offset = offset;

  return { query, params };
}

module.exports = {
  DB_PATH,
  // Items
  upsertItem: (item) => {
    const now = new Date().toISOString();
    return stmts.upsertItem.run({
      ...item,
      metadata: JSON.stringify(item.metadata || {}),
      fetched_at: now,
      first_seen_at: now, // ignored on UPDATE — original timestamp preserved
    });
  },

  upsertItems: (items) => {
    const insert = db.transaction((items) => {
      for (const item of items) {
        const now = new Date().toISOString();
        stmts.upsertItem.run({
          ...item,
          metadata: JSON.stringify(item.metadata || {}),
          fetched_at: now,
          first_seen_at: now, // ignored on UPDATE — original timestamp preserved
        });
      }
    });
    insert(items);
    return items.length;
  },

  // Digest query helper
  getItemsFirstSeenSince: (sinceIso, { limit = 80 } = {}) => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    return stmts.getItemsFirstSeenSince.all({
      since: sinceIso,
      ninetyDaysAgo,
      limit,
    });
  },

  // Weekly run ledger
  insertWeeklyRun: (run) =>
    stmts.insertWeeklyRun.run({
      run_date: run.run_date,
      item_count: run.item_count,
      channels_run: run.channels_run,
      runtime_ms: run.runtime_ms,
      cost_usd: run.cost_usd || 0,
    }),

  // Advanced search with FTS5 + filters
  getItems: (options = {}) => {
    const { search, ...filterOptions } = options;

    // If search query provided, use FTS5
    if (search && search.trim()) {
      const searchQuery = search.trim();

      // Record search in history
      try {
        stmts.upsertSearchHistory.run({
          query: searchQuery,
          last_used_at: new Date().toISOString(),
        });
      } catch (e) {
        // Ignore history errors
      }

      // Convert to FTS5 query format.
      // Respect explicit advanced syntax (quotes / AND OR NOT NEAR); otherwise
      // sanitize each whitespace token: phrase-quote any token containing an FTS5
      // operator char (- : . / etc.) so hyphenated terms like "context-mode" are
      // NOT parsed as a NOT-operator. A lone clean token keeps prefix matching.
      let ftsQuery;
      if (/["]/.test(searchQuery) || /\b(AND|OR|NOT|NEAR)\b/.test(searchQuery)) {
        ftsQuery = searchQuery; // user opted into advanced FTS syntax — pass through
      } else {
        const toks = searchQuery.split(/\s+/).filter(Boolean);
        if (
          toks.length === 1 &&
          /^[A-Za-z0-9_]+$/.test(toks[0]) &&
          !/\*$/.test(toks[0])
        ) {
          ftsQuery = `${toks[0]}*`; // single clean token → as-you-type prefix
        } else {
          ftsQuery = toks
            .map((t) =>
              /[^A-Za-z0-9_*]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t,
            )
            .join(" ");
        }
      }

      try {
        const ftsResults = stmts.searchFTS.all({
          query: ftsQuery,
          limit: filterOptions.limit || 100,
        });

        // Apply additional filters to FTS results
        let results = ftsResults;

        if (filterOptions.sources && filterOptions.sources.length > 0) {
          results = results.filter((r) =>
            filterOptions.sources.includes(r.source),
          );
        }
        if (filterOptions.bookmarksOnly) {
          results = results.filter((r) => r.bookmark_id);
        }
        if (filterOptions.scoreMin !== undefined) {
          results = results.filter((r) => r.score >= filterOptions.scoreMin);
        }
        if (filterOptions.starsMin !== undefined) {
          results = results.filter((r) => r.stars >= filterOptions.starsMin);
        }
        if (filterOptions.starsMax !== undefined) {
          results = results.filter((r) => r.stars <= filterOptions.starsMax);
        }

        return results;
      } catch (e) {
        // FTS syntax error → REAL term-filtered LIKE fallback (never return
        // unrelated top-scored items — that would violate no-mock-data).
        console.warn("FTS5 query failed, falling back to LIKE:", e.message);
        try {
          const like = `%${searchQuery.replace(/[%_\\]/g, "\\$&")}%`;
          return stmts.searchLike.all({
            like,
            limit: filterOptions.limit || 100,
          });
        } catch (e2) {
          console.warn("LIKE fallback also failed:", e2.message);
          return [];
        }
      }
    }

    // Build dynamic query for non-FTS searches
    const { query, params } = buildAdvancedQuery({
      ...filterOptions,
      limit: filterOptions.limit || 100,
      offset: filterOptions.offset || 0,
    });

    return db.prepare(query).all(params);
  },

  getStats: () => {
    const total = stmts.getItemCount.get();
    const bySource = stmts.getItemCountBySource.all();
    const bookmarks = stmts.getBookmarks.all();
    return {
      totalItems: total.count,
      bySource: bySource.reduce(
        (acc, s) => ({ ...acc, [s.source]: s.count }),
        {},
      ),
      bookmarkCount: bookmarks.length,
    };
  },

  // Bookmarks
  addBookmark: (itemId, note = "", tags = []) =>
    stmts.addBookmark.run({
      item_id: itemId,
      note,
      tags: JSON.stringify(tags),
      created_at: new Date().toISOString(),
    }),

  removeBookmark: (itemId) => stmts.removeBookmark.run({ item_id: itemId }),

  getBookmarks: () =>
    stmts.getBookmarks.all().map((b) => ({
      ...b,
      tags: JSON.parse(b.tags || "[]"),
    })),

  updateBookmark: (itemId, { note, tags, reviewed }) =>
    stmts.updateBookmark.run({
      item_id: itemId,
      note: note || "",
      tags: JSON.stringify(tags || []),
      reviewed: reviewed ? 1 : 0,
    }),

  // Keywords
  upsertKeywords: (keywords) => {
    const insert = db.transaction((keywords) => {
      for (const kw of keywords) {
        stmts.upsertKeyword.run(kw);
      }
    });
    insert(keywords);
  },

  getKeywords: () => stmts.getKeywords.all(),

  // Sources
  upsertSource: (source) =>
    stmts.upsertSource.run({
      id: source.id,
      name: source.name,
      type: source.type,
      url: source.url,
      enabled: source.enabled ? 1 : 0,
      rate_limit_minutes: source.rate_limit_minutes || 60,
      config: JSON.stringify({ ...source.config, color: source.color } || {}),
    }),

  getSources: () =>
    stmts.getSources.all().map((s) => ({
      ...s,
      config: JSON.parse(s.config || "{}"),
      enabled: !!s.enabled,
    })),

  getEnabledSources: () =>
    stmts.getEnabledSources.all().map((s) => ({
      ...s,
      config: JSON.parse(s.config || "{}"),
      enabled: true,
    })),

  updateSourceLastFetched: (id) =>
    stmts.updateSourceLastFetched.run({
      id,
      last_fetched_at: new Date().toISOString(),
    }),

  toggleSource: (id, enabled) =>
    stmts.toggleSource.run({ id, enabled: enabled ? 1 : 0 }),

  // Per-source fetch truth (2026-08-16)
  updateSourceStatus: (row) =>
    stmts.updateSourceStatus.run({
      id: row.id,
      last_status: row.last_status,
      last_error: row.last_error ?? null,
      last_item_count: row.last_item_count ?? 0,
      last_run_at: row.last_run_at || new Date().toISOString(),
    }),
  getSourceStatusSummary: () => ({
    ...stmts.sourceStatusSummary.get(),
    failed_sources: stmts.failedSources.all(),
  }),

  // Search history & suggestions
  getSearchSuggestions: (prefix) =>
    stmts.getSearchSuggestions.all({ prefix: prefix || "" }),

  getRecentSearches: () => stmts.getRecentSearches.all(),

  // Saved searches
  saveSearch: (name, query, filters, sortBy) =>
    stmts.saveSearch.run({
      name,
      query: query || "",
      filters: JSON.stringify(filters || {}),
      sort_by: sortBy || "score",
      created_at: new Date().toISOString(),
    }),

  getSavedSearches: () =>
    stmts.getSavedSearches.all().map((s) => ({
      ...s,
      filters: JSON.parse(s.filters || "{}"),
    })),

  deleteSavedSearch: (id) => stmts.deleteSavedSearch.run({ id }),

  // Maintenance
  clearOldItems: (days = -30) => stmts.clearOldItems.run({ days }),
  clearOldItemsBySource: (source, days) => stmts.clearOldItemsBySource.run({ source, days: -Math.abs(days) }).changes,
  countOldItemsBySource: (source, days) => stmts.countOldItemsBySource.get({ source, days: -Math.abs(days) }).n,
  vacuum: () => db.exec("VACUUM"),

  close: () => db.close(),
};
