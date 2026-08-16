const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLedger, countLedger } = require("../modules/ledger");

const find = (rows, repo) => rows.find((r) => r.repo === repo);

// --- T1: the merge is keyed on the REPO, not the project ---------------------

test("T1 a repo used by three projects is ONE row listing three projects", () => {
  const { rows } = buildLedger({
    depRepos: [
      { repo: "adbar/trafilatura", project: "apollo" },
      { repo: "adbar/trafilatura", project: "atlas" },
      { repo: "adbar/trafilatura", project: "orion" },
    ],
  });
  assert.equal(rows.length, 1, "three pairs of one repo must collapse to one row");
  assert.deepEqual(find(rows, "adbar/trafilatura").projects, ["orion", "atlas", "apollo"]);
});

test("T1 a radar row and a dep row for the same repo merge, keeping the reason", () => {
  const { rows } = buildLedger({
    radarRows: [
      { repo: "firecrawl/firecrawl", project: "apollo", verdict: "ADOPT", status: "accepted",
        why: "JS-heavy pages and anti-bot" },
    ],
    depRepos: [{ repo: "firecrawl/firecrawl", project: "hermes" }],
  });
  const row = find(rows, "firecrawl/firecrawl");
  assert.equal(rows.length, 1);
  assert.deepEqual(row.projects, ["apollo", "hermes"]);
  assert.equal(row.why, "JS-heavy pages and anti-bot", "the authored reason must survive the merge");
  assert.equal(row.status, "accepted", "a decided status outranks in-use");
});

test("T1 a dep with no radar row gets status in-use and an empty reason", () => {
  const { rows } = buildLedger({ depRepos: [{ repo: "lxml/lxml", project: "apollo" }] });
  const row = find(rows, "lxml/lxml");
  assert.equal(row.status, "in-use");
  assert.equal(row.why, "");
  assert.equal(row.explained, false);
});

// --- T2: the counters are DERIVED from the rows, never assigned --------------

test("T2 explained + unexplained equals the total, always", () => {
  const { rows, counts } = buildLedger({
    radarRows: [{ repo: "a/explained", project: "apollo", verdict: "ADOPT", status: "accepted", why: "a real reason" }],
    depRepos: [
      { repo: "b/blank", project: "apollo" },
      { repo: "c/blank", project: "atlas" },
    ],
  });
  assert.equal(counts.total, rows.length);
  assert.equal(counts.explained + counts.unexplained, counts.total,
    "a counter that cannot disagree with its own table is decoration");
  assert.equal(counts.explained, 1);
  assert.equal(counts.unexplained, 2);
});

test("T2 countLedger recomputes from rows alone and agrees with buildLedger", () => {
  const { rows, counts } = buildLedger({
    radarRows: [
      { repo: "a/one", project: "apollo", verdict: "ADOPT", status: "done", why: "shipped", evidence: "e", lesson: "none" },
      { repo: "a/two", project: "apollo", verdict: "SKIP", status: "rejected", why: "measured 3.58%", evidence: "e", lesson: "quality/x.md" },
    ],
    depRepos: [{ repo: "b/dep", project: "hub" }],
  });
  assert.deepEqual(countLedger(rows), counts, "the counters must be a pure function of the rendered rows");
});

// --- T3: positive control for the explained/unexplained classifier -----------

test("T3 a whitespace-only reason counts as UNEXPLAINED, not explained", () => {
  const { rows, counts } = buildLedger({
    radarRows: [{ repo: "a/whitespace", project: "apollo", verdict: "ADOPT", status: "accepted", why: "   " }],
  });
  assert.equal(find(rows, "a/whitespace").explained, false);
  assert.equal(counts.unexplained, 1, "a blank-looking reason must not be scored as a real one");
});

test("T3 the classifier can produce BOTH outcomes in one run", () => {
  // A green board with a dead classifier looks identical to a green board.
  const { counts } = buildLedger({
    radarRows: [{ repo: "a/has", project: "apollo", verdict: "ADOPT", status: "accepted", why: "because" }],
    depRepos: [{ repo: "b/hasnt", project: "apollo" }],
  });
  assert.equal(counts.explained, 1);
  assert.equal(counts.unexplained, 1);
});

// --- T4: unresolved is SHOWN and COUNTED, never dropped ----------------------

test("T4 an unresolvable package is kept as a row and counted", () => {
  const { rows, counts } = buildLedger({
    depRepos: [
      { repo: "unresolved", project: "apollo", pkg: "some-private-thing" },
      { repo: "real/one", project: "apollo" },
    ],
  });
  assert.equal(counts.total, 2, "a dropped row makes the total wrong and nothing warns");
  assert.equal(counts.unresolved, 1);
  const row = rows.find((r) => r.unresolved);
  assert.equal(row.pkg, "some-private-thing", "keep the package name so the row is actionable");
});

test("T4 two unresolvable packages stay two rows, not one merged 'unresolved'", () => {
  const { counts } = buildLedger({
    depRepos: [
      { repo: "unresolved", project: "apollo", pkg: "thing-a" },
      { repo: "unresolved", project: "apollo", pkg: "thing-b" },
    ],
  });
  assert.equal(counts.total, 2);
  assert.equal(counts.unresolved, 2);
});

// --- the ledger is NOT the tracked pool --------------------------------------

test("a REJECTED row stays in the ledger — this is where the ledger and the pool differ", () => {
  // tracked-pool.js deliberately RETIRES rejected rows: it decides what to poll
  // daily. The ledger must keep them, because "we tried this and rejected it, and
  // here is what it taught us" is the single most valuable row for another project.
  const { rows } = buildLedger({
    radarRows: [
      { repo: "headroomlabs-ai/headroom", project: "lyra", verdict: "SKIP", status: "rejected",
        why: "compresses in place", outcome: "measured 3.58% on our corpus",
        evidence: "reports/hub-audit-2026-08-16/spike-tool-output-budget.md",
        lesson: "quality/measure-impact-not-existence.md" },
    ],
  });
  const row = find(rows, "headroomlabs-ai/headroom");
  assert.ok(row, "a rejected adoption must remain visible in the ledger");
  assert.equal(row.status, "rejected");
  assert.equal(row.lesson, "quality/measure-impact-not-existence.md");
});

test("the pool's positive-control repo never enters the ledger as something we use", () => {
  // buildPool injects google-gemini/deprecated-generative-ai-js unconditionally as
  // an alarm test. It is not a dependency and must not be listed as one.
  const { rows } = buildLedger({ depRepos: [{ repo: "real/one", project: "apollo" }] });
  assert.equal(find(rows, "google-gemini/deprecated-generative-ai-js"), undefined);
});

// --- lesson accounting: R4, the gate must not decay into a checkbox ----------

test("rows closed with lesson 'none' are counted separately from rows with a real lesson", () => {
  const { counts } = buildLedger({
    radarRows: [
      { repo: "a/real", project: "apollo", verdict: "ADOPT", status: "done", why: "w", evidence: "e", lesson: "quality/x.md" },
      { repo: "a/none", project: "apollo", verdict: "ADOPT", status: "done", why: "w", evidence: "e", lesson: "none" },
    ],
  });
  assert.equal(counts.closed, 2);
  assert.equal(counts.closedWithLesson, 1, "'none' is a valid answer but must be visible as a ratio");
});

// --- determinism -------------------------------------------------------------

test("output is sorted by repo and stable across input ordering", () => {
  const a = buildLedger({ depRepos: [{ repo: "z/last", project: "apollo" }, { repo: "a/first", project: "apollo" }] });
  const b = buildLedger({ depRepos: [{ repo: "a/first", project: "apollo" }, { repo: "z/last", project: "apollo" }] });
  assert.deepEqual(a.rows.map((r) => r.repo), ["a/first", "z/last"]);
  assert.deepEqual(a.rows, b.rows);
});
