const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { applySnapshotSchema, SnapshotStore, isSlug } = require("../database/snapshot-store");

function fresh({ withItems = false } = {}) {
  const db = new Database(":memory:");
  if (withItems) db.exec(fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8"));
  applySnapshotSchema(db);
  return { db, store: new SnapshotStore(db) };
}

test("schema is idempotent and keyed on (repo, day)", () => {
  const { db } = fresh();
  applySnapshotSchema(db); // second boot must not throw
  const pk = db.prepare("PRAGMA table_info(star_snapshots)").all().filter((c) => c.pk).map((c) => c.name);
  assert.deepEqual(pk, ["repo", "day"]);
});

test("a re-run on the same day replaces that day's row instead of erroring; other days are untouched", () => {
  const { store } = fresh();
  store.record({ repo: "Owner/Repo", day: "2026-10-05", stars: 100, origin: "api" });
  store.record({ repo: "owner/repo", day: "2026-10-06", stars: 150, origin: "api" });
  store.record({ repo: "OWNER/REPO", day: "2026-10-06", stars: 160, origin: "api" });
  assert.deepEqual(store.series("owner/repo").map((r) => [r.day, r.stars]), [
    ["2026-10-05", 100],
    ["2026-10-06", 160],
  ]);
});

test("precedence: an api row is never downgraded by a later trending row the same day", () => {
  const { store } = fresh();
  assert.equal(store.record({ repo: "a/b", day: "2026-10-06", stars: 1000, forks: 9, origin: "api" }), true);
  assert.equal(store.record({ repo: "a/b", day: "2026-10-06", stars: 999, origin: "trending:weekly" }), false);
  assert.deepEqual(store.series("a/b")[0], { day: "2026-10-06", stars: 1000, origin: "api" });
});

test("precedence: an api row replaces a trending row the same day, keeping known columns", () => {
  const { db, store } = fresh();
  store.record({ repo: "a/b", day: "2026-10-06", stars: 990, forks: 7, origin: "trending:daily" });
  assert.equal(store.record({ repo: "a/b", day: "2026-10-06", stars: 1001, origin: "api" }), true);
  const row = db.prepare("SELECT * FROM star_snapshots").get();
  assert.equal(row.stars, 1001);
  assert.equal(row.origin, "api");
  assert.equal(row.forks, 7, "a null in the newer reading does not erase a known value");
});

test("bad input THROWS rather than writing a fake reading", () => {
  const { store } = fresh();
  assert.throws(() => store.record({ repo: "not-a-slug", stars: 1, origin: "api" }), /slug/);
  assert.throws(() => store.record({ repo: "a/b", stars: null, origin: "api" }), /stars/);
  assert.throws(() => store.record({ repo: "a/b", stars: -1, origin: "api" }), /stars/);
  assert.throws(() => store.record({ repo: "a/b", stars: 5 }), /origin/);
  assert.equal(isSlug("https://github.com/a/b"), false);
});

test("recordMany is one transaction: a bad row rolls the whole batch back", () => {
  const { store } = fresh();
  assert.throws(() =>
    store.recordMany([
      { repo: "a/b", day: "2026-10-06", stars: 1, origin: "api" },
      { repo: "broken", day: "2026-10-06", stars: 1, origin: "api" },
    ])
  );
  assert.deepEqual(store.originCounts(), []);
  assert.equal(store.recordMany([{ repo: "a/b", day: "2026-10-06", stars: 1, origin: "api" }]), 1);
});

test("seriesMany returns every asked repo, empty when it has no history", () => {
  const { store } = fresh();
  store.record({ repo: "a/b", day: "2026-10-01", stars: 1, origin: "api" });
  store.record({ repo: "a/b", day: "2026-10-06", stars: 5, origin: "api" });
  const m = store.seriesMany(["A/B", "c/d"], "2026-10-02");
  assert.deepEqual(m.get("a/b").map((r) => r.stars), [5]);
  assert.deepEqual(m.get("c/d"), []);
});

test("pool legs read the real items schema: trending by fetched_at, top github* by score", () => {
  const { db, store } = fresh({ withItems: true });
  const ins = db.prepare(
    "INSERT INTO items (id, source, title, url, stars, score, published_at, fetched_at, metadata, first_seen_at) VALUES (?,?,?,?,0,?,?,?,'{}',?)"
  );
  const old = "2026-09-01T00:00:00Z";
  const recent = "2026-10-05T00:00:00Z";
  ins.run("gh-trending-x-new", "gh-trending", "x/new", "", 1, recent, recent, recent);
  ins.run("gh-trending-x-old", "gh-trending", "x/old", "", 1, old, old, old);
  ins.run("github-1", "github", "g/high", "", 900, recent, recent, recent);
  ins.run("github-discovery-tech-g-mid", "github-discovery-tech", "g/mid", "", 500, recent, recent, recent);
  ins.run("hackernews-1", "hackernews", "not a repo", "", 99999, recent, recent, recent);
  assert.deepEqual(store.trendingSince("2026-09-22T00:00:00Z"), ["x/new"]);
  assert.deepEqual(store.topGithubItems(5), ["g/high", "g/mid"], "only github* sources, by score");
});
