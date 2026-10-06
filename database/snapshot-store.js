/**
 * Star snapshot store - the history that `items.stars` cannot keep.
 *
 * `items.stars` is overwritten on every upsert, so "gained this week" was not
 * computable anywhere in the hub. This table keeps one total-star reading per
 * repo per day. It is APPEND-ONLY BY CONVENTION: a second reading on the SAME
 * day replaces that day's row (a re-run must not error), but no code path
 * rewrites or deletes a past day.
 *
 * Two writers, one precedence rule: `api` (GET /repos, authoritative, carries
 * forks/issues/pushed_at) beats `trending:<period>` (total stars scraped from
 * github.com/trending). A trending re-run later the same day never downgrades
 * an api row; an api reading always replaces a trending one.
 *
 * Schema applied to a passed handle, same as tracked-store.js, so tests drive
 * `new Database(":memory:")`.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS star_snapshots (
  repo        TEXT NOT NULL,         -- owner/name, lowercase
  day         TEXT NOT NULL,         -- YYYY-MM-DD (UTC)
  stars       INTEGER NOT NULL,
  forks       INTEGER,
  open_issues INTEGER,
  pushed_at   TEXT,
  origin      TEXT NOT NULL,         -- 'api' | 'trending:daily|weekly|monthly'
  PRIMARY KEY (repo, day)
);
CREATE INDEX IF NOT EXISTS idx_snap_day ON star_snapshots(day);
`;

function applySnapshotSchema(db) {
  db.exec(SCHEMA);
}

const utcDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const slugKey = (s) => String(s || "").trim().toLowerCase();
const SLUG = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;
const isSlug = (s) => SLUG.test(slugKey(s));
const intOrNull = (v) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v));

class SnapshotStore {
  constructor(db) {
    this.db = db;
    this.upsert = db.prepare(`
      INSERT INTO star_snapshots (repo, day, stars, forks, open_issues, pushed_at, origin)
      VALUES (@repo, @day, @stars, @forks, @open_issues, @pushed_at, @origin)
      ON CONFLICT(repo, day) DO UPDATE SET
        stars       = excluded.stars,
        forks       = COALESCE(excluded.forks, star_snapshots.forks),
        open_issues = COALESCE(excluded.open_issues, star_snapshots.open_issues),
        pushed_at   = COALESCE(excluded.pushed_at, star_snapshots.pushed_at),
        origin      = excluded.origin
      WHERE excluded.origin = 'api' OR star_snapshots.origin <> 'api'
    `);
    this.selectSeries = db.prepare(
      "SELECT day, stars, origin FROM star_snapshots WHERE repo = ? AND day >= ? ORDER BY day"
    );
    this.countByOrigin = db.prepare("SELECT origin, COUNT(*) AS n FROM star_snapshots GROUP BY origin ORDER BY origin");
  }

  /** Returns true when a row was written (false = an api row for that day already outranks it). */
  record({ repo, day, stars, forks, open_issues, pushed_at, origin }) {
    const key = slugKey(repo);
    if (!isSlug(key)) throw new Error(`star_snapshots: not an owner/name slug: ${repo}`);
    const n = intOrNull(stars);
    if (n === null || n < 0) throw new Error(`star_snapshots: stars must be a non-negative integer for ${key}, got ${stars}`);
    if (!origin) throw new Error(`star_snapshots: origin is required for ${key}`);
    const info = this.upsert.run({
      repo: key,
      day: day || utcDay(),
      stars: n,
      forks: intOrNull(forks),
      open_issues: intOrNull(open_issues),
      pushed_at: pushed_at || null,
      origin,
    });
    return info.changes > 0;
  }

  /** Many rows, one transaction. Returns how many were written. */
  recordMany(rows) {
    let written = 0;
    this.db.transaction((list) => {
      for (const r of list) if (this.record(r)) written += 1;
    })(rows);
    return written;
  }

  /** [{day, stars, origin}] ascending, from `sinceDay` (inclusive). */
  series(repo, sinceDay = "0000-00-00") {
    return this.selectSeries.all(slugKey(repo), sinceDay);
  }

  /** Map repo -> series, for a page that needs many repos at once. */
  seriesMany(repos, sinceDay = "0000-00-00") {
    const keys = [...new Set((repos || []).map(slugKey).filter(Boolean))];
    const out = new Map(keys.map((k) => [k, []]));
    if (!keys.length) return out;
    const q = this.db.prepare(
      `SELECT repo, day, stars, origin FROM star_snapshots WHERE day >= ? AND repo IN (${keys.map(() => "?").join(",")}) ORDER BY repo, day`
    );
    for (const r of q.all(sinceDay, ...keys)) out.get(r.repo).push({ day: r.day, stars: r.stars, origin: r.origin });
    return out;
  }

  originCounts() {
    return this.countByOrigin.all();
  }

  /**
   * The gh-snapshot pool's item-derived legs. They live here because this
   * store is the one already bound to the real handle; they need the `items`
   * table from schema.sql.
   *   trendingSince(iso)  repos a gh-trending row was (re)fetched for since `iso`
   *   topGithubItems(n)   the top-n github* item titles (owner/name) by score
   */
  trendingSince(sinceIso) {
    return this.db
      .prepare("SELECT DISTINCT title FROM items WHERE source = 'gh-trending' AND fetched_at >= ?")
      .all(sinceIso)
      .map((r) => r.title);
  }

  topGithubItems(n = 300) {
    return this.db
      .prepare("SELECT title FROM items WHERE source LIKE 'github%' ORDER BY score DESC LIMIT ?")
      .all(n)
      .map((r) => r.title);
  }
}

module.exports = { applySnapshotSchema, SnapshotStore, utcDay, slugKey, isSlug };
