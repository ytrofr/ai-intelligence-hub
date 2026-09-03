/**
 * The near-miss log — what matched a PROJECT but no INSTRUMENT.
 *
 * `matched_projects` says a reference is about something a project does.
 * `matched_slots` says it can actually GRADE one of our instruments. The gap
 * between those two is the whole point of this table: a reference that reaches
 * the operator's feed and grades nothing is not noise and not a failure, it is
 * the corpus for the next slot — and nothing else produces one. If it is not
 * written at the moment the matcher says no, the evidence never existed.
 *
 * Two decisions that are load-bearing:
 *
 *  - **UNIQUE(item_id, project)**, not UNIQUE(item_id). The feed re-fetches
 *    daily, so without a key the same miss would be counted sixty times in two
 *    months and read as sixty distinct gaps. And the key is the PAIR because one
 *    reference can miss three projects' instruments for three different reasons;
 *    keying on the item alone would keep one of them and silently drop the rest.
 *
 *  - **`kind` is stored, never inferred.** M7 measured the population this log
 *    starts from: 15 MODEL rows and zero dataset rows. A tally that collapsed
 *    kind would render the first two months of real gaps as if they were about
 *    datasets, or as no gaps at all.
 *
 * The schema is applied to a handle passed in, so tests drive it against
 * `new Database(":memory:")` without touching data/hub.db.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS slot_near_miss (
  item_id        TEXT NOT NULL,
  project        TEXT NOT NULL,
  kind           TEXT NOT NULL,     -- dataset | model
  reason         TEXT NOT NULL,     -- the DEEPEST gate a slot of that kind reached
  title          TEXT,
  url            TEXT,
  first_seen_at  TEXT NOT NULL,     -- when the gap opened
  seen_at        TEXT NOT NULL,     -- the latest sighting
  UNIQUE(item_id, project)
);

CREATE INDEX IF NOT EXISTS idx_slot_near_miss_reason ON slot_near_miss(kind, reason);
CREATE INDEX IF NOT EXISTS idx_slot_near_miss_seen ON slot_near_miss(seen_at);
`;

function applySlotNearMissSchema(db) {
  db.exec(SCHEMA);
}

class SlotNearMissStore {
  constructor(db) {
    this.db = db;
    // first_seen_at is set on INSERT only and deliberately omitted from the
    // UPDATE, so a daily re-fetch moves seen_at and preserves when the gap opened.
    this.upsert = db.prepare(`
      INSERT INTO slot_near_miss (item_id, project, kind, reason, title, url, first_seen_at, seen_at)
      VALUES (@item_id, @project, @kind, @reason, @title, @url, @seen_at, @seen_at)
      ON CONFLICT(item_id, project) DO UPDATE SET
        kind = @kind, reason = @reason, title = @title, url = @url, seen_at = @seen_at
    `);
  }

  record(row) {
    if (!row || !row.item_id || !row.project || !row.reason) return;
    this.upsert.run({
      item_id: String(row.item_id),
      project: String(row.project),
      kind: String(row.kind || "dataset"),
      reason: String(row.reason),
      title: row.title == null ? null : String(row.title),
      url: row.url == null ? null : String(row.url),
      seen_at: String(row.seen_at || new Date().toISOString()),
    });
  }

  /** Newest gap first — the log is read to decide what slot to declare next. */
  all({ limit = 200 } = {}) {
    return this.db
      .prepare(`SELECT * FROM slot_near_miss ORDER BY seen_at DESC, item_id ASC LIMIT ?`)
      .all(limit);
  }

  /** The tally the page and the digest read. kind is never collapsed away. */
  byReason() {
    return this.db
      .prepare(
        `SELECT kind, reason, COUNT(*) AS n FROM slot_near_miss
          GROUP BY kind, reason ORDER BY n DESC, kind ASC, reason ASC`
      )
      .all();
  }

  forProject(project, { limit = 50 } = {}) {
    return this.db
      .prepare(
        `SELECT * FROM slot_near_miss WHERE project = ? ORDER BY seen_at DESC LIMIT ?`
      )
      .all(project, limit);
  }

  count() {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM slot_near_miss`).get().n;
  }
}

module.exports = { applySlotNearMissSchema, SlotNearMissStore, SCHEMA };
