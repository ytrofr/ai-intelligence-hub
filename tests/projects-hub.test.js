/**
 * The projects hub join.
 *
 * The failure this guards is a page that is TIDIER than the data: a candidate
 * that lands in no bucket, or a declared need that has no row because nothing
 * was ever proposed for it. Both make the hub look healthier than the tree it
 * renders, and neither raises anything.
 *
 * So the load-bearing cell here is the partition invariant - every matrix row
 * lands in exactly one bucket - and every "renders as empty" cell has an
 * accepting twin that proves the same code path can also produce a full row.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildHub, ageDays, bestScore, partitionRows, slotState } = require("../modules/projects-hub");

const NOW = Date.parse("2026-09-04T12:00:00Z");
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const row = (over = {}) => ({ repo: "a/b", kind: "repo", total: 44, basis: "measured", slot: null, ...over });

const gt = (projects) => ({ projects });
const mx = (projects, population = {}) => ({ projects, population });

/** apollo declares two slots; one is answered, one is a need nobody looked at. */
const FIXTURE = {
  groundTruth: gt([
    {
      id: "apollo",
      name: "Apollo",
      slots: [
        {
          id: "design-fidelity",
          needs: "screenshot + HTML pairs",
          kind: "ground-truth",
          runs: 1,
          last_ran: { at: daysAgo(10), number: "median 55.7 -> 57.6" },
          candidates: [{ id: "ledger:repo:x/y", repo: "x/y" }],
        },
        { id: "page-judge", needs: "graded pages", runs: 0, last_ran: null, candidates: [] },
      ],
    },
    { id: "hub", name: "Hub", slots: [{ id: "adoption-funnel", runs: 0, last_ran: null, candidates: [] }] },
    { id: "claude-ecosystem", name: "Ecosystem", slots: [] },
  ]),
  matrix: mx(
    [
      {
        id: "apollo",
        rows: [
          row({ repo: "SALT-NLP/Design2Code", kind: "dataset", slot: "apollo/design-fidelity", total: 92 }),
          row({ repo: "NoviScl/Design2Code", slot: "apollo/design-fidelity", total: 44 }),
          row({ repo: "loose/end", slot: null, total: 60 }),
          row({ repo: "cross/project", slot: "remotion/scene-generation", total: 72 }),
          row({ repo: "ghost/slot", slot: "apollo/no-such-slot", total: 12 }),
        ],
      },
      { id: "hub", rows: [] },
      { id: "claude-ecosystem", rows: [] },
    ],
    { rows: 5, ledger_rows: 332, hidden: 398 },
  ),
  now: NOW,
};

const build = (over = {}) => buildHub({ ...FIXTURE, ...over });
const proj = (model, id) => model.projects.find((p) => p.id === id);

// --- the partition invariant ---------------------------------------------

test("every matrix row lands in exactly ONE bucket - nothing is dropped, nothing doubles", () => {
  const m = build();
  for (const p of m.projects) {
    const seen = [
      ...p.slots.flatMap((s) => s.scored),
      ...p.unslotted,
      ...p.borrowed,
      ...p.orphaned,
    ];
    assert.equal(seen.length, p.counts.candidates, `${p.id}: buckets must account for every row`);
    assert.equal(new Set(seen.map((r) => r.repo)).size, seen.length, `${p.id}: a row appears twice`);
  }
});

test("the four bucket counts sum to the candidate count, per project", () => {
  const c = proj(build(), "apollo").counts;
  assert.equal(c.slotted + c.unslotted + c.borrowed + c.orphaned, c.candidates);
  assert.equal(c.candidates, 5);
});

test("a row with no slot is UNSLOTTED, not silently attached to the first one", () => {
  const p = proj(build(), "apollo");
  assert.deepEqual(p.unslotted.map((r) => r.repo), ["loose/end"]);
});

test("a row naming ANOTHER project's slot is BORROWED - startsWith would lose it", () => {
  const p = proj(build(), "apollo");
  assert.deepEqual(p.borrowed.map((r) => r.repo), ["cross/project"]);
});

test("a row naming a slot we do not declare is ORPHANED, never dropped", () => {
  const p = proj(build(), "apollo");
  assert.deepEqual(p.orphaned.map((r) => r.repo), ["ghost/slot"]);
  assert.equal(p.counts.orphaned, 1);
});

test("ACCEPTING TWIN: a row naming a slot we DO declare lands in that slot", () => {
  const s = proj(build(), "apollo").slots.find((x) => x.id === "design-fidelity");
  assert.deepEqual(s.scored.map((r) => r.repo).sort(), ["NoviScl/Design2Code", "SALT-NLP/Design2Code"]);
});

// --- an absence is a ROW ---------------------------------------------------

test("a declared slot with NOTHING proposed is still a slot row, marked empty", () => {
  const s = proj(build(), "apollo").slots.find((x) => x.id === "page-judge");
  assert.ok(s, "the need must have a row - no other page in this app can show it");
  assert.equal(s.state, "empty");
  assert.equal(s.best, null, "an unanswered need scores null, never 0");
});

test("the hub project renders as one unfilled need, not as a missing card", () => {
  const p = proj(build(), "hub");
  assert.equal(p.counts.slots, 1);
  assert.equal(p.counts.slots_empty, 1);
  assert.equal(p.counts.candidates, 0);
});

test("a project with no slots and no rows is an honest empty, still a project", () => {
  const p = proj(build(), "claude-ecosystem");
  assert.equal(p.counts.slots, 0);
  assert.equal(p.counts.candidates, 0);
  assert.equal(p.counts.best, null);
});

test("empty and unscored are DIFFERENT populations and both are counted", () => {
  const m = buildHub({
    ...FIXTURE,
    groundTruth: gt([
      {
        id: "apollo",
        slots: [
          { id: "a", runs: 0, candidates: [] }, // nothing proposed
          { id: "b", runs: 0, candidates: [{ repo: "p/q" }] }, // proposed, unscored
          { id: "c", runs: 0, candidates: [] }, // scored
        ],
      },
    ]),
    matrix: mx([{ id: "apollo", rows: [row({ slot: "apollo/c", total: 80 })] }]),
  });
  const p = proj(m, "apollo");
  // Only `a` is empty: `b` has a proposed candidate and `c` has a scored matrix
  // row, so each has been looked at in a way `a` has not.
  assert.equal(p.counts.slots_empty, 1);
  assert.equal(p.slots.find((s) => s.id === "a").state, "empty");
  assert.equal(p.slots.find((s) => s.id === "b").state, "unscored");
  assert.equal(p.slots.find((s) => s.id === "c").state, "scored");
  assert.equal(p.counts.slots_unscored, 2, "unscored counts BOTH the empty one and the proposed-but-unrated one");
  assert.notEqual(p.counts.slots_empty, p.counts.slots_unscored, "if these were equal the distinction is lost");
});

// --- runs and ages ---------------------------------------------------------

test("a slot that never ran has age null, never 0 - 0 would read as 'just ran'", () => {
  const s = proj(build(), "apollo").slots.find((x) => x.id === "page-judge");
  assert.equal(s.runs, 0);
  assert.equal(s.last_ran, null);
  assert.equal(s.age_days, null);
});

test("ACCEPTING TWIN: a slot that DID run carries its age and its number", () => {
  const s = proj(build(), "apollo").slots.find((x) => x.id === "design-fidelity");
  assert.equal(s.runs, 1);
  assert.equal(s.age_days, 10);
  assert.match(s.last_ran.number, /55\.7/);
});

test("ageDays: unparseable and missing both read null, and the future clamps to 0", () => {
  assert.equal(ageDays(null, NOW), null);
  assert.equal(ageDays("", NOW), null);
  assert.equal(ageDays("last tuesday", NOW), null);
  assert.equal(ageDays(daysAgo(3), NOW), 3);
  assert.equal(ageDays(new Date(NOW + 5 * DAY).toISOString(), NOW), 0);
});

// --- scores ----------------------------------------------------------------

test("best is the max of SCORED rows, and null when none is scored", () => {
  assert.equal(bestScore([{ total: 44 }, { total: 92 }, { total: 60 }]), 92);
  assert.equal(bestScore([{ total: null }, {}]), null, "unscored rows do not become a 0");
  assert.equal(bestScore([]), null);
});

test("a slot holding only unscored rows reports best null, not 0", () => {
  const m = buildHub({
    ...FIXTURE,
    groundTruth: gt([{ id: "apollo", slots: [{ id: "s", runs: 0, candidates: [] }] }]),
    matrix: mx([{ id: "apollo", rows: [row({ slot: "apollo/s", total: null })] }]),
  });
  const s = proj(m, "apollo").slots[0];
  assert.equal(s.state, "scored", "it HAS a matrix row, so it is not an unanswered need");
  assert.equal(s.best, null, "but nothing in it carries a number");
});

// --- the population --------------------------------------------------------

test("population sums the per-project counts - it is derived, never typed", () => {
  const m = build();
  assert.equal(m.population.projects, 3);
  assert.equal(m.population.slots, 3, "apollo 2 + hub 1 + ecosystem 0");
  assert.equal(m.population.candidates, 5);
  assert.equal(m.population.slots_empty, 2, "apollo/page-judge + hub/adoption-funnel");
  assert.equal(
    m.population.candidates,
    m.projects.reduce((n, p) => n + p.counts.candidates, 0),
  );
});

test("population carries the matrix denominator rather than recomputing one", () => {
  const m = build();
  assert.equal(m.population.matrix_rows, 5);
  assert.equal(m.population.ledger_rows, 332);
  assert.equal(m.population.hidden, 398);
});

test("a project the matrix knows and ground truth does not is REPORTED, not dropped", () => {
  const m = buildHub({
    ...FIXTURE,
    groundTruth: gt([{ id: "apollo", slots: [] }]),
    matrix: mx([{ id: "apollo", rows: [] }, { id: "ghost", rows: [row()] }]),
  });
  assert.deepEqual(m.population.unknown_projects, ["ghost"]);
});

test("CONTROL: with matching inputs, unknown_projects is empty - it can read both ways", () => {
  assert.deepEqual(build().population.unknown_projects, []);
});

// --- degenerate input ------------------------------------------------------

test("CONTROL: no input at all returns an empty model and does not throw", () => {
  const m = buildHub();
  assert.deepEqual(m.projects, []);
  assert.equal(m.population.candidates, 0);
  assert.equal(m.population.slots, 0);
});

test("a project whose slots key is missing entirely is treated as zero slots, not a crash", () => {
  const m = buildHub({ ...FIXTURE, groundTruth: gt([{ id: "x" }]), matrix: mx([]) });
  assert.equal(proj(m, "x").counts.slots, 0);
  assert.equal(proj(m, "x").name, "x", "a project with no name falls back to its id, never to blank");
});

test("partitionRows and slotState are exported so the page cannot re-implement them", () => {
  const { bySlot, unslotted, borrowed } = partitionRows([row({ slot: "p/s" }), row({ slot: null })], "p");
  assert.deepEqual([...bySlot.keys()], ["s"]);
  assert.equal(unslotted.length, 1);
  assert.equal(borrowed.length, 0);
  assert.equal(slotState([], []), "empty");
  assert.equal(slotState([], [{}]), "unscored");
  assert.equal(slotState([{}], []), "scored");
});

// --- cross-project adoptions ----------------------------------------------

const { sharedAdoptions } = require("../modules/projects-hub");

test("a repo TWO projects adopted is shared; one adopter is not", () => {
  const rows = [
    { repo: "a/two", per_project: { apollo: { state: "done" }, cc: { state: "accepted" } } },
    { repo: "b/one", per_project: { apollo: { state: "done" }, cc: { state: "proposed" } } },
  ];
  assert.deepEqual(sharedAdoptions(rows).map((r) => r.repo), ["a/two"]);
});

test("`in-use` is NOT an adoption - a resolved manifest package was nobody's decision", () => {
  const rows = [{ repo: "x/dep", per_project: { apollo: { state: "in-use" }, cc: { state: "in-use" } } }];
  assert.deepEqual(sharedAdoptions(rows), [], "two dependants are not two adopters");
});

test("ACCEPTING TWIN: the same repo with two real adoptions IS shared", () => {
  const rows = [{ repo: "x/dep", per_project: { apollo: { state: "done-unseen" }, cc: { state: "trial" } } }];
  assert.equal(sharedAdoptions(rows).length, 1);
});

test("it reads each project's OWN state, never the merged row's", () => {
  // first-authored-wins means row.state belongs to whichever project wrote
  // first; counting on it would credit `cc` with apollo's adoption.
  const rows = [{ repo: "m/erged", state: "done", per_project: { apollo: { state: "done" }, cc: { state: "rejected" } } }];
  assert.deepEqual(sharedAdoptions(rows), [], "the merged state must not create a phantom adopter");
});

test("adopters are sorted, and the list is ordered by how many share it", () => {
  const rows = [
    { repo: "b/two", per_project: { z: { state: "done" }, a: { state: "done" } } },
    { repo: "a/three", per_project: { c: { state: "done" }, a: { state: "done" }, b: { state: "done" } } },
  ];
  const out = sharedAdoptions(rows);
  assert.deepEqual(out.map((r) => r.repo), ["a/three", "b/two"], "most-shared first");
  assert.deepEqual(out[0].projects, ["a", "b", "c"], "adopters sorted, so the row is stable");
});

test("CONTROL: no rows, and a row with no per_project, both yield nothing and do not throw", () => {
  assert.deepEqual(sharedAdoptions([]), []);
  assert.deepEqual(sharedAdoptions(), []);
  assert.deepEqual(sharedAdoptions([{ repo: "x/y" }]), []);
});
