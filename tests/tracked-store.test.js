const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { applyTrackedSchema, TrackedStore } = require("../database/tracked-store");

function freshStore() {
  const db = new Database(":memory:");
  applyTrackedSchema(db);
  return { db, store: new TrackedStore(db) };
}

const snap = (over = {}) => ({
  repo: "google-gemini/deprecated-generative-ai-js",
  projects: ["atlas"],
  role: "dep",
  http_status: 200,
  archived: 0,
  pushed_at: "2026-01-02T00:00:00Z",
  stars: 1234,
  latest_tag: "v1.9.0",
  latest_at: "2026-01-01T00:00:00Z",
  ...over,
});

test("re-checking a repo moves the snapshot to prev and keeps ONE row", () => {
  const { store } = freshStore();
  store.recordSnapshot(snap());
  store.recordSnapshot(snap({ archived: 1, stars: 1300, latest_tag: "v2.0.0" }));

  assert.equal(store.count(), 1, "a second check must update, never insert a second row");
  const row = store.get("google-gemini/deprecated-generative-ai-js");
  assert.equal(row.archived, 1);
  assert.equal(row.stars, 1300);
  assert.equal(row.latest_tag, "v2.0.0");
  assert.equal(row.prev_archived, 0, "the previous snapshot must be preserved");
  assert.equal(row.prev_stars, 1234);
  assert.equal(row.prev_latest_tag, "v1.9.0");
});

test("first_tracked_at is set once and never moves; last_checked_at advances", () => {
  const { store } = freshStore();
  store.recordSnapshot(snap({ checked_at: "2026-08-01T00:00:00Z" }));
  const first = store.get(snap().repo);
  store.recordSnapshot(snap({ checked_at: "2026-08-02T00:00:00Z" }));
  const second = store.get(snap().repo);
  assert.equal(second.first_tracked_at, first.first_tracked_at);
  assert.equal(second.last_checked_at, "2026-08-02T00:00:00Z");
});

test("projects is stored as a list and comes back as a list", () => {
  const { store } = freshStore();
  store.recordSnapshot(snap({ projects: ["apollo", "lyra"] }));
  assert.deepEqual(store.get(snap().repo).projects, ["apollo", "lyra"]);
});

test("recordError keeps the previous good snapshot instead of nulling it", () => {
  const { store } = freshStore();
  store.recordSnapshot(snap());
  store.recordError(snap().repo, "HTTP 500 from api.github.com", "2026-08-16T00:00:00Z");

  const row = store.get(snap().repo);
  assert.equal(row.last_error, "HTTP 500 from api.github.com");
  assert.equal(row.last_checked_at, "2026-08-16T00:00:00Z");
  assert.equal(row.stars, 1234, "a failed check must NOT overwrite good data with nulls");
  assert.equal(row.http_status, 200);
  assert.equal(row.archived, 0);
});

test("a successful check clears a stale last_error", () => {
  const { store } = freshStore();
  store.recordSnapshot(snap());
  store.recordError(snap().repo, "boom", "2026-08-16T00:00:00Z");
  store.recordSnapshot(snap());
  assert.equal(store.get(snap().repo).last_error, null);
});

test("events are append-only — UPDATE and DELETE are refused by the database", () => {
  const { db, store } = freshStore();
  store.appendEvent({ repo: "a/b", event: "archived", from: "false", to: "true", severity: "ALARM" });
  store.appendEvent({ repo: "a/b", event: "release", from: "v1", to: "v2", severity: "NOTE" });

  assert.equal(store.eventCount(), 2);
  assert.throws(() => db.exec("UPDATE tracked_events SET event = 'x'"), /append-only/i);
  assert.throws(() => db.exec("DELETE FROM tracked_events"), /append-only/i);
  assert.equal(store.eventCount(), 2, "the refused statements must not have changed anything");
});

test("eventsSince returns only events at or after the cutoff, newest first", () => {
  const { store } = freshStore();
  store.appendEvent({ repo: "a/b", event: "release", severity: "NOTE", detected_at: "2026-08-01T00:00:00Z" });
  store.appendEvent({ repo: "c/d", event: "archived", severity: "ALARM", detected_at: "2026-08-10T00:00:00Z" });
  store.appendEvent({ repo: "e/f", event: "stale", severity: "WARN", detected_at: "2026-08-12T00:00:00Z" });

  const got = store.eventsSince("2026-08-10T00:00:00Z");
  assert.deepEqual(got.map((e) => e.repo), ["e/f", "c/d"]);
});

test("hasEvent answers whether a one-shot event already fired for a repo", () => {
  const { store } = freshStore();
  assert.equal(store.hasEvent("a/b", "stale"), false);
  store.appendEvent({ repo: "a/b", event: "stale", severity: "WARN" });
  assert.equal(store.hasEvent("a/b", "stale"), true);
  assert.equal(store.hasEvent("a/b", "archived"), false);
});

test("applyTrackedSchema is idempotent — running it twice is a no-op", () => {
  const db = new Database(":memory:");
  applyTrackedSchema(db);
  const store = new TrackedStore(db);
  store.recordSnapshot(snap());
  applyTrackedSchema(db);
  assert.equal(new TrackedStore(db).count(), 1);
});
