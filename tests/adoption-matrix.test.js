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
      { repo: "a/done", project: "apollo", status: "done", why: "x", evidence: "e", score: scored() },
      { repo: "a/rejected", project: "apollo", status: "rejected", why: "x", score: scored() },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const byRepo = Object.fromEntries(matrix.top.map((r) => [r.repo, r.next_action]));
  assert.equal(byRepo["a/proposed"], "score & pair");
  assert.equal(byRepo["a/trial"], "read the number");
  assert.equal(byRepo["a/done"], "adopt card");
  assert.equal(byRepo["a/rejected"], "-");
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
