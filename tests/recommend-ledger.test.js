const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ledgerFilter,
  extractSuggestedSlugs,
  recommendFromPool,
  loadPool,
} = require("../modules/recommend");

/**
 * H1 — recommend.js deduped candidates by title and never consulted the
 * ledger, so a repo already REJECTED (or already ADOPTED) kept coming back
 * every week forever. `ledgerFilter` is the fix: pure, and exercised here in
 * isolation before checking it is actually wired into the serve path.
 */

// --- ledgerFilter: the drop rules ------------------------------------------

const cand = (title, over = {}) => ({ title, url: `https://github.com/${title}`, stars: 500, ...over });

for (const status of ["rejected", "done", "accepted", "trial", "in-use"]) {
  test(`ledgerFilter DROPS a candidate whose ledger row is status=${status}`, () => {
    const candidates = [cand("acme/settled"), cand("acme/fresh")];
    const ledgerRows = [{ repo: "acme/settled", status }];
    const out = ledgerFilter(candidates, ledgerRows);
    assert.deepEqual(
      out.map((c) => c.title),
      ["acme/fresh"],
      `status=${status} must drop the row entirely, not demote it`,
    );
  });
}

// --- ledgerFilter: demotion, not deletion -----------------------------------

test("ledgerFilter DEMOTES (never drops) a candidate that is status=proposed", () => {
  const candidates = [cand("acme/proposed"), cand("acme/fresh")];
  const ledgerRows = [{ repo: "acme/proposed", status: "proposed" }];
  const out = ledgerFilter(candidates, ledgerRows);
  assert.equal(out.length, 2, "a proposed row must still be present");
  assert.deepEqual(out.map((c) => c.title), ["acme/fresh", "acme/proposed"], "proposed sinks below a fresh candidate");
});

test("ledgerFilter DEMOTES a candidate suggested in >= 2 prior digests, even with no ledger row", () => {
  const candidates = [cand("acme/repeat"), cand("acme/fresh")];
  const priorDigests = [["acme/repeat"], ["acme/repeat"], []];
  const out = ledgerFilter(candidates, [], { priorDigests });
  assert.equal(out.length, 2, "a repeated candidate is demoted, never dropped");
  assert.deepEqual(out.map((c) => c.title), ["acme/fresh", "acme/repeat"]);
});

test("CONTROL: a candidate seen in only ONE prior digest is NOT demoted", () => {
  const candidates = [cand("acme/once"), cand("acme/fresh")];
  const priorDigests = [["acme/once"]];
  const out = ledgerFilter(candidates, [], { priorDigests });
  assert.deepEqual(out.map((c) => c.title), ["acme/once", "acme/fresh"], "one prior mention is not a repeat");
});

// --- ledgerFilter: the identity control -------------------------------------

test("CONTROL: ledgerFilter is the IDENTITY on an empty ledger and no prior digests", () => {
  const candidates = [cand("acme/one"), cand("acme/two"), cand("acme/three")];
  const out = ledgerFilter(candidates, [], { priorDigests: [] });
  assert.deepEqual(out, candidates);
});

test("CONTROL: ledgerFilter defaults priorDigests to empty when omitted entirely", () => {
  const candidates = [cand("acme/one")];
  const out = ledgerFilter(candidates, []);
  assert.deepEqual(out, candidates);
});

// --- ledgerFilter: a real measured case (browser-use/browser-use) ----------
// config/radar/apollo.json and orion.json both carry this repo as
// status=rejected, and it was still being suggested every week regardless.

test("real-shape regression: a twice-rejected repo is dropped, not just demoted", () => {
  const candidates = [cand("browser-use/browser-use", { stars: 110555 }), cand("acme/fresh")];
  const ledgerRows = [
    { repo: "browser-use/browser-use", status: "rejected", pkg: null },
    { repo: "acme/fresh", status: undefined },
  ];
  const out = ledgerFilter(candidates, ledgerRows);
  assert.deepEqual(out.map((c) => c.title), ["acme/fresh"]);
});

// --- extractSuggestedSlugs: pure parser on a markdown FIXTURE ---------------
// Never reads the real digests/ directory — a fixture string only, so the test
// cannot be broken by next week's digest changing shape.

const DIGEST_FIXTURE = `# Weekly Claude Code Ecosystem Digest

## TL;DR — Top 5

1. **[decoy-org/should-not-count](https://github.com/decoy-org/should-not-count)** — 999★

## 🎯 Per-project suggestions (star floor 200, no forks/dupes)

### Apollo / Hermes (2 of 900 candidates)
- **[acme/repeat](https://github.com/acme/repeat)** · 1,665★ — _Shares 2 key deps_
- **[acme/once](https://github.com/acme/once)** · 500★ — _Found via search_

### Atlas (1 of 700 candidates)
- **[acme/repeat](https://github.com/acme/repeat)** · 1,665★ — _Shares 3 key deps_

## 🔬 External ground truth — what checks each instrument

- **[should-also-not-count/anything](https://github.com/should-also-not-count/anything)** talks about acme/repeat too
`;

test("extractSuggestedSlugs finds every distinct slug in the suggestions section", () => {
  const slugs = extractSuggestedSlugs(DIGEST_FIXTURE);
  assert.deepEqual([...slugs].sort(), ["acme/once", "acme/repeat"]);
});

test("CONTROL: extractSuggestedSlugs ignores slugs OUTSIDE the suggestions section", () => {
  const slugs = extractSuggestedSlugs(DIGEST_FIXTURE);
  assert.ok(!slugs.includes("decoy-org/should-not-count"), "TL;DR mentions must not count as a suggestion");
  assert.ok(!slugs.includes("should-also-not-count/anything"), "ground-truth section must not count either");
});

test("CONTROL: extractSuggestedSlugs on text with no suggestions section returns empty", () => {
  assert.deepEqual(extractSuggestedSlugs("# just a title\n\nnothing else here"), []);
});

test("CONTROL: extractSuggestedSlugs is total — non-string input never throws", () => {
  assert.deepEqual(extractSuggestedSlugs(undefined), []);
  assert.deepEqual(extractSuggestedSlugs(null), []);
});

// --- Wired into the serve path ----------------------------------------------
// recommendFromPool is what both routes/recommendations.js and
// modules/weekly-digest.js call. Prove the ledger is actually consulted on
// THAT path, not just in the standalone helper.

const rawItem = (title, over = {}) => ({
  title,
  url: `https://github.com/${title}`,
  stars: 1000,
  score: 10,
  published_at: "2026-08-20T00:00:00Z",
  metadata: JSON.stringify({
    matched_projects: [{ id: "apollo", overlap: 0 }],
    discovery_strategy: "keyword",
    ...over.metadataOver,
  }),
});

function fakeDb(items) {
  return { getItems: () => items };
}

test("recommendFromPool drops a rejected repo from the served discoveries", () => {
  const pool = loadPool(fakeDb([rawItem("acme/rejected"), rawItem("acme/fresh")]));
  const { discoveries } = recommendFromPool(pool, "apollo", {
    starsMin: 0,
    ledgerRows: [{ repo: "acme/rejected", status: "rejected" }],
    priorDigests: [],
  });
  assert.ok(!discoveries.some((d) => d.title === "acme/rejected"), "a rejected repo must not be served");
  assert.ok(discoveries.some((d) => d.title === "acme/fresh"), "CONTROL: an undecided repo is still served");
});

test("recommendFromPool demotes (not drops) a repeatedly-suggested repo", () => {
  const pool = loadPool(fakeDb([rawItem("acme/repeat"), rawItem("acme/fresh")]));
  const { discoveries } = recommendFromPool(pool, "apollo", {
    starsMin: 0,
    ledgerRows: [],
    priorDigests: [["acme/repeat"], ["acme/repeat"]],
  });
  assert.equal(discoveries.length, 2, "a repeat is demoted, never dropped");
  assert.equal(discoveries[discoveries.length - 1].title, "acme/repeat", "the repeat sinks to the bottom");
});

test("CONTROL: recommendFromPool with an empty ledger and no digests behaves exactly as before", () => {
  const pool = loadPool(fakeDb([rawItem("acme/one"), rawItem("acme/two")]));
  const { discoveries } = recommendFromPool(pool, "apollo", { starsMin: 0, ledgerRows: [], priorDigests: [] });
  assert.equal(discoveries.length, 2);
});
