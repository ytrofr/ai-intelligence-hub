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
  const reloaded = s.load("apollo").audit[0];
  assert.ok(!("kind" in reloaded), "an absent field must not even round-trip through JSON");
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
