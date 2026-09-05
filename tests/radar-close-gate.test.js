const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore } = require("../routes/lib/radar-store");
const { makeAdoptable } = require("./fixtures/adoption");

/**
 * The close gate: a row may not reach `done` or `rejected` without EVIDENCE and
 * a LESSON. That is what turns a decision into stack knowledge instead of
 * something that happened in a session nobody can read any more.
 *
 * Evidence SHAPE is checked in tests/radar-store.test.js, which owns the
 * commit-vs-report split. This file owns the lesson half and the interaction
 * between the two.
 *
 * Every test runs against a throwaway directory. The real radar configs are
 * gitignored and local-only, so a test writing to them would be unrecoverable.
 */
const SHA = "apollo@3f9a12c";
const REPORT = "~/.claude/reports/hub-audit-2026-08-16/spike-tool-output-budget.md";
// Operator law 2026-08-17: closing also needs the pair the operator saw and
// their verdict on it. See tests/radar-pair-gate.test.js for that half.
const PAIR_OK = "http://localhost:8776/?session=t#c1";
const ADOPT_OK = "adopt 2026-08-17T11:42Z";
const REJECT_OK = "reject 2026-08-17T11:42Z";


function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-gate-"));
  fs.writeFileSync(
    path.join(dir, "proj.json"),
    JSON.stringify({
      project: "proj",
      audit: [
        { repo: "a/one", topic: "t", verdict: "ADOPT", status: "accepted", why: "a reason", project: "proj" },
        { repo: "a/two", topic: "t", verdict: "SKIP", status: "proposed", why: "another", project: "proj" },
      ],
    }),
  );
  return { store: new RadarStore(dir), dir };
}

// --- T5: the gate, proven in both directions ---------------------------------

test("T5 done is REFUSED with no evidence and no lesson", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done"), /evidence/i);
  assert.equal(store.load("proj").audit[0].status, "accepted", "a refused close must not mutate the row");
});

test("T5 done is REFUSED with valid evidence but no lesson", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", { evidence: SHA }), /lesson/i);
  assert.equal(store.load("proj").audit[0].status, "accepted");
});

test("T5 done is REFUSED with a lesson but no evidence", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", { lesson: "quality/x.md" }), /evidence/i);
});

test("T5 whitespace satisfies neither field", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", { evidence: "  ", lesson: "  " }), /evidence/i);
  assert.throws(() => store.setStatus("proj", "a/one", "done", { evidence: SHA, lesson: "   " }), /lesson/i);
});

test("T5 done is ACCEPTED with both, and both are persisted", () => {
  const { store } = tmpStore();
  makeAdoptable(store, "proj", "a/one");
  const row = store.setStatus("proj", "a/one", "done", {
    evidence: SHA,
    lesson: "quality/measure-impact-not-existence.md",
    outcome: "shipped, fired on 2 of 3 real pages",
    pair: PAIR_OK,
    eyeballed: ADOPT_OK,
  });
  assert.equal(row.status, "done");
  assert.equal(row.evidence, SHA);
  assert.equal(row.lesson, "quality/measure-impact-not-existence.md");
  assert.equal(row.outcome, "shipped, fired on 2 of 3 real pages");
  assert.ok(row.done_at, "closing stamps done_at");
  assert.equal(store.load("proj").audit[0].lesson, "quality/measure-impact-not-existence.md", "must survive the save");
});

test("T5 rejected is gated exactly like done — a rejection is the most valuable lesson", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/two", "rejected"), /evidence/i);
  const row = store.setStatus("proj", "a/two", "rejected", {
    evidence: REPORT,
    lesson: "none - measured, nothing general",
    pair: PAIR_OK,
    eyeballed: REJECT_OK,
  });
  assert.equal(row.status, "rejected");
  assert.equal(row.lesson, "none - measured, nothing general");
});

test("T5 lesson 'none' is accepted — it is a deliberate sentence, not an empty field", () => {
  const { store } = tmpStore();
  makeAdoptable(store, "proj", "a/one");
  const row = store.setStatus("proj", "a/one", "done", { evidence: SHA, lesson: "none", pair: PAIR_OK, eyeballed: ADOPT_OK });
  assert.equal(row.lesson, "none");
});

// --- T6: the gate must not disturb anything that exists today ----------------

test("T6 open transitions are unaffected — no evidence required", () => {
  const { store } = tmpStore();
  // The ACCEPT gate (2026-09-05, tests/radar-accept-gate.test.js) wants a bench
  // on the row before accepted/trial. That is a different gate; this test is
  // about EVIDENCE, so the bench goes on first and the assertion stays.
  makeAdoptable(store, "proj", "a/two", "SKIP");
  assert.equal(store.setStatus("proj", "a/two", "accepted").status, "accepted");
  assert.equal(store.setStatus("proj", "a/two", "trial").status, "trial");
  assert.equal(store.setStatus("proj", "a/two", "proposed").status, "proposed");
});

test("T6 an unknown status is still refused, and before the evidence check", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "finished"), /status must be one of/);
});

test("T6 an unknown repo is still refused", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/nope", "accepted"), /repo not in radar/);
});

test("T6 a row that already carries evidence and lesson can close without repeating them", () => {
  // Closing a row someone already documented must not demand the fields again.
  const { store, dir } = tmpStore();
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "proj.json"), "utf-8"));
  cfg.audit[0].evidence = SHA;
  cfg.audit[0].lesson = "quality/earlier.md";
  cfg.audit[0].pair = PAIR_OK;
  cfg.audit[0].eyeballed = ADOPT_OK;
  fs.writeFileSync(path.join(dir, "proj.json"), JSON.stringify(cfg));
  makeAdoptable(store, "proj", "a/one");
  assert.equal(store.setStatus("proj", "a/one", "done").status, "done");
});

test("T6 reopening a closed row clears BOTH evidence and lesson", () => {
  // A lesson describes an outcome. Reopen the row and the outcome no longer
  // holds, so keeping the lesson would leave a stale claim behind it.
  const { store } = tmpStore();
  makeAdoptable(store, "proj", "a/one");
  store.setStatus("proj", "a/one", "done", { evidence: SHA, lesson: "quality/x.md", pair: PAIR_OK, eyeballed: ADOPT_OK });
  const row = store.setStatus("proj", "a/one", "accepted");
  assert.equal(row.evidence, undefined);
  assert.equal(row.lesson, undefined);
  assert.equal(row.done_at, undefined);
});

test("T6 upsertRow still works and carries the three new fields when given", () => {
  const { store } = tmpStore();
  const row = store.upsertRow("proj", {
    repo: "b/new", verdict: "ADOPT", topic: "t", why: "because",
    outcome: "o", evidence: SHA, lesson: "l",
  });
  assert.equal(row.status, "proposed");
  assert.equal(row.outcome, "o");
  assert.equal(row.evidence, SHA);
  assert.equal(row.lesson, "l");
});

test("T6 upsertRow never blanks an existing reason when the field is omitted", () => {
  const { store } = tmpStore();
  const row = store.upsertRow("proj", { repo: "a/one", verdict: "ADOPT" });
  assert.equal(row.why, "a reason", "the authored reason is the asset; an omitted field must not erase it");
});
