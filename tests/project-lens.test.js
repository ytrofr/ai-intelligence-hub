/**
 * The project lens - ?project=<id> on the pages the nav drills into.
 *
 * Two of the four lenses already filtered for real (the Adoption Matrix and the
 * Adoption Radar). The other two did not, and each failed in its own way:
 *
 *   stack.html      PRE-FILLED THE SEARCH BOX with the project id. That box
 *                   substring-matches nine fields, so "apollo" also matched rows
 *                   whose REASON merely mentions apollo, and the "N of M" count
 *                   described a set the project does not own.
 *   ground-truth    had no project support at all.
 *
 * The rule these cells encode: narrow the INPUT, never the built payload.
 * `countGroundTruth` derives every count from the tree it is handed, so a
 * filtered input yields a page whose headline and whose rows describe the same
 * population - and filtering afterwards would leave the headline counting nine
 * projects above a page showing one.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildGroundTruth } = require("../modules/ground-truth");

const PROJECTS = [
  {
    id: "apollo",
    name: "Apollo",
    features: ["design-fidelity"],
    slots: [
      { id: "design-fidelity", instrument: "scorer.py", kind: "dataset", feature: "design-fidelity",
        task_categories: [], licence_ok: [], ran: [] },
      { id: "page-judge", instrument: "judge.py", kind: "dataset", task_categories: [], licence_ok: [], ran: [] },
    ],
  },
  {
    id: "atlas",
    name: "Atlas",
    features: [],
    slots: [{ id: "tier-retrieval", instrument: "retrieve.py", kind: "dataset", task_categories: [], licence_ok: [], ran: [] }],
  },
];

const ledgerRow = (over = {}) => ({
  repo: "SALT-NLP/Design2Code",
  kind: "dataset",
  status: "trial",
  projects: ["apollo"],
  slot: "apollo/design-fidelity",
  cost_tier: "free",
  first_seen: "2026-09-01",
  ...over,
});

const LEDGER = [
  ledgerRow(),
  ledgerRow({ repo: "atlas/thing", projects: ["atlas"], slot: "atlas/tier-retrieval", cost_tier: "paid-later" }),
];

const build = (project) => {
  const projects = project ? PROJECTS.filter((p) => p.id === project) : PROJECTS;
  const rows = project ? LEDGER.filter((r) => r.projects.includes(project)) : LEDGER;
  return buildGroundTruth({ projects, ledgerRows: rows, now: new Date("2026-09-04T00:00:00Z") });
};

test("narrowing the INPUT narrows every count with it", () => {
  const one = build("apollo");
  assert.equal(one.counts.projects, 1);
  assert.equal(one.counts.slots, 2);
  assert.deepEqual(one.projects.map((p) => p.id), ["apollo"]);
});

test("CONTROL: unfiltered, the same call sees both projects - so the filter did the narrowing", () => {
  const all = build("");
  assert.equal(all.counts.projects, 2);
  assert.equal(all.counts.slots, 3);
});

test("the funnel and parked-paid follow the lens too, because they read the ledger rows", () => {
  const all = build("");
  const one = build("atlas");
  // parked_paid is computed from ledgerRows, so a lens that narrowed only the
  // projects list would leave this number describing the whole ledger.
  assert.equal(all.counts.parked_paid.length, 1);
  assert.equal(one.counts.parked_paid.length, 1);
  assert.equal(build("apollo").counts.parked_paid.length, 0,
    "apollo has no paid-later row - if this is 1 the ledger rows were never narrowed");
});

test("the route narrows the projects list BEFORE building, never the payload after", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "ground-truth.js"), "utf8");
  assert.match(src, /all\.filter\(\(p\) => p\.id === project\)/, "the input must be narrowed");
  assert.doesNotMatch(src, /built\.projects\.filter/, "narrowing the built payload leaves the counts lying");
  assert.match(src, /no such project/, "an unknown id must 404, not render an empty tree");
});

/*
 * The three page-level cells that used to live here moved to the front end's
 * own suite when public/ was deleted:
 *
 *   web/src/features/__tests__/routes.test.tsx
 *     "the ledger filters by project MEMBERSHIP, not by substring"
 *
 *   web/src/features/__tests__/lens.test.tsx
 *     the ground-truth lens passes ?project= to the API
 *     the ledger's counts strip says it is still ledger-wide
 *
 * They are not lost, and they are not duplicated. Everything remaining in this
 * file asserts the ROUTE's behaviour, which is where the guarantee actually
 * lives - a page can only be right about a filter the server applied.
 */
