const test = require("node:test");
const assert = require("node:assert/strict");
const { diffRepo, SEVERITY } = require("../modules/tracker-diff");

const NOW = "2026-08-16T00:00:00Z";
const daysAgo = (n, from = NOW) => new Date(Date.parse(from) - n * 864e5).toISOString();

// A row as tracked-store hands it back: current values, prev_* beside them.
const row = (over = {}) => ({
  repo: "acme/widget",
  http_status: 200,
  archived: 0,
  pushed_at: daysAgo(5),
  stars: 900,
  latest_tag: "v1.9.0",
  latest_at: daysAgo(30),
  prev_http_status: 200,
  prev_archived: 0,
  prev_pushed_at: daysAgo(6),
  prev_stars: 890,
  prev_latest_tag: "v1.9.0",
  prev_latest_at: daysAgo(30),
  prev_checked_at: daysAgo(1),
  ...over,
});

const names = (evts) => evts.map((e) => e.event).sort();
const only = (evts) => {
  assert.equal(evts.length, 1, `expected exactly one event, got ${JSON.stringify(names(evts))}`);
  return evts[0];
};

test("THE QUIET CASE — nothing changed emits zero events", () => {
  assert.deepEqual(diffRepo(row(), { now: NOW }), []);
});

test("a star count moving is not news", () => {
  assert.deepEqual(diffRepo(row({ stars: 4000 }), { now: NOW }), []);
});

test("archived false to true is an ALARM, and does not re-fire next run", () => {
  const e = only(diffRepo(row({ archived: 1, prev_archived: 0 }), { now: NOW }));
  assert.equal(e.event, "archived");
  assert.equal(e.severity, SEVERITY.ALARM);
  assert.equal(e.to, "true");
  assert.deepEqual(diffRepo(row({ archived: 1, prev_archived: 1 }), { now: NOW }), []);
});

test("a repo ALREADY archived the first time we ever see it still alarms", () => {
  // The positive control depends on this: the STATE is the alarm, not the transition.
  const first = row({ archived: 1, prev_archived: null, prev_http_status: null, prev_latest_tag: null, prev_pushed_at: null, prev_checked_at: null });
  const e = only(diffRepo(first, { now: NOW }));
  assert.equal(e.event, "archived");
  assert.equal(e.severity, SEVERITY.ALARM);
});

test("HTTP 301 is renamed, 404 is deleted, both ALARM and both fire once", () => {
  const r = only(diffRepo(row({ http_status: 301 }), { now: NOW }));
  assert.equal(r.event, "renamed");
  assert.equal(r.severity, SEVERITY.ALARM);
  assert.deepEqual(diffRepo(row({ http_status: 301, prev_http_status: 301 }), { now: NOW }), []);

  const d = only(diffRepo(row({ http_status: 404 }), { now: NOW }));
  assert.equal(d.event, "deleted");
  assert.equal(d.severity, SEVERITY.ALARM);
  assert.deepEqual(diffRepo(row({ http_status: 404, prev_http_status: 404 }), { now: NOW }), []);
});

test("v1.9.0 to v2.0.0 is a major_release ALARM; v1.9.0 to v1.9.1 is a release NOTE", () => {
  const major = only(diffRepo(row({ latest_tag: "v2.0.0" }), { now: NOW }));
  assert.equal(major.event, "major_release");
  assert.equal(major.severity, SEVERITY.ALARM);
  assert.equal(major.from, "v1.9.0");
  assert.equal(major.to, "v2.0.0");

  const minor = only(diffRepo(row({ latest_tag: "v1.9.1" }), { now: NOW }));
  assert.equal(minor.event, "release");
  assert.equal(minor.severity, SEVERITY.NOTE);
});

test("a tag that is not semver still reports as a release when it changes", () => {
  const e = only(diffRepo(row({ latest_tag: "2026.08.01", prev_latest_tag: "2026.07.01" }), { now: NOW }));
  assert.equal(e.event, "release");
});

test("the first tag we ever see is NOT announced — day one must be quiet", () => {
  // Otherwise the first run emits one 'release' per repo for 293 repos.
  assert.deepEqual(diffRepo(row({ latest_tag: "v1.9.0", prev_latest_tag: null }), { now: NOW }), []);
});

test("a repo we have never seen, 200 days without a push, is a stale WARN", () => {
  const first = row({ pushed_at: daysAgo(200), prev_pushed_at: null, prev_checked_at: null, prev_latest_tag: null });
  const e = only(diffRepo(first, { now: NOW }));
  assert.equal(e.event, "stale");
  assert.equal(e.severity, SEVERITY.WARN);
});

test("stale does NOT re-fire — it is judged at BOTH checks, not just this one", () => {
  // Already 198 days quiet at yesterday's check, so yesterday is when it fired.
  const next = row({ pushed_at: daysAgo(200), prev_pushed_at: daysAgo(199), prev_checked_at: daysAgo(1) });
  assert.deepEqual(diffRepo(next, { now: NOW }), []);
});

test("crossing the 180-day line between two checks is what fires it", () => {
  // 180 days at yesterday's check (not yet stale), 181 today (stale).
  const crossing = row({ pushed_at: daysAgo(181), prev_pushed_at: daysAgo(181), prev_checked_at: daysAgo(1) });
  assert.equal(only(diffRepo(crossing, { now: NOW })).event, "stale");
});

test("a deleted repo reports deletion only — no stale noise on top", () => {
  const evts = diffRepo(row({ http_status: 404, pushed_at: daysAgo(900), prev_pushed_at: daysAgo(899) }), { now: NOW });
  assert.deepEqual(names(evts), ["deleted"]);
});

test("a repo that is archived AND shipped a major version reports both", () => {
  const evts = diffRepo(row({ archived: 1, latest_tag: "v2.0.0" }), { now: NOW });
  assert.deepEqual(names(evts), ["archived", "major_release"]);
});

test("a failed check emits nothing — an error is not an upstream change", () => {
  const evts = diffRepo(row({ http_status: null, last_error: "HTTP 500" }), { now: NOW });
  assert.deepEqual(evts, []);
});

test("every event carries the repo and a detected_at stamp", () => {
  const e = only(diffRepo(row({ archived: 1 }), { now: NOW }));
  assert.equal(e.repo, "acme/widget");
  assert.equal(e.detected_at, NOW);
});
