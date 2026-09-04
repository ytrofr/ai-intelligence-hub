const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore } = require("../routes/lib/radar-store");
const { buildLedger, scoreTotal, funnel } = require("../modules/ledger");

// H3 — adoption fields: kind, cost_tier, hardware_fit/hardware_mib, slot,
// features, score. All optional, fail-closed on an invalid value, absent means
// unchanged (legacy rows must never gain a field they didn't have).

function tmpStore(auditRow = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adoption-fields-"));
  fs.writeFileSync(
    path.join(dir, "apollo.json"),
    JSON.stringify({
      project: "apollo",
      title: "Apollo",
      starThreshold: 20000,
      topics: [{ id: "t", label: "T", blurb: "", keywords: ["x"] }],
      verdicts: { ADOPT: "a", WATCH: "w", SKIP: "s" },
      audit: [{ repo: "a/b", topic: "t", verdict: "ADOPT", status: "proposed", why: "because", ...auditRow }],
    }),
  );
  return new RadarStore(dir);
}

const FULL_SCORE = { effort: 3, effect: 3, time: 3, impact: 3, risk: 3, basis: "estimated", note: "gut call" };

// H4 — adoption-evidence fields: bench, telemetry, before_after. Operator
// ruling 2026-09-04: a row may not reach `adopted` (i.e. status "done") without
// all three, extending the evidence/lesson/pair/eyeballed close gate.
const BENCH_OK = { run: "~/.claude/reports/bench-a-b-2026-09-04.md", date: "2026-09-04", result: "42ms p50 vs 118ms incumbent" };
const TELEMETRY_OK = { project: "apollo", counters: ["adopt_a_b_total"], url: "http://localhost:4444/api/health" };
const BEFORE_AFTER_OK = { before: "118ms p50", after: "42ms p50", window: "7d", date: "2026-09-04" };

// --- kind ---------------------------------------------------------------

test("upsertRow accepts kind repo|dataset|model (positive control)", () => {
  const s = tmpStore();
  for (const kind of ["repo", "dataset", "model"]) {
    const row = s.upsertRow("apollo", { repo: `x/${kind}`, verdict: "WATCH", kind });
    assert.equal(row.kind, kind);
  }
});

test("upsertRow REFUSES an invalid kind, row left unchanged", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", kind: "library" }), /kind/i);
  assert.equal(s.load("apollo").audit[0].kind, undefined);
});

test("kind absent leaves an existing row's kind untouched", () => {
  const s = tmpStore({ kind: "dataset" });
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", why: "still relevant" });
  assert.equal(row.kind, "dataset");
});

// --- cost_tier ------------------------------------------------------------

test("upsertRow accepts cost_tier free|free-tier|paid-later (positive control)", () => {
  const s = tmpStore();
  for (const t of ["free", "free-tier", "paid-later"]) {
    const row = s.upsertRow("apollo", { repo: `y/${t}`, verdict: "WATCH", cost_tier: t });
    assert.equal(row.cost_tier, t);
  }
});

test("upsertRow REFUSES an invalid cost_tier", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", cost_tier: "expensive" }), /cost_tier/i);
});

// --- licence ---------------------------------------------------------------

test("upsertRow accepts a licence read from the artifact (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", licence: "Apache-2.0" });
  assert.equal(row.licence, "Apache-2.0");
});

test("licence keeps a phrase SPDX cannot express - the carve-out IS the finding", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", licence: "  Apache-2.0 + src/pro carve-out  " });
  assert.equal(row.licence, "Apache-2.0 + src/pro carve-out", "trimmed, not reshaped");
});

test("upsertRow REFUSES an empty licence - never-read must stay distinct from no-licence", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", licence: "   " }), /licence/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", licence: 42 }), /licence/i);
});

test("upsertRow REFUSES an over-long licence", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", licence: "x".repeat(121) }), /licence/i);
});

test("omitting licence leaves an existing one alone, and never invents one", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", licence: "MIT" });
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT" });
  assert.equal(row.licence, "MIT");
  const fresh = s.upsertRow("apollo", { repo: "c/d", verdict: "WATCH" });
  assert.equal(fresh.licence, undefined, "a row nobody read a licence for must not gain the key");
});

// --- hardware_fit / hardware_mib ------------------------------------------

test("upsertRow accepts hardware_fit + hardware_mib (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", hardware_fit: "fits-gpu", hardware_mib: 4096 });
  assert.equal(row.hardware_fit, "fits-gpu");
  assert.equal(row.hardware_mib, 4096);
});

test("upsertRow accepts every hardware_fit enum value", () => {
  const s = tmpStore();
  for (const v of ["fits-gpu", "fits-cpu", "too-big-here", "unmeasured"]) {
    const row = s.upsertRow("apollo", { repo: `hw/${v}`, verdict: "WATCH", hardware_fit: v });
    assert.equal(row.hardware_fit, v);
  }
});

test("upsertRow REFUSES an invalid hardware_fit", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", hardware_fit: "maybe" }), /hardware_fit/i);
});

test("upsertRow REFUSES a negative or non-integer hardware_mib", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", hardware_mib: -1 }), /hardware_mib/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", hardware_mib: 3.5 }), /hardware_mib/i);
});

test("hardware_mib 0 is a valid non-negative integer (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", hardware_mib: 0 });
  assert.equal(row.hardware_mib, 0);
});

// --- slot -------------------------------------------------------------------

test("upsertRow accepts a well-formed slot (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", slot: "apollo/design-fidelity" });
  assert.equal(row.slot, "apollo/design-fidelity");
});

test("upsertRow REFUSES a malformed slot", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", slot: "Apollo/Design_Fidelity" }), /slot/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", slot: "no-slash-here" }), /slot/i);
});

// --- features -----------------------------------------------------------

test("upsertRow accepts features, deduped, order preserved (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", features: ["ocr", "captioning", "ocr"] });
  assert.deepEqual(row.features, ["ocr", "captioning"]);
});

test("upsertRow REFUSES features with a non-string or empty-string element", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", features: ["ocr", ""] }), /features/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", features: ["ocr", 5] }), /features/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", features: "ocr" }), /features/i);
});

// --- score ----------------------------------------------------------------

test("upsertRow accepts a complete score (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: FULL_SCORE });
  assert.deepEqual(row.score, FULL_SCORE);
});

test("upsertRow REFUSES a partial score — never stored as zeros", () => {
  const s = tmpStore();
  const partial = { effort: 3, effect: 3, time: 3, impact: 3, basis: "estimated", note: "x" }; // missing risk
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: partial }), /risk/i);
  assert.equal(s.load("apollo").audit[0].score, undefined, "a refused score must not partially land");
});

test("upsertRow REFUSES a score dimension out of the 1-5 range", () => {
  const s = tmpStore();
  const bad = { ...FULL_SCORE, effort: 6 };
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: bad }), /effort/i);
});

test("upsertRow REFUSES an invalid score.basis", () => {
  const s = tmpStore();
  const bad = { ...FULL_SCORE, basis: "guessed" };
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: bad }), /basis/i);
});

test("upsertRow REFUSES score with no note", () => {
  const s = tmpStore();
  const bad = { ...FULL_SCORE, note: "" };
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: bad }), /note/i);
});

test("score basis measured is REFUSED with no evidence anywhere (positive control: accepted once evidence exists)", () => {
  const s = tmpStore();
  const measured = { ...FULL_SCORE, basis: "measured" };
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: measured }),
    /evidence/i,
  );
  // now with evidence supplied in the SAME call
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: measured, evidence: "apollo@abc1234" });
  assert.equal(row.score.basis, "measured");
});

test("score basis measured is accepted when the EXISTING row already carries evidence", () => {
  const s = tmpStore({ evidence: "apollo@deadbee" });
  const measured = { ...FULL_SCORE, basis: "measured" };
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", score: measured });
  assert.equal(row.score.basis, "measured");
});

// --- bench --------------------------------------------------------------

test("upsertRow accepts a well-formed bench (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: BENCH_OK });
  assert.deepEqual(row.bench, BENCH_OK);
});

test("upsertRow REFUSES bench with an empty result — never-measured must stay distinct from measured-nothing", () => {
  const s = tmpStore();
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: { ...BENCH_OK, result: "" } }),
    /bench\.result/i,
  );
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: { ...BENCH_OK, result: "   " } }),
    /bench\.result/i,
  );
});

test("upsertRow REFUSES a malformed bench shape", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: { ...BENCH_OK, run: "not-a-report-path" } }), /bench\.run/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: { ...BENCH_OK, date: "09/04/2026" } }), /bench\.date/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: "42ms" } ), /bench/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: { run: BENCH_OK.run } }), /bench\.date/i);
});

test("upsertRow REFUSES an over-long bench.result", () => {
  const s = tmpStore();
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: { ...BENCH_OK, result: "x".repeat(201) } }),
    /bench\.result/i,
  );
});

test("omitting bench leaves an existing one alone, and never invents one", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", bench: BENCH_OK });
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT" });
  assert.deepEqual(row.bench, BENCH_OK);
  const fresh = s.upsertRow("apollo", { repo: "c/d", verdict: "WATCH" });
  assert.equal(fresh.bench, undefined, "a row never benched must not gain the key");
});

// --- telemetry ------------------------------------------------------------

test("upsertRow accepts well-formed telemetry (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: TELEMETRY_OK });
  assert.deepEqual(row.telemetry, TELEMETRY_OK);
});

test("upsertRow REFUSES telemetry with an empty counters array — a MALFORMED shape, not zero counters", () => {
  const s = tmpStore();
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: { ...TELEMETRY_OK, counters: [] } }),
    /telemetry\.counters/i,
  );
});

test("upsertRow REFUSES telemetry with a blank counter name, project or url", () => {
  const s = tmpStore();
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: { ...TELEMETRY_OK, counters: ["ok", ""] } }),
    /telemetry\.counters/i,
  );
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: { ...TELEMETRY_OK, project: "   " } }),
    /telemetry\.project/i,
  );
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: { ...TELEMETRY_OK, url: "" } }),
    /telemetry\.url/i,
  );
});

test("upsertRow REFUSES a telemetry url that is not http(s)", () => {
  const s = tmpStore();
  assert.throws(
    () => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: { ...TELEMETRY_OK, url: "localhost:4444/health" } }),
    /telemetry\.url/i,
  );
});

test("upsertRow REFUSES a malformed telemetry shape", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: "apollo" }), /telemetry/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: { ...TELEMETRY_OK, counters: "adopt_total" } }), /telemetry\.counters/i);
});

test("omitting telemetry leaves an existing one alone, and never invents one", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", telemetry: TELEMETRY_OK });
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT" });
  assert.deepEqual(row.telemetry, TELEMETRY_OK);
  const fresh = s.upsertRow("apollo", { repo: "c/d", verdict: "WATCH" });
  assert.equal(fresh.telemetry, undefined, "a row nobody wired telemetry for must not gain the key");
});

// --- before_after -----------------------------------------------------------

test("upsertRow accepts a well-formed before_after (positive control)", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: BEFORE_AFTER_OK });
  assert.deepEqual(row.before_after, BEFORE_AFTER_OK);
});

test("upsertRow REFUSES before_after with any blank subfield", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: { ...BEFORE_AFTER_OK, before: "" } }), /before_after\.before/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: { ...BEFORE_AFTER_OK, after: "   " } }), /before_after\.after/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: { ...BEFORE_AFTER_OK, window: "" } }), /before_after\.window/i);
});

test("upsertRow REFUSES a malformed before_after date or shape", () => {
  const s = tmpStore();
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: { ...BEFORE_AFTER_OK, date: "yesterday" } }), /before_after\.date/i);
  assert.throws(() => s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: "better now" }), /before_after/i);
});

test("omitting before_after leaves an existing one alone, and never invents one", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", before_after: BEFORE_AFTER_OK });
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT" });
  assert.deepEqual(row.before_after, BEFORE_AFTER_OK);
  const fresh = s.upsertRow("apollo", { repo: "c/d", verdict: "WATCH" });
  assert.equal(fresh.before_after, undefined, "a row with no comparison yet must not gain the key");
});

// --- the close gate: `done` needs all three, extending evidence/lesson/pair/eyeballed ----

const PAIR_OK = "http://localhost:8776/?session=t#c1";
const ADOPT_OK = "adopt 2026-09-04T11:42Z";
const CLOSE_FIELDS = { evidence: "apollo@3f9a12c", lesson: "none - nothing general", pair: PAIR_OK, eyeballed: ADOPT_OK };

test("done is REFUSED when bench/telemetry/before_after are all missing, even with evidence+lesson+pair+eyeballed", () => {
  const s = tmpStore();
  assert.throws(() => s.setStatus("apollo", "a/b", "done", CLOSE_FIELDS), /missing bench/i);
  assert.equal(s.load("apollo").audit[0].status, "proposed", "a refused close must not mutate the row");
});

test("done is REFUSED when only ONE of the three is missing", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT", bench: BENCH_OK, telemetry: TELEMETRY_OK });
  assert.throws(() => s.setStatus("apollo", "a/b", "done", CLOSE_FIELDS), /missing before_after/i);
  assert.equal(s.load("apollo").audit[0].status, "proposed");
});

test("done is ACCEPTED once bench+telemetry+before_after are all on the row (positive control)", () => {
  // Proves the gate can actually be satisfied — a refusal-only suite would
  // pass even if the gate refused everyone.
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT", bench: BENCH_OK, telemetry: TELEMETRY_OK, before_after: BEFORE_AFTER_OK });
  const row = s.setStatus("apollo", "a/b", "done", CLOSE_FIELDS);
  assert.equal(row.status, "done");
  assert.deepEqual(row.bench, BENCH_OK);
  assert.deepEqual(row.telemetry, TELEMETRY_OK);
  assert.deepEqual(row.before_after, BEFORE_AFTER_OK);
  const onDisk = s.load("apollo").audit[0];
  assert.deepEqual(onDisk.before_after, BEFORE_AFTER_OK, "and persisted");
});

test("rejected needs none of the three — a rejected candidate was never adopted", () => {
  const s = tmpStore();
  const row = s.setStatus("apollo", "a/b", "rejected", {
    evidence: "~/.claude/reports/spike.md",
    lesson: "none - measured, nothing general",
    pair: PAIR_OK,
    eyeballed: "reject 2026-09-04T11:42Z",
  });
  assert.equal(row.status, "rejected");
});

test("re-closing a row that already carries all three does not demand them again", () => {
  const s = tmpStore();
  s.upsertRow("apollo", { repo: "a/b", verdict: "ADOPT", bench: BENCH_OK, telemetry: TELEMETRY_OK, before_after: BEFORE_AFTER_OK });
  s.setStatus("apollo", "a/b", "done", CLOSE_FIELDS);
  s.setStatus("apollo", "a/b", "trial");
  const row = s.setStatus("apollo", "a/b", "done", CLOSE_FIELDS);
  assert.equal(row.status, "done");
  assert.deepEqual(row.bench, BENCH_OK);
});

// --- absence never mutates a legacy row -------------------------------------

test("legacy row with none of the new fields stays free of them after an unrelated update", () => {
  const s = tmpStore();
  const row = s.upsertRow("apollo", { repo: "a/b", verdict: "WATCH", why: "reconsidered" });
  assert.equal(row.kind, undefined);
  assert.equal(row.cost_tier, undefined);
  assert.equal(row.hardware_fit, undefined);
  assert.equal(row.hardware_mib, undefined);
  assert.equal(row.slot, undefined);
  assert.equal(row.features, undefined);
  assert.equal(row.score, undefined);
  assert.equal(row.bench, undefined);
  assert.equal(row.telemetry, undefined);
  assert.equal(row.before_after, undefined);
  const reloaded = s.load("apollo").audit[0];
  assert.ok(!("kind" in reloaded), "an absent field must not even round-trip through JSON");
  assert.ok(!("bench" in reloaded), "an absent bench must not even round-trip through JSON");
});

// ---------------------------------------------------------------------------
// buildLedger — carry-through, `state`, `score_total`
// ---------------------------------------------------------------------------

test("buildLedger carries kind/cost_tier/hardware_fit/slot/features/score through, first authored value wins", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/b", project: "apollo", verdict: "ADOPT", status: "accepted", kind: "dataset",
        cost_tier: "free", hardware_fit: "fits-cpu", hardware_mib: 512, slot: "apollo/x",
        features: ["ocr"], score: FULL_SCORE },
      { repo: "a/b", project: "hermes", verdict: "ADOPT", status: "accepted", kind: "dataset",
        cost_tier: "paid-later", hardware_fit: "fits-gpu", hardware_mib: 99999, slot: "apollo/y",
        features: ["captioning"], score: { ...FULL_SCORE, note: "second" } },
    ],
  });
  const row = rows.find((r) => r.repo === "a/b");
  assert.equal(row.cost_tier, "free", "first authored value wins, like why");
  assert.equal(row.hardware_fit, "fits-cpu");
  assert.equal(row.hardware_mib, 512);
  assert.equal(row.slot, "apollo/x");
  assert.deepEqual(row.features, ["ocr"]);
  assert.deepEqual(row.score, FULL_SCORE);
});

test("buildLedger carries bench/telemetry/before_after through, first authored value wins", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/b", project: "apollo", verdict: "ADOPT", status: "done",
        bench: BENCH_OK, telemetry: TELEMETRY_OK, before_after: BEFORE_AFTER_OK },
      { repo: "a/b", project: "hermes", verdict: "ADOPT", status: "accepted",
        bench: { ...BENCH_OK, result: "second project's own number" },
        telemetry: { ...TELEMETRY_OK, project: "hermes" },
        before_after: { ...BEFORE_AFTER_OK, before: "second" } },
    ],
  });
  const row = rows.find((r) => r.repo === "a/b");
  assert.deepEqual(row.bench, BENCH_OK, "first authored value wins, like why");
  assert.deepEqual(row.telemetry, TELEMETRY_OK);
  assert.deepEqual(row.before_after, BEFORE_AFTER_OK);
  // per_project keeps the SECOND project's own view — the whole point of
  // per_project is that the merge-loser's fields are not just gone.
  assert.deepEqual(row.per_project.hermes.bench, { ...BENCH_OK, result: "second project's own number" });
});

test("buildLedger done counters: doneWithAdoptionEvidence gaps on a done row missing any of the three", () => {
  const { counts } = buildLedger({
    radarRows: [
      { repo: "a/full", project: "apollo", verdict: "ADOPT", status: "done",
        bench: BENCH_OK, telemetry: TELEMETRY_OK, before_after: BEFORE_AFTER_OK },
      { repo: "a/gap", project: "apollo", verdict: "ADOPT", status: "done", bench: BENCH_OK },
    ],
  });
  assert.equal(counts.done, 2);
  assert.equal(counts.doneWithAdoptionEvidence, 1, "the gap row must not count as having full evidence");
});

test("buildLedger state is the status by default", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/b", project: "apollo", verdict: "ADOPT", status: "proposed", why: "w" }],
  });
  assert.equal(rows.find((r) => r.repo === "a/b").state, "proposed");
});

test('buildLedger state is "accepted-without-evidence" when accepted with neither evidence nor pair', () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/b", project: "apollo", verdict: "ADOPT", status: "accepted", why: "w" }],
  });
  assert.equal(rows.find((r) => r.repo === "a/b").state, "accepted-without-evidence");
});

test("buildLedger state is plain accepted once evidence OR pair is present (positive control)", () => {
  const { rows: withEvidence } = buildLedger({
    radarRows: [{ repo: "a/b", project: "apollo", verdict: "ADOPT", status: "accepted", why: "w", evidence: "apollo@abc1234" }],
  });
  assert.equal(withEvidence.find((r) => r.repo === "a/b").state, "accepted");
  const { rows: withPair } = buildLedger({
    radarRows: [{ repo: "a/b", project: "apollo", verdict: "ADOPT", status: "accepted", why: "w", pair: "http://localhost:8776/x" }],
  });
  assert.equal(withPair.find((r) => r.repo === "a/b").state, "accepted");
});

test("scoreTotal: all 3s is 60, a lopsided score is 100", () => {
  assert.equal(scoreTotal({ effort: 3, effect: 3, time: 3, impact: 3, risk: 3 }), 60);
  assert.equal(scoreTotal({ effort: 1, effect: 5, time: 1, impact: 5, risk: 1 }), 100);
});

test("buildLedger score_total is computed when the score is complete", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/b", project: "apollo", verdict: "ADOPT", status: "accepted", why: "w", score: FULL_SCORE }],
  });
  assert.equal(rows.find((r) => r.repo === "a/b").score_total, 60);
});

test('buildLedger score_total is "unscored" when there is no score', () => {
  const { rows } = buildLedger({ depRepos: [{ repo: "a/b", project: "apollo" }] });
  assert.equal(rows.find((r) => r.repo === "a/b").score_total, "unscored");
});

// ---------------------------------------------------------------------------
// funnel — per-ISO-week counts by status
// ---------------------------------------------------------------------------

test("funnel buckets rows by ISO week of first_seen, and by status", () => {
  const now = new Date("2026-08-27T12:00:00.000Z"); // ISO week 2026-W35
  const rows = [
    { status: "proposed", first_seen: "2026-08-27T00:00:00.000Z" },
    { status: "accepted", first_seen: "2026-08-27T00:00:00.000Z" },
    { status: "accepted", first_seen: "2026-08-20T00:00:00.000Z" }, // prior week
  ];
  const out = funnel(rows, { weeks: 2, now });
  assert.equal(out.weeks.length, 2);
  const thisWeek = out.weeks[out.weeks.length - 1];
  const lastWeek = out.weeks[out.weeks.length - 2];
  assert.equal(out.counts[thisWeek].proposed, 1);
  assert.equal(out.counts[thisWeek].accepted, 1);
  assert.equal(out.counts[lastWeek].accepted, 1);
});

test("funnel puts rows with no first_seen in an undated bucket, never drops them", () => {
  const rows = [{ status: "rejected" }, { status: "done" }];
  const out = funnel(rows, { weeks: 4 });
  assert.equal(out.counts.undated.rejected, 1);
  assert.equal(out.counts.undated.done, 1);
  const total = Object.values(out.counts).reduce(
    (sum, bucket) => sum + Object.values(bucket).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(total, 2, "no row may be dropped");
});

test("funnel never drops a row whose first_seen falls outside the requested window", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const rows = [{ status: "done", first_seen: "2020-01-01T00:00:00.000Z" }];
  const out = funnel(rows, { weeks: 2, now });
  const total = Object.values(out.counts).reduce(
    (sum, bucket) => sum + Object.values(bucket).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(total, 1, "an old row must still be counted somewhere, not silently dropped");
});

test("funnel does not count rows whose status is not one of the five funnel statuses", () => {
  const rows = [{ status: "in-use", first_seen: "2026-08-27T00:00:00.000Z" }];
  const out = funnel(rows, { weeks: 1, now: new Date("2026-08-27T12:00:00.000Z") });
  const total = Object.values(out.counts).reduce(
    (sum, bucket) => sum + Object.values(bucket).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(total, 0);
});

// --- the rows that closed before the gate existed --------------------------
//
// The store now refuses a NEW `done` without bench + telemetry + before_after
// plus a pair and an eyeballed stamp. Rows that reached `done` before that gate
// existed keep their status - reopening one DELETES its evidence and lesson,
// which is the highest-value content in the ledger and has no git history to
// restore from. So they are MARKED instead, and in two classes, because
// "you closed it on your own look, before we asked for the triple" and
// "nobody ever looked at this" are different admissions.

const { buildLedger: BL } = require("../modules/ledger");

test("done with the full triple stays plain `done`", () => {
  const { rows } = BL({
    radarRows: [{
      repo: "a/full", project: "apollo", status: "done", why: "x",
      evidence: "abc1234", lesson: "l", pair: "http://localhost:8776/#z",
      eyeballed: "adopt 2026-09-04",
      bench: { run: "~/r.json", date: "2026-09-04", result: "n" },
      telemetry: { project: "apollo", counters: ["c"], url: "http://localhost:8770/x" },
      before_after: { before: "1", after: "2", window: "7d", date: "2026-09-04" },
    }],
  });
  assert.equal(rows[0].state, "done", "a fully-evidenced adoption is not grandfathered");
});

test("done the operator SAW but without the triple derives done-unverified", () => {
  const { rows } = BL({
    radarRows: [{
      repo: "a/seen", project: "apollo", status: "done", why: "x",
      evidence: "abc1234", lesson: "l", pair: "http://localhost:8776/#z",
      eyeballed: "adopt 2026-08-01",
    }],
  });
  assert.equal(rows[0].state, "done-unverified");
});

test("done nobody ever eyeballed derives done-unseen, DISTINCTLY", () => {
  const { rows } = BL({
    radarRows: [{ repo: "a/unseen", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l" }],
  });
  assert.equal(rows[0].state, "done-unseen");
  assert.notEqual(rows[0].state, "done-unverified", "merging the two flattens 'you looked' into 'nobody looked'");
});

test("CONTROL: the two grandfather markers really are different strings", () => {
  // A deriveState that returned one constant would satisfy both cells above
  // if they were written separately and never compared.
  const seen = BL({ radarRows: [{ repo: "a/s", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l", eyeballed: "adopt 2026-08-01" }] }).rows[0].state;
  const unseen = BL({ radarRows: [{ repo: "a/u", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l" }] }).rows[0].state;
  assert.notEqual(seen, unseen);
  assert.match(seen, /^done-/);
  assert.match(unseen, /^done-/);
});

test("a partial triple is still unverified - two of three is not the claim", () => {
  const { rows } = BL({
    radarRows: [{
      repo: "a/partial", project: "apollo", status: "done", why: "x",
      evidence: "abc1234", lesson: "l", eyeballed: "adopt 2026-08-01",
      bench: { run: "~/r.json", date: "2026-09-04", result: "n" },
      telemetry: { project: "apollo", counters: ["c"], url: "http://localhost:8770/x" },
    }],
  });
  assert.equal(rows[0].state, "done-unverified", "before_after is missing, so the adoption cannot be shown");
});

test("the markers are counted, so the gap cannot go quiet on the page", () => {
  const { counts } = BL({
    radarRows: [
      { repo: "a/seen", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l", eyeballed: "adopt 2026-08-01" },
      { repo: "a/unseen", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l" },
      { repo: "a/unseen2", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l" },
    ],
  });
  assert.equal(counts.done, 3);
  assert.equal(counts.doneUnverified, 1);
  assert.equal(counts.doneUnseen, 2);
  assert.equal(counts.doneWithAdoptionEvidence, 0);
  assert.equal(counts.doneUnverified + counts.doneUnseen + counts.doneWithAdoptionEvidence, counts.done,
    "every done row is in exactly one of the three - a row in none of them is invisible");
});

test("accepted-without-evidence still derives as it did - the done branch did not swallow it", () => {
  const { rows } = BL({ radarRows: [{ repo: "a/acc", project: "apollo", status: "accepted", why: "x" }] });
  assert.equal(rows[0].state, "accepted-without-evidence");
});

// --- the done gate, routed by kind ----------------------------------------
//
// Same question, different answer per kind: a library shipping in production
// is observable THERE; an answer key has no runtime counters at all and is
// adopted by being wired as a recurring eval; a model can be either.
//
// Every REFUSES cell has its ACCEPTS twin. A gate that throws unconditionally
// passes every refusal test ever written.

const path2 = require("node:path");
const fs2 = require("node:fs");
const os2 = require("node:os");
const { RadarStore: RS } = require("../routes/lib/radar-store");

const EVAL_OK = {
  slot: "apollo/design-fidelity",
  cadence_days: 90,
  runner: "scripts/run-design-eval.py",
  metric: "DQI composite median",
  first_run: "~/.claude/reports/design-eval.md",
};
const BENCH_OK2 = { run: "~/.claude/reports/b.json", date: "2026-09-04", result: "median 55.7 -> 57.6" };
const TELEM_OK2 = { project: "apollo", counters: ["pages_scored"], url: "http://localhost:8770/x" };
const BA_OK2 = { before: "55.7", after: "57.6", window: "7d", date: "2026-09-04" };
const CLOSE = {
  evidence: "apollo@3f9a12c", lesson: "~/.claude/rules/quality/x.md",
  pair: "http://localhost:8776/?session=s#c", eyeballed: "adopt 2026-09-04T10:00Z",
};

function freshStore() {
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), "radar-kind-"));
  fs2.writeFileSync(
    path2.join(dir, "apollo.json"),
    JSON.stringify({
      project: "apollo", title: "Apollo", starThreshold: 20000,
      topics: [{ id: "t", label: "T", blurb: "", keywords: ["x"] }],
      verdicts: { ADOPT: "a", WATCH: "w", SKIP: "s" },
      audit: [],
    }),
  );
  return { store: new RS(dir), dir };
}

/** Close one row and report the refusal message, or null when it closed. */
function tryClose(kind, extra) {
  const { store } = freshStore();
  store.upsertRow("apollo", {
    repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind,
    bench: BENCH_OK2, before_after: BA_OK2, ...extra,
  });
  try {
    store.setStatus("apollo", "a/thing", "done", CLOSE);
    return null;
  } catch (e) {
    return e.message;
  }
}

test("kind=repo REFUSES done with an eval and no telemetry - a library ships, it does not run on a cadence", () => {
  const msg = tryClose("repo", { eval: EVAL_OK });
  assert.ok(msg, "it must refuse");
  assert.match(msg, /missing telemetry/);
});

test("ACCEPTS: kind=repo closes with telemetry - the twin, so the cell above is not vacuous", () => {
  assert.equal(tryClose("repo", { telemetry: TELEM_OK2 }), null);
});

test("an unset kind is treated as repo - the default demands telemetry", () => {
  const msg = tryClose(undefined, { eval: EVAL_OK });
  assert.ok(msg);
  assert.match(msg, /missing telemetry/);
});

test("kind=dataset REFUSES done with telemetry and no eval - an answer key has no runtime counters", () => {
  const msg = tryClose("dataset", { telemetry: TELEM_OK2 });
  assert.ok(msg, "it must refuse");
  assert.match(msg, /missing eval/);
});

test("ACCEPTS: kind=dataset closes with an eval - this is what unblocks a benchmark", () => {
  assert.equal(tryClose("dataset", { eval: EVAL_OK }), null);
});

test("kind=model closes with EITHER, and refuses with NEITHER", () => {
  assert.equal(tryClose("model", { eval: EVAL_OK }), null, "an eval is enough");
  assert.equal(tryClose("model", { telemetry: TELEM_OK2 }), null, "telemetry is enough");
  const msg = tryClose("model", {});
  assert.ok(msg, "neither is not enough");
  assert.match(msg, /missing eval or telemetry/);
});

test("bench and before_after stay required in EVERY branch", () => {
  for (const [kind, extra] of [["repo", { telemetry: TELEM_OK2 }], ["dataset", { eval: EVAL_OK }], ["model", { eval: EVAL_OK }]]) {
    const { store } = freshStore();
    store.upsertRow("apollo", { repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind, before_after: BA_OK2, ...extra });
    assert.throws(() => store.setStatus("apollo", "a/thing", "done", CLOSE), /missing bench/, `${kind} must still need a bench`);

    const { store: s2 } = freshStore();
    s2.upsertRow("apollo", { repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind, bench: BENCH_OK2, ...extra });
    assert.throws(() => s2.setStatus("apollo", "a/thing", "done", CLOSE), /missing before_after/, `${kind} must still need a before_after`);
  }
});

test("a MALFORMED eval never reaches disk - upsertRow refuses it before the close gate sees it", () => {
  // The close gate re-validates too, but the earlier refusal is the better
  // one: the row never exists in a shape the gate would have to reject.
  const { store } = freshStore();
  assert.throws(
    () => store.upsertRow("apollo", { repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind: "dataset", eval: { ...EVAL_OK, cadence_days: 7.5 } }),
    /cadence_days/,
  );
  // ACCEPTS twin: the same call with an integer cadence goes through, so the
  // refusal above is about the value and not about the shape of the call.
  assert.doesNotThrow(() =>
    store.upsertRow("apollo", { repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind: "dataset", eval: EVAL_OK }),
  );
});

test("the close gate re-validates a HAND-EDITED eval, so the file is not the only guard", () => {
  const { store, dir } = freshStore();
  store.upsertRow("apollo", { repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind: "dataset", bench: BENCH_OK2, before_after: BA_OK2 });
  // Straight past upsertRow, the way the one live malformed field arrived.
  const cfg = JSON.parse(fs2.readFileSync(path2.join(dir, "apollo.json"), "utf8"));
  cfg.audit[0].eval = { ...EVAL_OK, runner: "   " };
  fs2.writeFileSync(path2.join(dir, "apollo.json"), JSON.stringify(cfg));
  assert.throws(() => store.setStatus("apollo", "a/thing", "done", CLOSE), /eval is malformed[\s\S]*runner/);
});

test("REGRESSION: a rejected row needs none of this - it was never adopted", () => {
  const { store } = freshStore();
  store.upsertRow("apollo", { repo: "a/no", topic: "t", verdict: "SKIP", why: "x", kind: "dataset" });
  assert.doesNotThrow(() =>
    store.setStatus("apollo", "a/no", "rejected", {
      evidence: "~/.claude/reports/spike.md", lesson: "none - too slow",
      pair: "http://localhost:8776/?session=s#c", eyeballed: "reject 2026-09-04T10:00Z",
    }),
  );
});

test("a refused close leaves the row BYTE-IDENTICAL - validation runs before any write", () => {
  const { store, dir } = freshStore();
  store.upsertRow("apollo", { repo: "a/thing", topic: "t", verdict: "ADOPT", why: "x", kind: "dataset", bench: BENCH_OK2, before_after: BA_OK2 });
  const file = path2.join(dir, "apollo.json");
  const before = fs2.readFileSync(file, "utf8");
  assert.throws(() => store.setStatus("apollo", "a/thing", "done", CLOSE));
  assert.equal(fs2.readFileSync(file, "utf8"), before, "a refusal must not half-write");
});

// --- evalField, every subfield, each refusal with its accepting twin -------

test("evalField ACCEPTS a complete eval and returns it trimmed", () => {
  const { evalField } = require("../routes/lib/radar-store");
  assert.deepEqual(evalField({ ...EVAL_OK, runner: "  scripts/x.py  " }), { ...EVAL_OK, runner: "scripts/x.py" });
  assert.equal(evalField(undefined), undefined, "absent stays absent - a legacy row must not gain a field");
});

test("evalField REFUSES each subfield's bad value, and names which one", () => {
  const { evalField } = require("../routes/lib/radar-store");
  const cases = [
    ["slot", { ...EVAL_OK, slot: "nope" }, /eval\.slot/],
    ["slot missing", { ...EVAL_OK, slot: "" }, /eval\.slot/],
    ["cadence non-integer", { ...EVAL_OK, cadence_days: 7.5 }, /cadence_days/],
    ["cadence as a word", { ...EVAL_OK, cadence_days: "weekly" }, /cadence_days/],
    ["cadence 0", { ...EVAL_OK, cadence_days: 0 }, /cadence_days/],
    ["cadence 400", { ...EVAL_OK, cadence_days: 400 }, /cadence_days/],
    ["blank runner", { ...EVAL_OK, runner: "   " }, /eval\.runner/],
    ["overlong runner", { ...EVAL_OK, runner: "x".repeat(121) }, /eval\.runner/],
    ["blank metric", { ...EVAL_OK, metric: "" }, /eval\.metric/],
    ["overlong metric", { ...EVAL_OK, metric: "x".repeat(201) }, /eval\.metric/],
    // first_run is a MEASUREMENT, not a build. Same rule as bench.run: a
    // commit says code changed, not that anything was measured.
    ["commit as first_run", { ...EVAL_OK, first_run: "1a1bd6c" }, /first_run/],
    ["PR as first_run", { ...EVAL_OK, first_run: "Orion#152" }, /first_run/],
    ["URL as first_run", { ...EVAL_OK, first_run: "https://example.com/r" }, /first_run/],
    ["blank first_run", { ...EVAL_OK, first_run: "" }, /first_run/],
    ["an array", [], /eval must be an object/],
    ["null", null, /eval must be an object/],
  ];
  for (const [why, value, pattern] of cases) {
    assert.throws(() => evalField(value), pattern, `should have refused: ${why}`);
  }
});

test("CONTROL: a report path in every accepted extension still passes", () => {
  const { evalField } = require("../routes/lib/radar-store");
  for (const ext of ["md", "json", "txt", "csv", "log"]) {
    assert.doesNotThrow(() => evalField({ ...EVAL_OK, first_run: `~/.claude/reports/x.${ext}` }));
  }
  // ...so the refusals above are about the VALUE, not about the field being
  // unsatisfiable.
});
