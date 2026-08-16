const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore, STATUSES } = require("../routes/lib/radar-store");
const { isLoopback } = require("../routes/lib/net");

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

// --- the evidence gate: "done" must name the commit that did it --------------

test("DONE WITHOUT EVIDENCE IS REFUSED, and the row is left UNCHANGED", () => {
  // The whole point of the gate: a refusal that half-applied would be worse than
  // no gate, because the row would read 'done' with nothing behind it.
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "done"), /evidence/i);
  const row = s.load("apollo").audit[0];
  assert.equal(row.status, "proposed", "the refused write must not have landed");
  assert.equal(row.done_at, undefined);
  assert.equal(row.evidence, undefined);
});

test("done WITH evidence is stored, and stamps done_at", () => {
  const s = tmpStore();
  const row = s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c" });
  assert.equal(row.status, "done");
  assert.equal(row.evidence, "apollo@3f9a12c");
  assert.ok(row.done_at, "done_at must be stamped");
  assert.equal(s.load("apollo").audit[0].evidence, "apollo@3f9a12c", "and persisted");
});

test("accepted, rejected and proposed still need no evidence", () => {
  // Accepting is a decision; done is a claim about the world. Only the claim
  // needs backing, or the gate would just make the radar tedious.
  for (const status of ["accepted", "rejected", "proposed"]) {
    const s = tmpStore();
    assert.equal(s.setStatus("apollo", "a/b", status).status, status);
  }
});

test("whitespace is not evidence", () => {
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "done", { evidence: "   " }), /evidence/i);
  assert.equal(s.load("apollo").audit[0].status, "proposed");
});

test("evidence must look like a commit, a PR or a URL — not a sentence", () => {
  // 'we did this ages ago' is exactly the unverifiable click the gate replaces.
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "done", { evidence: "we did this ages ago" }), /evidence/i);
  for (const ok of ["apollo@3f9a12c", "hermes#123", "https://github.com/a/b/pull/7", "3f9a12c"]) {
    const t = tmpStore();
    assert.equal(t.setStatus("apollo", "a/b", "done", { evidence: ok }).evidence, ok, `${ok} should be accepted`);
  }
});

test("moving OFF done clears the evidence rather than leaving a stale claim", () => {
  const s = tmpStore();
  s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c" });
  const row = s.setStatus("apollo", "a/b", "accepted");
  assert.equal(row.evidence, undefined, "evidence for a done-ness that no longer holds is a lie");
  assert.equal(row.done_at, undefined);
});
