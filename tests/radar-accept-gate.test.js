const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore } = require("../routes/lib/radar-store");
const { BENCH_OK } = require("./fixtures/adoption");

/**
 * The ACCEPT gate: a row may not reach `accepted` or `trial` for a project
 * without a BENCH on that project's own row — a run, on that project's own
 * data, written as { run, date, result }.
 *
 * Operator law 2026-09-05, verbatim: "i want to be sure we test and measure
 * everything per project before we adopt so we base it on measure and data and
 * insights and not guess." Measured the same day: 12 rows sat `accepted` with
 * no bench on any project, because `accepted` needed nothing.
 *
 * The close gate (done/rejected) is tests/radar-close-gate.test.js and
 * tests/radar-pair-gate.test.js. This file owns the transition BEFORE those.
 *
 * Every test runs against a throwaway directory. The real radar configs are
 * gitignored and local-only, so a test writing to them would be unrecoverable.
 */
const SHA = "apollo@3f9a12c";
const REPORT = "~/.claude/reports/spike.md";
const PAIR_OK = "http://localhost:8776/?session=t#c1";
const REJECT_OK = "reject 2026-09-05T11:42Z";

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-accept-"));
  fs.writeFileSync(
    path.join(dir, "proj.json"),
    JSON.stringify({
      project: "proj",
      audit: [
        // A LEGACY row: accepted before the law, no bench. Left as-is by the
        // gate — it reads "run it or drop it" on the scorecard, it is not
        // rewritten by a store that merely loads it.
        { repo: "a/one", topic: "t", verdict: "ADOPT", status: "accepted", why: "a reason", project: "proj" },
        { repo: "a/two", topic: "t", verdict: "ADOPT", status: "proposed", why: "another", project: "proj" },
      ],
    }),
  );
  // A second project (hermes) that DID bench a/two. Its bench must not satisfy proj's
  // gate: one bench per project, on that project's own data.
  fs.writeFileSync(
    path.join(dir, "hermes.json"),
    JSON.stringify({
      project: "hermes",
      audit: [
        { repo: "a/two", topic: "t", verdict: "ADOPT", status: "proposed", why: "theirs", project: "hermes", bench: BENCH_OK },
      ],
    }),
  );
  return { store: new RadarStore(dir), dir };
}

// --- refused without a bench ------------------------------------------------

test("accepted is REFUSED on a row with no bench, and the row is untouched", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/two", "accepted"), /bench/i);
  assert.throws(() => store.setStatus("proj", "a/two", "accepted"), /proj/);
  const row = store.load("proj").audit.find((r) => r.repo === "a/two");
  assert.equal(row.status, "proposed", "a refused accept must not mutate the row");
  assert.equal(row.bench, undefined);
});

test("trial is REFUSED on a row with no bench", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/two", "trial"), /bench/i);
  assert.equal(store.load("proj").audit.find((r) => r.repo === "a/two").status, "proposed");
});

test("the refusal names the fix: run it on THIS project's data, then upsertRow the bench", () => {
  const { store } = tmpStore();
  let msg = "";
  try {
    store.setStatus("proj", "a/two", "accepted");
  } catch (e) {
    msg = e.message;
  }
  assert.match(msg, /run it on proj/i);
  assert.match(msg, /upsertRow|\/api\/radar\/row/);
});

test("a bench on ANOTHER project's row does not satisfy this project", () => {
  const { store } = tmpStore();
  // `hermes` benched a/two; `proj` did not. One bench per project.
  assert.equal(store.load("hermes").audit[0].bench.run, BENCH_OK.run, "fixture: other really carries the bench");
  assert.throws(() => store.setStatus("proj", "a/two", "accepted"), /bench/i);
  // and the project that DID bench it may accept it
  assert.equal(store.setStatus("hermes", "a/two", "accepted").status, "accepted");
});

// --- allowed with a bench ----------------------------------------------------

test("accepted is ALLOWED once the row carries a bench, and the bench survives", () => {
  const { store } = tmpStore();
  store.upsertRow("proj", { repo: "a/two", verdict: "ADOPT", bench: BENCH_OK });
  const row = store.setStatus("proj", "a/two", "accepted");
  assert.equal(row.status, "accepted");
  const saved = store.load("proj").audit.find((r) => r.repo === "a/two");
  assert.equal(saved.status, "accepted");
  assert.deepEqual(saved.bench, BENCH_OK);
});

test("trial is ALLOWED once the row carries a bench", () => {
  const { store } = tmpStore();
  store.upsertRow("proj", { repo: "a/two", verdict: "ADOPT", bench: BENCH_OK });
  assert.equal(store.setStatus("proj", "a/two", "trial").status, "trial");
});

// --- the other transitions are not this gate's business -----------------------

test("proposed needs no bench", () => {
  const { store } = tmpStore();
  assert.equal(store.setStatus("proj", "a/one", "proposed").status, "proposed");
});

test("rejected needs no bench — a rejected candidate was never adopted", () => {
  const { store } = tmpStore();
  const row = store.setStatus("proj", "a/two", "rejected", {
    evidence: REPORT,
    lesson: "none - measured, not worth it",
    pair: PAIR_OK,
    eyeballed: REJECT_OK,
  });
  assert.equal(row.status, "rejected");
});

test("a legacy accepted row is left alone by an unrelated upsertRow — no retroactive rewrite", () => {
  const { store } = tmpStore();
  store.upsertRow("proj", { repo: "a/one", verdict: "ADOPT", why: "edited the reason only" });
  const row = store.load("proj").audit.find((r) => r.repo === "a/one");
  assert.equal(row.status, "accepted", "upsertRow does not enforce the transition gate");
  assert.equal(row.bench, undefined, "and does not invent a bench");
});

test("a legacy accepted row moving to trial IS gated — that is the row the law is for", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "trial"), /bench/i);
});
