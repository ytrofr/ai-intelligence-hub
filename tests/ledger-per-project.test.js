const test = require("node:test");
const assert = require("node:assert/strict");

const { buildLedger } = require("../modules/ledger");
const { buildMatrix } = require("../modules/adoption-matrix");
const { buildGroundTruth } = require("../modules/ground-truth");

// ---------------------------------------------------------------------------
// The ledger merges radar rows for the SAME repo into ONE row keyed on the
// repo. Before per_project existed, the H3 fields (slot/features/score/
// cost_tier/hardware_fit/hardware_mib) were single-valued on that row —
// first-authored-wins — so a SECOND project's own score/features for the
// same repo were gone from the merge, and the FIRST project's leaked onto
// every other project that merely shared the row. Live instances measured
// 2026-09-03: apollo/openclaw/openclaw rendered orion's telemetry/
// security/tool-calling features; hermes/SALT-NLP/Design2Code rendered
// apollo's MEASURED score over hermes's own ESTIMATED one.
//
// These fixtures reproduce both shapes with the real field names/values.
// ---------------------------------------------------------------------------

const scoreOf = (over = {}) => ({ effort: 1, effect: 4, time: 1, impact: 4, risk: 1, basis: "estimated", ...over });

const PROJECTS = [
  {
    id: "apollo", name: "Apollo",
    features: [{ id: "design-scoring", label: "Score a generated page" }],
    slots: [{ id: "design-fidelity", feature: "design-scoring" }],
  },
  {
    id: "hermes", name: "Hermes",
    features: [{ id: "landing-critique", label: "Critique a landing page" }],
    slots: [{ id: "landing-critique", feature: "landing-critique" }],
  },
  {
    id: "orion", name: "Orion",
    features: [{ id: "telemetry", label: "Tool telemetry" }, { id: "security", label: "Security" }, { id: "tool-calling", label: "Tool calling" }],
    slots: [],
  },
];

const find = (rows, repo) => rows.find((r) => r.repo === repo);
const projectRows = (matrix, id) => (matrix.projects.find((p) => p.id === id) || { rows: [] }).rows;

// --- two projects each score the SAME repo — per_project keeps them apart ---

test("two projects scoring the same repo produce two DISTINCT per_project entries", () => {
  const { rows } = buildLedger({
    radarRows: [
      {
        repo: "SALT-NLP/Design2Code", kind: "dataset", project: "apollo",
        status: "trial", why: "first external ground truth",
        slot: "apollo/design-fidelity", features: ["design-scoring"],
        score: scoreOf({ basis: "measured" }),
      },
      {
        repo: "SALT-NLP/Design2Code", kind: "dataset", project: "hermes",
        status: "proposed", why: "second consumer of one download",
        slot: "hermes/landing-critique", features: ["landing-critique"],
        score: scoreOf({ basis: "estimated" }),
      },
    ],
  });
  const row = find(rows, "SALT-NLP/Design2Code");
  assert.equal(rows.length, 1, "one repo, one row");
  assert.deepEqual(row.projects, ["apollo", "hermes"]);

  assert.ok(row.per_project.apollo, "apollo's own H3 fields must survive the merge");
  assert.ok(row.per_project.hermes, "hermes's own H3 fields must survive the merge too");
  assert.equal(row.per_project.apollo.slot, "apollo/design-fidelity");
  assert.equal(row.per_project.hermes.slot, "hermes/landing-critique");
  assert.deepEqual(row.per_project.apollo.features, ["design-scoring"]);
  assert.deepEqual(row.per_project.hermes.features, ["landing-critique"]);
  assert.equal(row.per_project.apollo.score.basis, "measured");
  assert.equal(row.per_project.hermes.score.basis, "estimated", "hermes keeps ITS OWN basis, never apollo's");
});

test("the adoption matrix never shows project B with project A's features or score basis", () => {
  const { rows } = buildLedger({
    radarRows: [
      {
        repo: "SALT-NLP/Design2Code", kind: "dataset", project: "apollo",
        status: "trial", why: "x", slot: "apollo/design-fidelity",
        features: ["design-scoring"], score: scoreOf({ basis: "measured" }),
      },
      {
        repo: "SALT-NLP/Design2Code", kind: "dataset", project: "hermes",
        status: "proposed", why: "x", slot: "hermes/landing-critique",
        features: ["landing-critique"], score: scoreOf({ basis: "estimated" }),
      },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });

  const apolloRow = find(projectRows(matrix, "apollo"), "SALT-NLP/Design2Code");
  const hermesRow = find(projectRows(matrix, "hermes"), "SALT-NLP/Design2Code");

  assert.deepEqual(apolloRow.features.map((f) => f.id), ["design-scoring"]);
  assert.deepEqual(hermesRow.features.map((f) => f.id), ["landing-critique"], "hermes must not inherit apollo's design-scoring feature");
  assert.equal(apolloRow.basis, "measured");
  assert.equal(hermesRow.basis, "estimated", "hermes's own row must not be relabelled measured");
  assert.equal(apolloRow.slot, "apollo/design-fidelity");
  assert.equal(hermesRow.slot, "hermes/landing-critique");

  // Both projects declared their own features (design-scoring for apollo,
  // landing-critique for hermes) so nothing reads as "(undeclared)" —
  // control proving the fix, not just the absence of cross-contamination.
  assert.equal(matrix.population.undeclared_features, 0);
});

// --- an unscored decision must never dress up in another project's score ---

test("a project's own UNSCORED decision reads as its own — never another project's score", () => {
  const { rows } = buildLedger({
    radarRows: [
      // apollo watches openclaw with no H3 fields at all — a real decision,
      // just an unscored one.
      { repo: "openclaw/openclaw", project: "apollo", status: "proposed", why: "ecosystem anchor, not a dependency" },
      // orion scored the SAME repo for its own, unrelated reasons.
      {
        repo: "openclaw/openclaw", project: "orion", status: "proposed",
        why: "channel adapter reference", slot: "orion/tool-telemetry",
        features: ["telemetry", "security", "tool-calling"], score: scoreOf(),
      },
    ],
  });
  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });

  const apolloRow = find(projectRows(matrix, "apollo"), "openclaw/openclaw");
  const smithRow = find(projectRows(matrix, "orion"), "openclaw/openclaw");

  assert.ok(apolloRow, "apollo is still a candidate — the repo is eligible via orion's score");
  assert.deepEqual(apolloRow.features, [], "apollo authored no features of its own and must inherit none");
  assert.equal(apolloRow.slot, "", "apollo authored no slot of its own");
  assert.equal(apolloRow.total, "unscored", "apollo's own decision carries no score");
  assert.equal(apolloRow.next_action, "score & pair", "an unscored own-decision needs its own score, not a borrowed one");

  assert.deepEqual(smithRow.features.map((f) => f.id), ["telemetry", "security", "tool-calling"]);
  assert.equal(smithRow.total, 92);
});

// --- control: a single-project scored row still renders through the top level ---

test("CONTROL: a repo scored by exactly one project renders fine with no per_project entry read", () => {
  const { rows } = buildLedger({
    radarRows: [
      {
        repo: "solo/repo", project: "apollo", status: "accepted", why: "x", evidence: "e",
        slot: "apollo/design-fidelity", features: ["design-scoring"], score: scoreOf({ basis: "measured" }),
      },
    ],
  });
  const row = find(rows, "solo/repo");
  assert.ok(row.per_project.apollo, "the sole author still gets a per_project entry");

  const matrix = buildMatrix({ ledgerRows: rows, projects: PROJECTS });
  const apolloRow = find(projectRows(matrix, "apollo"), "solo/repo");
  assert.deepEqual(apolloRow.features.map((f) => f.id), ["design-scoring"]);
  assert.equal(apolloRow.total, 92);
  assert.equal(apolloRow.basis, "measured");
});

// --- ground truth: each project's own slot gets its own candidates ----------

test("ground truth attaches the hermes row under hermes's slot and the apollo row under apollo's slot", () => {
  const { rows: ledgerRows } = buildLedger({
    radarRows: [
      {
        repo: "SALT-NLP/Design2Code", kind: "dataset", project: "apollo",
        status: "trial", why: "x", slot: "apollo/design-fidelity",
        features: ["design-scoring"], score: scoreOf({ basis: "measured" }),
      },
      {
        repo: "SALT-NLP/Design2Code", kind: "dataset", project: "hermes",
        status: "proposed", why: "x", slot: "hermes/landing-critique",
        features: ["landing-critique"], score: scoreOf({ basis: "estimated" }),
      },
    ],
  });

  const projects = [
    { id: "apollo", name: "Apollo", features: [{ id: "design-scoring", label: "x" }],
      slots: [{ id: "design-fidelity", feature: "design-scoring" }] },
    { id: "hermes", name: "Hermes", features: [{ id: "landing-critique", label: "x" }],
      slots: [{ id: "landing-critique", feature: "landing-critique" }] },
  ];

  const { projects: out } = buildGroundTruth({ projects, ledgerRows });
  const apolloSlot = out.find((p) => p.id === "apollo").slots.find((s) => s.id === "design-fidelity");
  const hermesSlot = out.find((p) => p.id === "hermes").slots.find((s) => s.id === "landing-critique");

  assert.equal(apolloSlot.candidates.length, 1);
  assert.equal(apolloSlot.candidates[0].repo, "SALT-NLP/Design2Code");
  assert.equal(apolloSlot.candidates[0].basis, "measured");

  assert.equal(hermesSlot.candidates.length, 1);
  assert.equal(hermesSlot.candidates[0].repo, "SALT-NLP/Design2Code");
  assert.equal(hermesSlot.candidates[0].basis, "estimated", "hermes's slot must see ITS OWN basis, never apollo's");

  // Neither slot got the other's candidate a second time.
  assert.equal(apolloSlot.counts.candidates, 1);
  assert.equal(hermesSlot.counts.candidates, 1);
});
