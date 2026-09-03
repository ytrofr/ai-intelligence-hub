const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { applySlotNearMissSchema, SlotNearMissStore } = require("../database/slot-near-miss-store");

// ---------------------------------------------------------------------------
// C3 - the near-miss log.
//
// A row that matched a PROJECT but no INSTRUMENT is not noise and it is not a
// failure: it is the corpus for the next slot. Nothing else produces one, so if
// it is not written at the moment the matcher says no, the evidence is gone.
//
// The store owns its own DDL and takes a handle, so these run against
// `:memory:` and never touch data/hub.db.
// ---------------------------------------------------------------------------

const fresh = () => {
  const db = new Database(":memory:");
  applySlotNearMissSchema(db);
  return new SlotNearMissStore(db);
};

test("a near miss is recorded with the reason it missed and the kind it is", () => {
  const s = fresh();
  s.record({
    item_id: "dataset-foo/bar", project: "orion", kind: "dataset",
    reason: "licence-not-allowed", title: "foo/bar",
    url: "https://huggingface.co/datasets/foo/bar", seen_at: "2026-09-03T10:00:00Z",
  });
  const rows = s.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "licence-not-allowed");
  assert.equal(rows[0].kind, "dataset");
  assert.equal(rows[0].project, "orion");
});

test("re-fetching the same item keeps ONE row and moves seen_at, not first_seen_at", () => {
  // The feed re-fetches daily. Without the UNIQUE key the log would count the
  // same miss 60 times in two months and read as 60 distinct gaps.
  const s = fresh();
  const row = {
    item_id: "dataset-foo/bar", project: "orion", kind: "dataset",
    reason: "wrong-language", title: "foo/bar", url: "u",
  };
  s.record({ ...row, seen_at: "2026-09-01T00:00:00Z" });
  s.record({ ...row, seen_at: "2026-09-03T00:00:00Z" });
  const rows = s.all();
  assert.equal(rows.length, 1, "a re-fetch must not create a second row");
  assert.equal(rows[0].seen_at, "2026-09-03T00:00:00Z", "seen_at must follow the latest sighting");
  assert.equal(rows[0].first_seen_at, "2026-09-01T00:00:00Z", "first_seen_at is when the gap opened");
});

test("CONTROL: the key is the item+PROJECT pair, so two projects are two rows", () => {
  // If the key were the item alone, a reference that misses three projects'
  // instruments would be recorded once and two thirds of the gap would vanish.
  const s = fresh();
  const base = { item_id: "model-x/y", kind: "model", reason: "task-not-graded", title: "x/y", url: "u",
                 seen_at: "2026-09-03T00:00:00Z" };
  s.record({ ...base, project: "atlas" });
  s.record({ ...base, project: "apollo" });
  assert.equal(s.all().length, 2);
});

test("byReason counts the gap per reason AND per kind, so a model miss is visible", () => {
  // M7 measured the population this log starts from: 15 MODEL rows and zero
  // dataset rows. A tally that collapsed kind would report the first two months
  // of this log as if it were about datasets.
  const s = fresh();
  const at = "2026-09-03T00:00:00Z";
  s.record({ item_id: "model-a", project: "atlas", kind: "model", reason: "wrong-language", title: "a", url: "u", seen_at: at });
  s.record({ item_id: "model-b", project: "atlas", kind: "model", reason: "wrong-language", title: "b", url: "u", seen_at: at });
  s.record({ item_id: "dataset-c", project: "apollo", kind: "dataset", reason: "task-not-graded", title: "c", url: "u", seen_at: at });
  const tally = s.byReason();
  assert.deepEqual(
    tally.map((r) => [r.kind, r.reason, r.n]).sort(),
    [["dataset", "task-not-graded", 1], ["model", "wrong-language", 2]]
  );
});
