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

test("the ground-truth page passes ?project= through to the API rather than filtering locally", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "public", "ground-truth.html"), "utf8");
  assert.match(page, /\/api\/ground-truth\?project=\$\{encodeURIComponent\(project\)\}/);
});

test("the stack page filters on MEMBERSHIP, not by pre-filling the search box", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "public", "stack.html"), "utf8");
  assert.match(page, /if \(PROJECT && !r\.projects\.includes\(PROJECT\)\) return false;/);
  // The exact regression: the id used to be typed into the search box, which
  // matches nine fields by substring.
  assert.doesNotMatch(page, /box\.value = wanted/);
});

test("the stack page SAYS its counts strip is still ledger-wide while the table is filtered", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "public", "stack.html"), "utf8");
  assert.match(page, /across all projects/i,
    "a filtered table under an unfiltered strip must say so, or the strip reads as the project's");
});
