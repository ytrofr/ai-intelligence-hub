const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { buildLedger } = require("../modules/ledger");
const { buildMatrix } = require("../modules/adoption-matrix");

const scored = (over = {}) => ({ effort: 3, effect: 3, time: 3, impact: 3, risk: 3, basis: "estimated", ...over });

const PROJECTS = [
  { id: "apollo", name: "Apollo", features: [{ id: "design-scoring", label: "Score a generated page" }] },
  { id: "hermes", name: "Hermes", features: [{ id: "landing-generation", label: "Generate a landing page" }] },
];

const find = (rows, repo) => rows.find((r) => r.repo === repo);

// --- formula reuse ------------------------------------------------------

test("a complete score of all 3s rolls up to 60, via the shared scoreTotal formula", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/scored", project: "apollo", status: "accepted", why: "x", slot: "apollo/s1", score: scored() },
    ],
  });
  const { top } = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(top.length, 1);
  assert.equal(top[0].total, 60);
});

// --- exclusion + its positive control -----------------------------------

test("a bare in-use dependency (no slot/features/score) is excluded from the matrix", () => {
  const { rows } = buildLedger({ depRepos: [{ repo: "a/bare-dep", project: "apollo" }] });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(matrix.population.rows, 0, "a plain dependency has nothing to decide, so it must not appear");
  assert.equal(find(matrix.top, "a/bare-dep"), undefined);
});

test("positive control: a scored row IS included (proves the exclusion test can fail)", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/scored", project: "apollo", status: "accepted", why: "x", score: scored() }],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(matrix.population.rows, 1);
  assert.ok(find(matrix.top, "a/scored"));
});

// --- sorting -------------------------------------------------------------

test("scored rows sort by total desc, ties by impact desc then effort asc", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/low", project: "apollo", status: "accepted", why: "x", score: scored({ effect: 1, impact: 1 }) },
      { repo: "a/high", project: "apollo", status: "accepted", why: "x", score: scored({ effect: 5, impact: 5 }) },
      // Same total as a tie-break case: equal effect/impact/time/risk, but
      // lower effort -> higher total, so it must sort BEFORE the other tie.
      { repo: "a/tie-lower-effort", project: "apollo", status: "accepted", why: "x", score: scored({ effort: 1 }) },
      { repo: "a/tie-higher-effort", project: "apollo", status: "accepted", why: "x", score: scored({ effort: 5 }) },
    ],
  });
  const { top } = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const order = top.map((r) => r.repo);
  assert.deepEqual(order, ["a/high", "a/tie-lower-effort", "a/tie-higher-effort", "a/low"]);
});

// --- unscored is never a fabricated 0 -------------------------------------

test("a row with no complete score reads total 'unscored', never 0", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/partial-score", project: "apollo", status: "proposed", why: "x", slot: "apollo/s1", score: { effort: 3 } },
      { repo: "a/no-score", project: "apollo", status: "proposed", why: "x", slot: "apollo/s2" },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(matrix.unscored.length, 2);
  for (const r of matrix.unscored) {
    assert.equal(r.total, "unscored");
    assert.notEqual(r.total, 0);
  }
  assert.equal(matrix.population.scored, 0);
  assert.equal(matrix.population.unscored, 2);
});

// --- undeclared feature -----------------------------------------------------

test("a feature id the project never declared reads '(undeclared)' and is counted", () => {
  const { rows } = buildLedger({
    radarRows: [
      {
        repo: "a/mystery-feature",
        project: "apollo",
        status: "proposed",
        why: "x",
        features: ["design-scoring", "not-a-real-feature"],
      },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const row = matrix.unscored[0];
  assert.deepEqual(
    row.features,
    [
      { id: "design-scoring", label: "Score a generated page" },
      { id: "not-a-real-feature", label: "(undeclared)" },
    ],
  );
  assert.equal(matrix.population.undeclared_features, 1);
});

// --- accepted-without-evidence next_action ----------------------------------

test("accepted with no evidence and no pair gets next_action 'run it or drop it'", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/unbacked", project: "apollo", status: "accepted", why: "x", score: scored() },
    ],
  });
  const row = find(rows, "a/unbacked");
  assert.equal(row.state, "accepted-without-evidence", "sanity: the ledger itself must derive this state");
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(matrix.top[0].next_action, "run it or drop it");
});

test("proposed / trial / done / rejected map to their own next_action", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/proposed", project: "apollo", status: "proposed", why: "x", score: scored() },
      { repo: "a/trial", project: "apollo", status: "trial", why: "x", score: scored() },
      // Fully evidenced, so it stays plain `done` rather than deriving a
      // grandfather marker - the three done STATES have three next actions.
      {
        repo: "a/done", project: "apollo", status: "done", why: "x", evidence: "e", score: scored(),
        bench: { run: "~/r.json", date: "2026-09-04", result: "n" },
        telemetry: { project: "apollo", counters: ["c"], url: "http://localhost:8770/x" },
        before_after: { before: "1", after: "2", window: "7d", date: "2026-09-04" },
      },
      { repo: "a/done-seen", project: "apollo", status: "done", why: "x", evidence: "e", score: scored(), eyeballed: "adopt 2026-08-01" },
      { repo: "a/done-unseen", project: "apollo", status: "done", why: "x", evidence: "e", score: scored() },
      { repo: "a/rejected", project: "apollo", status: "rejected", why: "x", score: scored() },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const byRepo = Object.fromEntries(matrix.top.map((r) => [r.repo, r.next_action]));
  assert.equal(byRepo["a/proposed"], "score & pair");
  assert.equal(byRepo["a/trial"], "read the number");
  assert.equal(byRepo["a/done"], "adopt card");
  assert.equal(byRepo["a/rejected"], "-");
  // A grandfathered closure has no honest next action - the triple cannot be
  // reconstructed and reopening the row would delete its lesson. "-" says so;
  // a task here would imply a path that does not exist.
  assert.equal(byRepo["a/done-seen"], "-", "done-unverified has no next action");
  assert.equal(byRepo["a/done-unseen"], "-", "done-unseen has no next action either");
  assert.notEqual(byRepo["a/done"], byRepo["a/done-seen"], "an evidenced adoption and a grandfathered one must not read alike");
});

// --- project filter ----------------------------------------------------------

test("project filter keeps only that project's table and scopes top/unscored to it", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/for-apollo", project: "apollo", status: "proposed", why: "x", score: scored() },
      { repo: "a/for-hermes", project: "hermes", status: "proposed", why: "x", score: scored() },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS, project: "apollo" });
  assert.deepEqual(matrix.projects.map((p) => p.id), ["apollo"]);
  assert.equal(matrix.population.rows, 1);
  assert.equal(find(matrix.top, "a/for-hermes"), undefined);
  assert.ok(find(matrix.top, "a/for-apollo"));
});

test("a repo used by two projects becomes one candidate per project, features resolved per project", () => {
  const { rows } = buildLedger({
    radarRows: [
      {
        repo: "a/shared",
        project: "apollo",
        status: "proposed",
        why: "x",
        features: ["design-scoring", "landing-generation"],
      },
    ],
    depRepos: [{ repo: "a/shared", project: "hermes" }],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const apolloRow = matrix.projects.find((p) => p.id === "apollo").rows[0];
  const hermesRow = matrix.projects.find((p) => p.id === "hermes").rows[0];
  assert.equal(apolloRow.features.find((f) => f.id === "design-scoring").label, "Score a generated page");
  assert.equal(hermesRow.features.find((f) => f.id === "landing-generation").label, "Generate a landing page");
});

// --- parked paid-later ---------------------------------------------------

test("a paid-later row lands in parked_paid regardless of score state", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/paid", project: "apollo", status: "proposed", why: "x", slot: "apollo/s1", cost_tier: "paid-later" },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(matrix.parked_paid.length, 1);
  assert.equal(matrix.parked_paid[0].repo, "a/paid");
});

// --- the hidden population: partitioned, never dropped ---------------------
//
// The matrix used to `continue` past every ineligible row, so the page said
// "42 candidates" with no denominator anywhere. The filter itself is right -
// what was wrong is that the rows it removed left no trace. These cells pin
// the partition and the two denominators it is drawn from.

test("every (row x project) pair appears exactly once across candidates and hidden", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/scored", project: "apollo", status: "proposed", why: "x", score: scored() },
      { repo: "a/decided-bare", project: "apollo", status: "accepted", why: "x" },
    ],
    depRepos: [{ repo: "a/plain-dep", project: "apollo" }, { repo: "a/scored", project: "hermes" }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  let pairs = 0;
  for (const r of rows) pairs += (r.projects || []).length;
  assert.equal(m.population.pairs, pairs, "population.pairs must be the real denominator");
  assert.equal(
    m.population.rows + m.hidden.length,
    pairs,
    "candidates + hidden must account for every pair - no row is dropped and none is counted twice",
  );
  const seen = new Set();
  for (const r of [...m.projects.flatMap((p) => p.rows), ...m.hidden]) {
    const key = `${r.kind}:${r.repo}@${r.project}`;
    assert.ok(!seen.has(key), `${key} appears twice`);
    seen.add(key);
  }
  assert.equal(seen.size, pairs);
});

test("population.ledger_rows counts rows IN, not candidates OUT", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/scored", project: "apollo", status: "proposed", why: "x", score: scored() }],
    depRepos: [{ repo: "a/d1", project: "apollo" }, { repo: "a/d2", project: "apollo" }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(m.population.ledger_rows, 3, "the denominator is the ledger, not the page");
  assert.equal(m.population.rows, 1, "and the numerator is still only what has something to decide");
  assert.notEqual(m.population.ledger_rows, m.population.rows, "a denominator equal to the numerator is not a denominator");
});

test("a hidden pair is classified as decided or dependency, never both and never neither", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/decided-bare", project: "apollo", status: "rejected", why: "x", evidence: "~/r.md", lesson: "l" }],
    depRepos: [{ repo: "a/plain-dep", project: "apollo" }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(m.hidden.length, 2);
  assert.equal(m.population.hidden_decided, 1, "a rejected row was decided, it is not a plain dependency");
  assert.equal(m.population.hidden_dependency, 1);
  assert.equal(m.population.hidden_decided + m.population.hidden_dependency, m.hidden.length);
  assert.equal(m.hidden.find((r) => r.repo === "a/decided-bare").hidden_class, "decided");
  assert.equal(m.hidden.find((r) => r.repo === "a/plain-dep").hidden_class, "dependency");
});

test("CONTROL: an in-use dependency is NOT counted as decided, so the split can fail", () => {
  const { rows } = buildLedger({ depRepos: [{ repo: "a/only-dep", project: "apollo" }] });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(m.population.hidden_decided, 0);
  assert.equal(m.population.hidden_dependency, 1);
});

test("a repo scored by one project and unscored by another is counted for the project that never scored it", () => {
  // first-authored-wins puts hermes's score on the merged row, which would
  // hide apollo's own unscored adoption if this were counted per ROW.
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/shared", project: "hermes", status: "done", why: "x", score: scored(), evidence: "abc1234", lesson: "l" },
      { repo: "a/shared", project: "apollo", status: "done", why: "x", evidence: "abc1234", lesson: "l" },
    ],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(rows.length, 1, "the two decisions merge into one ledger row - that is the trap");
  const ids = m.adopted_unscored.map((r) => `${r.repo}@${r.project}`);
  assert.deepEqual(ids, ["a/shared@apollo"], "apollo adopted it and never scored it; hermes's score is not apollo's");
});

test("CONTROL: when BOTH projects scored it, nothing lands in adopted_unscored", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/shared", project: "hermes", status: "done", why: "x", score: scored(), evidence: "abc1234", lesson: "l" },
      { repo: "a/shared", project: "apollo", status: "done", why: "x", score: scored(), evidence: "abc1234", lesson: "l" },
    ],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.deepEqual(m.adopted_unscored, []);
});

test("a proposed row with no score is NOT adopted-but-unscored - proposing is not adopting", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/prop", project: "apollo", status: "proposed", why: "x", slot: "apollo/s1" }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.deepEqual(m.adopted_unscored, []);
});

test("the project filter scopes the hidden pile too, or the drawer contradicts its own page", () => {
  const { rows } = buildLedger({
    depRepos: [{ repo: "a/d-apollo", project: "apollo" }, { repo: "a/d-hermes", project: "hermes" }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS, project: "apollo" });
  assert.equal(m.hidden.length, 1);
  assert.equal(m.hidden[0].project, "apollo");
  assert.equal(m.population.pairs, 1, "the denominator narrows with the filter");
});

// --- route ------------------------------------------------------------------

function startApp(router) {
  const app = express();
  app.use("/api/adoption-matrix", router);
  const server = http.createServer(app);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })),
  );
}

test("GET /api/adoption-matrix returns 200 and the expected JSON shape", async () => {
  const router = require("../routes/adoption-matrix");
  const { server, base } = await startApp(router);
  try {
    const res = await fetch(`${base}/api/adoption-matrix`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.population);
    assert.ok(Array.isArray(body.projects));
    assert.ok(Array.isArray(body.top));
    assert.ok(Array.isArray(body.unscored));
    assert.ok(Array.isArray(body.parked_paid));
  } finally {
    server.close();
  }
});

test("GET /api/adoption-matrix?project=apollo returns only that project", async () => {
  const router = require("../routes/adoption-matrix");
  const { server, base } = await startApp(router);
  try {
    const res = await fetch(`${base}/api/adoption-matrix?project=apollo`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.projects.every((p) => p.id === "apollo"));
  } finally {
    server.close();
  }
});

test("parked_paid merges slot-level paid_later[] strings beside paid-later ledger rows", () => {
  const { buildMatrix } = require("../modules/adoption-matrix");
  const projects = [
    { id: "apollo", features: [{ id: "competitor-intel", label: "x" }], slots: [{ id: "competitor-intel", feature: "competitor-intel", paid_later: ["SEMrush - keywords"] }] },
    { id: "guide", features: [], slots: [{ id: "docs-search", feature: "search" }] }, // CONTROL: no paid_later
  ];
  const out = buildMatrix({ ledgerRows: [], projects });
  assert.deepEqual(out.parked_paid.map((r) => [r.project, r.slot, r.why]), [["apollo", "apollo/competitor-intel", "SEMrush - keywords"]]);
  assert.deepEqual(buildMatrix({ ledgerRows: [], projects, project: "guide" }).parked_paid, [], "the control slot contributes nothing");
});

test("two projects disagreeing about the SAME repo are attributed separately", () => {
  // apollo adopted it, hermes rejected it. Reading the merged row's status
  // would give both projects whichever one won the rank, so only a per-project
  // read can put apollo in adopted_unscored and leave hermes out.
  const { rows } = buildLedger({
    radarRows: [
      { repo: "a/split", project: "apollo", status: "accepted", why: "x", evidence: "abc1234", pair: "http://localhost:8776/#z" },
      { repo: "a/split", project: "hermes", status: "rejected", why: "x", evidence: "~/r.md", lesson: "l" },
    ],
  });
  assert.equal(rows.length, 1, "one merged row - that is what makes this hard");
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.deepEqual(
    m.adopted_unscored.map((r) => `${r.repo}@${r.project}`),
    ["a/split@apollo"],
    "apollo accepted it unscored; hermes rejected it and must not be counted as having adopted it",
  );
  const decided = m.hidden.filter((r) => r.hidden_class === "decided").map((r) => r.project).sort();
  assert.deepEqual(decided, ["apollo", "hermes"], "both DID decide - they just decided differently");
});

test("a DERIVED state counts as a decision - accepted-without-evidence is not a dependency", () => {
  // The bug: the classifier listed the five statuses somebody types, and
  // `accepted-without-evidence` is derived, not typed. Five real decisions
  // read as plain dependencies and disappeared into the biggest table.
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/derived", project: "apollo", status: "accepted", why: "x" }],
  });
  assert.equal(rows[0].state, "accepted-without-evidence", "the ledger derives this state - nobody writes it");
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(m.hidden.length, 1);
  assert.equal(m.hidden[0].hidden_class, "decided");
  assert.equal(m.population.hidden_dependency, 0, "somebody accepted it; it is not an unproposed dependency");
});

test("CONTROL: a genuine dependency is still a dependency, so the fix did not just say yes to everything", () => {
  const { rows } = buildLedger({ depRepos: [{ repo: "a/dep", project: "apollo" }] });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  assert.equal(m.population.hidden_dependency, 1);
  assert.equal(m.population.hidden_decided, 0);
});

test("a project that only DEPENDS on a repo another project decided is not credited with the decision", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/shared", project: "apollo", status: "rejected", why: "x", evidence: "~/r.md", lesson: "l" }],
    depRepos: [{ repo: "a/shared", project: "hermes" }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const byProject = Object.fromEntries(m.hidden.map((r) => [r.project, r.hidden_class]));
  assert.deepEqual(byProject, { apollo: "decided", hermes: "dependency" });
});

// --- eval freshness on the board ------------------------------------------

const EVAL_ROW = {
  slot: "apollo/design-fidelity", cadence_days: 90, runner: "scripts/x.py",
  metric: "DQI composite median", first_run: "~/.claude/reports/x.md",
};
const PROJ_WITH_SLOT = (ran) => [
  { id: "apollo", name: "Apollo", features: [{ id: "design-scoring", label: "Score a generated page" }], slots: [{ id: "design-fidelity", ran }] },
  { id: "hermes", name: "Hermes", features: [] },
];
const NOW2 = Date.parse("2026-09-04T12:00:00Z");
const ago = (n) => new Date(NOW2 - n * 86400000).toISOString().slice(0, 10);

test("a row with no eval reads not-wired, and that is not a failure", () => {
  const { rows } = buildLedger({ radarRows: [{ repo: "a/x", project: "apollo", status: "proposed", why: "x", score: scored() }] });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJ_WITH_SLOT([]), now: NOW2 });
  assert.equal(m.top[0].eval_freshness.state, "not-wired");
  assert.equal(m.population.evals.wired, 0, "not-wired rows are not a denominator");
});

test("a wired eval whose slot ran recently reads running, and is counted", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/x", project: "apollo", status: "proposed", why: "x", score: scored(), eval: EVAL_ROW }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJ_WITH_SLOT([{ date: ago(5) }]), now: NOW2 });
  assert.equal(m.top[0].eval_freshness.state, "running");
  assert.equal(m.top[0].eval_freshness.age_days, 5);
  assert.equal(m.population.evals.wired, 1);
  assert.equal(m.population.evals.running, 1);
});

test("a STALLED eval outranks the state's own next action - a done row resting on a dead benchmark", () => {
  const { rows } = buildLedger({
    radarRows: [{
      repo: "a/x", project: "apollo", status: "done", why: "x", score: scored(),
      evidence: "abc1234", lesson: "l", eyeballed: "adopt 2026-01-01", eval: EVAL_ROW,
      bench: { run: "~/r.json", date: "2026-01-01", result: "n" },
      telemetry: { project: "apollo", counters: ["c"], url: "http://localhost:8770/x" },
      before_after: { before: "1", after: "2", window: "7d", date: "2026-01-01" },
    }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJ_WITH_SLOT([{ date: ago(400) }]), now: NOW2 });
  assert.equal(m.top[0].eval_freshness.state, "stalled");
  assert.equal(m.top[0].next_action, "re-run the eval");
  assert.equal(m.population.evals.stalled, 1);
});

test("CONTROL: the SAME row with a fresh run keeps the state's own next action", () => {
  const mk = (ran) => {
    const { rows } = buildLedger({
      radarRows: [{
        repo: "a/x", project: "apollo", status: "done", why: "x", score: scored(),
        evidence: "abc1234", lesson: "l", eyeballed: "adopt 2026-01-01", eval: EVAL_ROW,
        bench: { run: "~/r.json", date: "2026-01-01", result: "n" },
        telemetry: { project: "apollo", counters: ["c"], url: "http://localhost:8770/x" },
        before_after: { before: "1", after: "2", window: "7d", date: "2026-01-01" },
      }],
    });
    return buildMatrix({ ledgerRows: rows, projects: PROJ_WITH_SLOT(ran), now: NOW2 }).top[0];
  };
  assert.equal(mk([{ date: ago(5) }]).next_action, "adopt card", "only the STALL changes the action");
  assert.notEqual(mk([{ date: ago(5) }]).next_action, mk([{ date: ago(400) }]).next_action);
});

test("an eval naming an undeclared slot reads slot-missing, never running", () => {
  const { rows } = buildLedger({
    radarRows: [{ repo: "a/x", project: "apollo", status: "proposed", why: "x", score: scored(), eval: { ...EVAL_ROW, slot: "apollo/nope" } }],
  });
  const m = buildMatrix({ ledgerRows: rows, projects: PROJ_WITH_SLOT([{ date: ago(1) }]), now: NOW2 });
  assert.equal(m.top[0].eval_freshness.state, "slot-missing");
  assert.equal(m.population.evals.slot_missing, 1);
  assert.equal(m.population.evals.running, 0, "a fresh run on a DIFFERENT slot proves nothing about this one");
});
