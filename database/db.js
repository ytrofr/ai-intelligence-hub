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

// Prepared statements
const stmts = {
  upsertItem: db.prepare(`
    INSERT INTO items (id, source, title, url, description, author, stars, score, published_at, fetched_at, metadata)
    VALUES (@id, @source, @title, @url, @description, @author, @stars, @score, @published_at, @fetched_at, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      title = @title,
      description = @description,
      stars = @stars,
      score = @score,
      published_at = @published_at,
      fetched_at = @fetched_at,
      metadata = @metadata
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

  clearOldItems: db.prepare(`
    DELETE FROM items WHERE fetched_at < datetime('now', @days || ' days')
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
  query += ` ORDER BY ${sortColumn} ${order}`;

  // Pagination
  query += ` LIMIT @limit OFFSET @offset`;
  params.limit = limit;
  params.offset = offset;

  return { query, params };
}

module.exports = {
  // Items
  upsertItem: (item) =>
    stmts.upsertItem.run({
      ...item,
      metadata: JSON.stringify(item.metadata || {}),
      fetched_at: new Date().toISOString(),
    }),

  upsertItems: (items) => {
    const insert = db.transaction((items) => {
      for (const item of items) {
        stmts.upsertItem.run({
          ...item,
          metadata: JSON.stringify(item.metadata || {}),
          fetched_at: new Date().toISOString(),
        });
      }
    });
    insert(items);
    return items.length;
  },

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

      // Convert to FTS5 query format
      // Support: AND, OR, NOT, phrases "like this", prefix*
      let ftsQuery = searchQuery;

      // If it's a simple query without operators, add wildcards
      if (!/["\s]/.test(searchQuery) && !/\*$/.test(searchQuery)) {
        ftsQuery = `${searchQuery}*`;
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

        return results;
      } catch (e) {
        // FTS query syntax error, fall back to LIKE
        console.warn("FTS5 query failed, falling back to LIKE:", e.message);
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

  close: () => db.close(),
};
