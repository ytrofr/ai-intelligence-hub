/**
 * Tracked-repo store — the memory the upstream tracker diffs against.
 *
 * Two tables, deliberately different in kind:
 *   tracked_repos  — one row per repo, carrying the CURRENT snapshot and the
 *                    PREVIOUS one beside it. The diff needs both, and keeping
 *                    them on one row means a check is a single statement.
 *   tracked_events — APPEND-ONLY, enforced by triggers rather than by a comment.
 *                    It is the record of what upstream told us; rewriting it
 *                    would destroy the only evidence a past alarm ever fired.
 *
 * The schema is applied to a handle passed in, so tests can drive it against
 * `new Database(":memory:")` without touching data/hub.db.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracked_repos (
  repo              TEXT PRIMARY KEY,
  projects          TEXT,              -- JSON array of project ids
  role              TEXT,              -- adopted | watch | dep | control
  http_status       INTEGER,
  archived          INTEGER,
  pushed_at         TEXT,
  stars             INTEGER,
  latest_tag        TEXT,
  latest_at         TEXT,
  prev_http_status  INTEGER,
  prev_archived     INTEGER,
  prev_pushed_at    TEXT,
  prev_stars        INTEGER,
  prev_latest_tag   TEXT,
  prev_latest_at    TEXT,
  prev_checked_at   TEXT,
  first_tracked_at  TEXT,
  last_checked_at   TEXT,
  last_error        TEXT
);

CREATE TABLE IF NOT EXISTS tracked_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo         TEXT NOT NULL,
  event        TEXT NOT NULL,          -- archived | renamed | deleted | major_release | release | stale
  from_value   TEXT,
  to_value     TEXT,
  severity     TEXT NOT NULL,          -- ALARM | WARN | NOTE
  detected_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dep_cache (
  pkg          TEXT PRIMARY KEY,
  repo         TEXT NOT NULL,      -- "owner/repo" or the literal 'unresolved'
  resolved_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracked_events_detected ON tracked_events(detected_at);
CREATE INDEX IF NOT EXISTS idx_tracked_events_repo ON tracked_events(repo, event);

-- Append-only is a mechanism here, not a promise in prose.
CREATE TRIGGER IF NOT EXISTS tracked_events_no_update
BEFORE UPDATE ON tracked_events
BEGIN SELECT RAISE(ABORT, 'tracked_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS tracked_events_no_delete
BEFORE DELETE ON tracked_events
BEGIN SELECT RAISE(ABORT, 'tracked_events is append-only'); END;
`;

function applyTrackedSchema(db) {
  db.exec(SCHEMA);
}

const int = (v) => (v === null || v === undefined ? null : v === true ? 1 : v === false ? 0 : Number(v));
const nowIso = () => new Date().toISOString();

class TrackedStore {
  constructor(db) {
    this.db = db;

    // The RHS of a DO UPDATE SET is evaluated against the ORIGINAL row, so
    // `tracked_repos.x` is last run's value and `excluded.x` is this run's.
    this.upsert = db.prepare(`
      INSERT INTO tracked_repos
        (repo, projects, role, http_status, archived, pushed_at, stars, latest_tag, latest_at,
         first_tracked_at, last_checked_at, last_error)
      VALUES
        (@repo, @projects, @role, @http_status, @archived, @pushed_at, @stars, @latest_tag, @latest_at,
         @checked_at, @checked_at, NULL)
      ON CONFLICT(repo) DO UPDATE SET
        prev_http_status = tracked_repos.http_status,
        prev_archived    = tracked_repos.archived,
        prev_pushed_at   = tracked_repos.pushed_at,
        prev_stars       = tracked_repos.stars,
        prev_latest_tag  = tracked_repos.latest_tag,
        prev_latest_at   = tracked_repos.latest_at,
        prev_checked_at  = tracked_repos.last_checked_at,
        projects         = excluded.projects,
        role             = excluded.role,
        http_status      = excluded.http_status,
        archived         = excluded.archived,
        pushed_at        = excluded.pushed_at,
        stars            = excluded.stars,
        latest_tag       = excluded.latest_tag,
        latest_at        = excluded.latest_at,
        last_checked_at  = excluded.last_checked_at,
        last_error       = NULL
    `);

    // A failed check records the failure and NOTHING else. Overwriting a good
    // snapshot with the nulls of a 500 would make the next diff invent events.
    this.markError = db.prepare(`
      INSERT INTO tracked_repos (repo, first_tracked_at, last_checked_at, last_error)
      VALUES (@repo, @checked_at, @checked_at, @error)
      ON CONFLICT(repo) DO UPDATE SET
        last_checked_at = excluded.last_checked_at,
        last_error      = excluded.last_error
    `);

    this.selectOne = db.prepare("SELECT * FROM tracked_repos WHERE repo = ?");
    this.selectAll = db.prepare("SELECT * FROM tracked_repos ORDER BY repo");
    this.countRepos = db.prepare("SELECT COUNT(*) AS n FROM tracked_repos");
    this.insertEvent = db.prepare(`
      INSERT INTO tracked_events (repo, event, from_value, to_value, severity, detected_at)
      VALUES (@repo, @event, @from_value, @to_value, @severity, @detected_at)
    `);
    this.selectEventsSince = db.prepare(
      "SELECT * FROM tracked_events WHERE detected_at >= ? ORDER BY detected_at DESC, id DESC"
    );
    this.countEvents = db.prepare("SELECT COUNT(*) AS n FROM tracked_events");
    this.countEventOf = db.prepare("SELECT COUNT(*) AS n FROM tracked_events WHERE repo = ? AND event = ?");
  }

  recordSnapshot(s) {
    this.upsert.run({
      repo: s.repo,
      projects: JSON.stringify(s.projects || []),
      role: s.role || null,
      http_status: int(s.http_status),
      archived: int(s.archived),
      pushed_at: s.pushed_at || null,
      stars: int(s.stars),
      latest_tag: s.latest_tag || null,
      latest_at: s.latest_at || null,
      checked_at: s.checked_at || nowIso(),
    });
  }

  recordError(repo, error, checkedAt) {
    this.markError.run({ repo, error: String(error).slice(0, 500), checked_at: checkedAt || nowIso() });
  }

  get(repo) {
    return hydrate(this.selectOne.get(repo));
  }

  all() {
    return this.selectAll.all().map(hydrate);
  }

  count() {
    return this.countRepos.get().n;
  }

  appendEvent(e) {
    this.insertEvent.run({
      repo: e.repo,
      event: e.event,
      from_value: e.from === undefined || e.from === null ? null : String(e.from),
      to_value: e.to === undefined || e.to === null ? null : String(e.to),
      severity: e.severity,
      detected_at: e.detected_at || nowIso(),
    });
  }

  eventsSince(iso) {
    return this.selectEventsSince.all(iso);
  }

  eventCount() {
    return this.countEvents.get().n;
  }

  hasEvent(repo, event) {
    return this.countEventOf.get(repo, event).n > 0;
  }

  /** Cache adapter for modules/dep-resolve.js — 247 package lookups a day otherwise. */
  depCache() {
    const get = this.db.prepare("SELECT repo, resolved_at FROM dep_cache WHERE pkg = ?");
    const set = this.db.prepare(
      "INSERT INTO dep_cache (pkg, repo, resolved_at) VALUES (?, ?, ?) ON CONFLICT(pkg) DO UPDATE SET repo = excluded.repo, resolved_at = excluded.resolved_at"
    );
    return {
      get: (pkg) => get.get(pkg) || undefined,
      set: (pkg, v) => set.run(pkg, v.repo, v.resolved_at),
    };
  }
}

function hydrate(row) {
  if (!row) return null;
  let projects = [];
  try {
    projects = JSON.parse(row.projects || "[]");
  } catch {
    projects = [];
  }
  return { ...row, projects };
}

module.exports = { applyTrackedSchema, TrackedStore, TRACKED_SCHEMA: SCHEMA };
