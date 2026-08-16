const test = require("node:test");
const assert = require("node:assert/strict");
const { upstreamView } = require("../modules/upstream-view");

const NOW = Date.parse("2026-08-16T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString();
const row = (o = {}) => ({ http_status: 200, archived: 0, pushed_at: daysAgo(3), latest_tag: "v2.1.0", ...o });

test("a repo we do not track says so instead of implying health", () => {
  const v = upstreamView(null, { now: NOW });
  assert.equal(v.label, "not tracked");
  assert.equal(v.tone, "unknown");
});

test("deleted, moved and archived all read as alarms with a shape marker", () => {
  for (const [r, label] of [
    [row({ http_status: 404 }), "DELETED"],
    [row({ http_status: 301 }), "MOVED"],
    [row({ archived: 1 }), "ARCHIVED"],
  ]) {
    const v = upstreamView(r, { now: NOW });
    assert.equal(v.label, label);
    assert.equal(v.tone, "alarm");
    assert.equal(v.mark, "⛔", "the marker must be a SHAPE, not a colour");
  }
});

test("deleted outranks archived — the strongest fact wins", () => {
  assert.equal(upstreamView(row({ http_status: 404, archived: 1 }), { now: NOW }).label, "DELETED");
});

test("a healthy repo shows its version and how recently it was pushed", () => {
  const v = upstreamView(row(), { now: NOW });
  assert.equal(v.tone, "ok");
  assert.match(v.label, /v2\.1\.0/);
  assert.match(v.label, /pushed 3d ago/);
});

test("a repo with no releases says 'no releases', never a fabricated version", () => {
  assert.match(upstreamView(row({ latest_tag: null }), { now: NOW }).label, /no releases/);
});

test("long-quiet reads as a warning, and names how long", () => {
  const v = upstreamView(row({ pushed_at: daysAgo(400) }), { now: NOW });
  assert.equal(v.tone, "warn");
  assert.match(v.label, /quiet 400d/);
});

test("a failed check reads 'check failed', never as a healthy repo", () => {
  const v = upstreamView({ http_status: null, last_error: "HTTP 500" }, { now: NOW });
  assert.equal(v.label, "check failed");
  assert.equal(v.tone, "unknown");
});

test("MOVED names the destination when the event log knows it", () => {
  // A rename that cannot say where it went is not actionable - the same lesson
  // the digest section learned.
  const v = upstreamView(row({ http_status: 301 }), { now: NOW, movedTo: "react/react" });
  assert.equal(v.label, "MOVED → react/react");
  assert.equal(v.movedTo, "react/react");
  assert.equal(upstreamView(row({ http_status: 301 }), { now: NOW }).label, "MOVED");
});
