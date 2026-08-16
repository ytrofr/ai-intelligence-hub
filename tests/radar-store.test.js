const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore, isLoopback, STATUSES } = require("../routes/lib/radar-store");

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-"));
  fs.writeFileSync(path.join(dir, "apollo.json"), JSON.stringify({
    project: "apollo", title: "Apollo", starThreshold: 20000, topics: [{ id: "t", label: "T", blurb: "", keywords: ["x"] }],
    verdicts: { ADOPT: "a", WATCH: "w", SKIP: "s" },
    audit: [{ repo: "a/b", topic: "t", verdict: "ADOPT", status: "proposed", why: "because" }],
  }));
  return new RadarStore(dir);
}

test("listProjects returns ids from the config dir", () => {
  const s = tmpStore();
  assert.deepEqual(s.listProjects().map((p) => p.id), ["apollo"]);
});

test("load rejects unsafe/unknown project ids", () => {
  const s = tmpStore();
  assert.throws(() => s.load("../etc/passwd"), /invalid project/i);
  assert.throws(() => s.load("nope"), /unknown project/i);
  assert.equal(s.load("apollo").project, "apollo");
});

test("setStatus validates enum, updates row atomically, stamps updated_at", () => {
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "bogus"), /status must be one of/i);
  assert.throws(() => s.setStatus("apollo", "zz/zz", "accepted"), /not in radar/i);
  const row = s.setStatus("apollo", "a/b", "accepted");
  assert.equal(row.status, "accepted");
  assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}/);
  assert.equal(s.load("apollo").audit[0].status, "accepted");
  assert.deepEqual(STATUSES, ["proposed", "accepted", "done", "rejected"]);
});

test("upsertRow adds a new verdict row with defaults", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "c/d", topic: "t", verdict: "WATCH", why: "later" });
  assert.equal(row.status, "proposed");
  assert.equal(row.project, "apollo");
  assert.equal(s.load("apollo").audit.length, 2);
  assert.throws(() => s.upsertRow("apollo", { repo: "c/d", topic: "t", verdict: "MAYBE", why: "" }), /verdict/i);
});

test("isLoopback accepts only local addresses", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("192.168.1.5"), false);
  assert.equal(isLoopback(undefined), false);
});
