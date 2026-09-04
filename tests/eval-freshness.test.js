/**
 * Eval freshness — derived at read time, and fail-closed at every unknown.
 *
 * The failure this guards is silent by construction: a benchmark stops
 * running, nothing errors, the row still says `done`, and the number on the
 * page is simply old. So the cells below are mostly about the states that must
 * NOT read as running, and each has an accepting twin — a validator that
 * refuses everything passes every refusal test ever written.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { evalFreshness, countEvalStates, indexSlots, lastRunAt, STALE_MULTIPLIER } = require("../modules/eval-freshness");

const DAY = 86400000;
const NOW = Date.parse("2026-09-04T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const projects = (ran) => [
  { id: "apollo", slots: [{ id: "design-fidelity", ran }] },
  { id: "orion", slots: [{ id: "tool-calling", ran: [] }] },
];

const EVAL = {
  slot: "apollo/design-fidelity",
  cadence_days: 90,
  runner: "scripts/run-design-eval.py",
  metric: "DQI composite median",
  first_run: "~/.claude/reports/x.md",
};

const fresh = (evalField, ran) => evalFreshness(evalField, indexSlots(projects(ran)), NOW);

// --- the seven states -----------------------------------------------------

test("no eval at all reads not-wired - absent is legal, it just is not a claim", () => {
  const f = fresh(undefined, []);
  assert.equal(f.state, "not-wired");
  assert.equal(f.ok, false);
  assert.equal(f.runs, 0);
});

test("an eval naming a slot nobody declared FAILS CLOSED, it does not read running", () => {
  const f = fresh({ ...EVAL, slot: "apollo/no-such-slot" }, [{ date: daysAgo(1) }]);
  assert.equal(f.state, "slot-missing");
  assert.equal(f.ok, false);
  assert.equal(f.slot, "apollo/no-such-slot", "the page says WHICH slot could not be found");
});

test("a wired eval with zero runs reads never-ran, distinctly from stalled", () => {
  const f = fresh(EVAL, []);
  assert.equal(f.state, "never-ran");
  assert.notEqual(f.state, "stalled", "nothing has decayed - it never started");
  assert.equal(f.age_days, null, "an eval that never ran has no age, and 0 would be a lie");
});

test("a run with no parseable date reads undated, never fresh", () => {
  assert.equal(fresh(EVAL, [{ n: 20 }]).state, "undated");
  assert.equal(fresh(EVAL, [{ date: "last tuesday" }]).state, "undated");
  assert.equal(fresh(EVAL, [{ date: "" }]).state, "undated");
});

test("inside the cadence reads running - the accepting twin", () => {
  const f = fresh(EVAL, [{ date: daysAgo(10) }]);
  assert.equal(f.state, "running");
  assert.equal(f.ok, true);
  assert.equal(f.age_days, 10);
  assert.equal(f.cadence_days, 90);
});

test("past the cadence but inside 2x reads due", () => {
  assert.equal(fresh(EVAL, [{ date: daysAgo(91) }]).state, "due");
  assert.equal(fresh(EVAL, [{ date: daysAgo(180) }]).state, "due");
});

test("older than 2x cadence reads STALLED, never running", () => {
  const f = fresh(EVAL, [{ date: daysAgo(181) }]);
  assert.equal(f.state, "stalled");
  assert.equal(f.ok, false);
  assert.equal(STALE_MULTIPLIER, 2, "the multiplier is a judgement and is printed on the page");
});

test("the boundaries land on the generous side, and each side is asserted", () => {
  assert.equal(fresh(EVAL, [{ date: daysAgo(90) }]).state, "running", "exactly at cadence is still running");
  assert.equal(fresh(EVAL, [{ date: daysAgo(91) }]).state, "due");
  assert.equal(fresh(EVAL, [{ date: daysAgo(180) }]).state, "due", "exactly at 2x is still due");
  assert.equal(fresh(EVAL, [{ date: daysAgo(181) }]).state, "stalled");
});

// --- the log is read correctly -------------------------------------------

test("the LATEST dated run wins, whatever order the log is in", () => {
  const f = fresh(EVAL, [{ date: daysAgo(400) }, { date: daysAgo(5) }, { date: daysAgo(200) }]);
  assert.equal(f.state, "running");
  assert.equal(f.age_days, 5);
  assert.equal(f.runs, 3, "runs counts every entry, dated or not");
});

test("an undated entry beside a dated one does not hide the dated one", () => {
  const f = fresh(EVAL, [{ n: 20 }, { date: daysAgo(3) }]);
  assert.equal(f.state, "running");
  assert.equal(f.runs, 2);
});

test("`at` is read as well as `date` - ground-truth writes one and the config the other", () => {
  assert.equal(lastRunAt({ ran: [{ at: "2026-09-01" }] }), Date.parse("2026-09-01"));
  assert.equal(lastRunAt({ ran: [{ date: "2026-09-01" }] }), Date.parse("2026-09-01"));
  assert.equal(lastRunAt({ ran: [] }), null);
  assert.equal(lastRunAt(undefined), null);
});

test("a run dated in the FUTURE clamps to 0 rather than going negative", () => {
  const f = fresh(EVAL, [{ date: new Date(NOW + 10 * DAY).toISOString().slice(0, 10) }]);
  assert.equal(f.age_days, 0);
  assert.equal(f.state, "running");
});

test("an eval with no cadence cannot be judged, so it reads undated - not running", () => {
  const f = fresh({ ...EVAL, cadence_days: null }, [{ date: daysAgo(1) }]);
  assert.equal(f.state, "undated");
  assert.notEqual(f.state, "running", "a run one day old proves nothing without a cadence to compare it to");
});

// --- colour never travels alone ------------------------------------------

test("every state carries a WORD and a SHAPE, so hue is never the only channel", () => {
  const cases = [
    fresh(undefined, []),
    fresh({ ...EVAL, slot: "x/y" }, []),
    fresh(EVAL, []),
    fresh(EVAL, [{ n: 1 }]),
    fresh(EVAL, [{ date: daysAgo(1) }]),
    fresh(EVAL, [{ date: daysAgo(100) }]),
    fresh(EVAL, [{ date: daysAgo(400) }]),
  ];
  assert.equal(new Set(cases.map((c) => c.state)).size, 7, "all seven states are reachable from real inputs");
  for (const c of cases) {
    assert.ok(c.word && c.word.length > 2, `no word for ${c.state}`);
    assert.ok(c.shape && c.shape.length >= 1, `no shape for ${c.state}`);
  }
  assert.equal(new Set(cases.map((c) => c.word)).size, 7, "seven states, seven words - none reads like another");
});

test("only `running` is ok - every other state is a thing to look at", () => {
  const okStates = [
    fresh(undefined, []), fresh({ ...EVAL, slot: "x/y" }, []), fresh(EVAL, []),
    fresh(EVAL, [{ n: 1 }]), fresh(EVAL, [{ date: daysAgo(1) }]),
    fresh(EVAL, [{ date: daysAgo(100) }]), fresh(EVAL, [{ date: daysAgo(400) }]),
  ].filter((c) => c.ok);
  assert.deepEqual(okStates.map((c) => c.state), ["running"]);
});

// --- counting -------------------------------------------------------------

test("countEvalStates counts only WIRED rows, and its parts sum to `wired`", () => {
  const rows = [
    fresh(undefined, []),
    fresh(undefined, []),
    fresh(EVAL, [{ date: daysAgo(1) }]),
    fresh(EVAL, [{ date: daysAgo(100) }]),
    fresh(EVAL, [{ date: daysAgo(400) }]),
    fresh(EVAL, []),
  ];
  const c = countEvalStates(rows);
  assert.equal(c.wired, 4, "the two not-wired rows are not a denominator for anything");
  assert.equal(c.running, 1);
  assert.equal(c.due, 1);
  assert.equal(c.stalled, 1);
  assert.equal(c.never_ran, 1);
  assert.equal(c.running + c.due + c.stalled + c.never_ran + c.slot_missing + c.undated, c.wired);
});

test("CONTROL: an empty input counts zero everywhere, and does not throw", () => {
  assert.deepEqual(countEvalStates([]), {
    wired: 0, running: 0, due: 0, stalled: 0, never_ran: 0, slot_missing: 0, undated: 0,
  });
  assert.deepEqual(countEvalStates(), {
    wired: 0, running: 0, due: 0, stalled: 0, never_ran: 0, slot_missing: 0, undated: 0,
  });
});

test("indexSlots keys on project/slot, and a project with no slots contributes none", () => {
  const idx = indexSlots([{ id: "a", slots: [{ id: "s1" }] }, { id: "b" }, { id: "c", slots: [] }]);
  assert.deepEqual([...idx.keys()], ["a/s1"]);
});
