const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore, STATUSES } = require("../routes/lib/radar-store");
const { isLoopback } = require("../routes/lib/net");
const { makeAdoptable } = require("./fixtures/adoption");

// Operator law 2026-08-17: closing also needs the pair the operator saw and their
// verdict on it. See tests/radar-pair-gate.test.js for that half of the gate.
const PAIR_OK = "http://localhost:8776/?session=t#c1";
const ADOPT_OK = "adopt 2026-08-17T11:42Z";
const REJECT_OK = "reject 2026-08-17T11:42Z";

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
  // `trial` sits between accepted and closed: a timeboxed spike that is actually
  // running, which is a different thing from one we agreed to and never started.
  assert.deepEqual(STATUSES, ["proposed", "accepted", "trial", "done", "rejected"]);
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
  makeAdoptable(s, "apollo", "a/b");
  const row = s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c", lesson: "none", pair: PAIR_OK, eyeballed: ADOPT_OK });
  assert.equal(row.status, "done");
  assert.equal(row.evidence, "apollo@3f9a12c");
  assert.ok(row.done_at, "done_at must be stamped");
  assert.equal(s.load("apollo").audit[0].evidence, "apollo@3f9a12c", "and persisted");
});

test("accepted and proposed still need no evidence — only CLOSING does", () => {
  // Accepting is a decision; closing is a claim about the world. Only the claim
  // needs backing, or the gate would just make the radar tedious.
  for (const status of ["accepted", "proposed", "trial"]) {
    const s = tmpStore();
    assert.equal(s.setStatus("apollo", "a/b", status).status, status);
  }
});

test("REJECTED is gated too, and takes a report rather than a commit", () => {
  // Widened from 'only done is gated' (70be45b) on the operator's instruction:
  // a row may not close without a lesson, and rejecting IS closing. A rejection
  // is also the highest-value row in the ledger - "we measured this and got
  // 3.58%" is what stops another project spending a week finding out - so it
  // cannot be the one closure that records nothing.
  //
  // Its evidence is a different SHAPE: a rejection built nothing, so it has no
  // commit. Demanding a sha would make rejections unclosable.
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "rejected"), /evidence/i);
  assert.throws(
    () => s.setStatus("apollo", "a/b", "rejected", { evidence: "~/.claude/reports/spike.md" }),
    /lesson/i,
  );
  const row = s.setStatus("apollo", "a/b", "rejected", {
    evidence: "~/.claude/reports/hub-audit-2026-08-16/spike-tool-output-budget.md",
    lesson: "quality/measure-impact-not-existence.md",
    pair: PAIR_OK,
    eyeballed: REJECT_OK,
  });
  assert.equal(row.status, "rejected");
  assert.equal(row.lesson, "quality/measure-impact-not-existence.md");
});

test("a sentence is not evidence for a rejection either", () => {
  const s = tmpStore();
  assert.throws(
    () => s.setStatus("apollo", "a/b", "rejected", { evidence: "it was not very good", lesson: "none" }),
    /evidence must name/i,
  );
});

test("a report path is NOT accepted as evidence for done — done means built", () => {
  // Positive control on the shape split: if a report satisfied `done`, the two
  // branches would be one branch and the distinction would be decorative.
  const s = tmpStore();
  assert.throws(
    () => s.setStatus("apollo", "a/b", "done", { evidence: "~/.claude/reports/spike.md", lesson: "none" }),
    /evidence must name/i,
  );
});

test("closing requires a LESSON as well as evidence", () => {
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c" }), /lesson/i);
  assert.equal(s.load("apollo").audit[0].status, "proposed", "the refused write must not have landed");
  makeAdoptable(s, "apollo", "a/b");
  const row = s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c", lesson: "none - nothing general", pair: PAIR_OK, eyeballed: ADOPT_OK });
  assert.equal(row.lesson, "none - nothing general");
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
    makeAdoptable(t, "apollo", "a/b");
    assert.equal(t.setStatus("apollo", "a/b", "done", { evidence: ok, lesson: "none", pair: PAIR_OK, eyeballed: ADOPT_OK }).evidence, ok, `${ok} should be accepted`);
  }
});

test("moving OFF done clears the evidence rather than leaving a stale claim", () => {
  const s = tmpStore();
  makeAdoptable(s, "apollo", "a/b");
  s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c", lesson: "quality/x.md", pair: PAIR_OK, eyeballed: ADOPT_OK });
  const row = s.setStatus("apollo", "a/b", "accepted");
  assert.equal(row.evidence, undefined, "evidence for a done-ness that no longer holds is a lie");
  assert.equal(row.done_at, undefined);
});

// 2026-09-05. Filing the shadcn-ui/ui row surfaced this: POST /api/radar/status
// with { status: "accepted", lesson: "..." } answered 200 { ok: true } and wrote
// no lesson. The DELETION is deliberate and stays - a row moving off `done` is
// reopened, and evidence for a closure that no longer holds is a stale claim.
// What was wrong is that the branch cannot tell "reopening a closed row" from
// "recording on an open row", so the second case got the first case's treatment
// and a success code. `upsertRow` persists both fields, so the caller has a door
// that works; the fix is to say so instead of answering a false yes.
test("setStatus REFUSES evidence/lesson on a non-closing status and names the door that keeps them", () => {
  const s = tmpStore();
  assert.throws(
    () => s.setStatus("apollo", "a/b", "accepted", { lesson: "quality/x.md" }),
    /lesson.*closure|upsertRow|\/row/i,
  );
  assert.throws(
    () => s.setStatus("apollo", "a/b", "trial", { evidence: "apollo@3f9a12c" }),
    /evidence.*closure|upsertRow|\/row/i,
  );
  // The refusal must leave the row exactly as it was - same discipline the
  // closing gate already follows.
  assert.equal(s.load("apollo").audit[0].status, "proposed");
});

test("REGRESSION GUARD: reopening a closed row still clears them, and does NOT refuse", () => {
  // This is the case the refusal must not break: the caller passes no evidence,
  // the row carries one from its closure, and moving off `done` clears it. A
  // naive guard reading the ROW rather than the CALL would 400 here and make
  // every closed row unreopenable.
  const s = tmpStore();
  makeAdoptable(s, "apollo", "a/b");
  s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c", lesson: "quality/x.md", pair: PAIR_OK, eyeballed: ADOPT_OK });
  const row = s.setStatus("apollo", "a/b", "accepted");
  assert.equal(row.evidence, undefined);
  assert.equal(row.lesson, undefined);
});

test("pair and eyeballed are NOT closure-only - they survive a non-closing status", () => {
  // Guarding the behaviour the refusal above must not swallow. The operator's
  // verdict on a pair is an answer about the CANDIDATE, not about a closure:
  // acting on an ADOPT verdict moves the row OFF `rejected`, and deleting the
  // answer at the moment it is honoured is the bug that comment records.
  const s = tmpStore();
  const row = s.setStatus("apollo", "a/b", "accepted", { pair: PAIR_OK, eyeballed: ADOPT_OK });
  assert.equal(row.pair, PAIR_OK);
  assert.equal(row.eyeballed, ADOPT_OK);
  assert.equal(s.load("apollo").audit[0].eyeballed, ADOPT_OK);
});

// Found by my own CONTROL, one minute after shipping the refusal above: the
// control call (`accepted`, no fields) is supposed to be the harmless arm, and
// it DELETED the evidence and lesson that `upsertRow` had legitimately written
// on a row that had never been closed. The refusal stopped the false yes and
// left the data loss standing - a fix that reads complete because the thing it
// fixed did stop happening.
//
// The reopen behaviour is the one to keep, so the test is which row it applies
// to: `done_at` exists only after a closing status, so it is the only field that
// distinguishes "this was closed and is being reopened" from "this was never
// closed at all".
test("a status change does NOT destroy evidence/lesson on a row that was never closed", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT", evidence: "apollo@3f9a12c", lesson: "quality/x.md" });
  const row = s.setStatus("apollo", "a/b", "accepted");
  assert.equal(row.evidence, "apollo@3f9a12c", "the row was never closed - there is no stale claim to clear");
  assert.equal(row.lesson, "quality/x.md");
  assert.equal(s.load("apollo").audit[0].lesson, "quality/x.md", "and it survives the round-trip to disk");
});

test("POSITIVE CONTROL for the test above: a row that WAS closed still gets cleared", () => {
  // Without this pair the test above passes just as well against a build that
  // never clears anything, which is the behaviour the reopen case exists to
  // forbid. Two cells, one distinguishing question.
  const s = tmpStore();
  makeAdoptable(s, "apollo", "a/b");
  s.setStatus("apollo", "a/b", "done", { evidence: "apollo@3f9a12c", lesson: "quality/x.md", pair: PAIR_OK, eyeballed: ADOPT_OK });
  assert.equal(s.load("apollo").audit[0].evidence, "apollo@3f9a12c");
  const row = s.setStatus("apollo", "a/b", "accepted");
  assert.equal(row.evidence, undefined);
  assert.equal(row.lesson, undefined);
  assert.equal(row.done_at, undefined);
});
