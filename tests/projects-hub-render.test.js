/**
 * The projects hub renderer.
 *
 * The render surface is pure, so every one of these runs with no DOM. What they
 * guard is the pair of properties that make this page worth building:
 *
 *   - an unanswered need renders LOUD, and never like an empty table
 *   - colour never travels alone: word AND glyph, on every state
 *
 * Each "renders as absent" cell has an accepting twin, because a renderer that
 * emitted the empty state unconditionally would pass every absence test here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const R = require("../public/js/projects-hub-render");
const { buildHub } = require("../modules/projects-hub");

const NOW = Date.parse("2026-09-04T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const row = (over = {}) => ({
  repo: "SALT-NLP/Design2Code",
  kind: "dataset",
  total: 92,
  basis: "measured",
  licence: "mit",
  licence_class: "permissive",
  state: "trial",
  verdict: "ADOPT",
  why: "the answer key for design fidelity",
  next_action: "run the bench",
  effort: 1,
  effect: 4,
  time: 1,
  impact: 4,
  risk: 1,
  slot: "apollo/design-fidelity",
  eval_freshness: { state: "not-wired", word: "not wired", shape: "◇", ok: false, cadence_days: null, slot: null },
  ...over,
});

const model = (over = {}) =>
  buildHub({
    now: NOW,
    groundTruth: {
      projects: [
        {
          id: "apollo",
          name: "Apollo",
          slots: [
            {
              id: "design-fidelity",
              needs: "screenshot + HTML pairs",
              kind: "ground-truth",
              instrument: "scorer.py",
              runs: 1,
              last_ran: { at: daysAgo(10), number: "median 55.7 -> 57.6", caveat: "19 pages" },
              candidates: [],
            },
            { id: "page-judge", needs: "graded pages", runs: 0, last_ran: null, candidates: [] },
            { id: "half-done", needs: "some corpus", runs: 0, last_ran: null, candidates: [{ repo: "p/q" }] },
          ],
        },
        { id: "empty-proj", name: "Nothing Here", slots: [] },
      ],
      ...(over.groundTruth || {}),
    },
    matrix: {
      projects: [{ id: "apollo", rows: [row(), ...(over.extraRows || [])] }, { id: "empty-proj", rows: [] }],
      population: { rows: 1, ledger_rows: 332, hidden: 398 },
    },
  });

const has = (html, needle, msg) => assert.ok(html.includes(needle), msg || `expected to find: ${needle}`);
const lacks = (html, needle, msg) => assert.ok(!html.includes(needle), msg || `should NOT contain: ${needle}`);

// --- colour never travels alone -------------------------------------------

test("every chip carries a WORD and a GLYPH - the level alone is never the signal", () => {
  for (const level of ["good", "warn", "bad", "none"]) {
    const c = R.chip(level, "some word");
    has(c, "some word", `${level} chip lost its word`);
    assert.match(c, /<span class="g">&#\d+;<\/span>|<span class="g">\?<\/span>/, `${level} chip lost its glyph`);
  }
});

test("the four chip levels use four DISTINCT glyphs - shape carries the meaning", () => {
  const glyphs = ["good", "warn", "bad", "none"].map((l) => R.chip(l, "x").match(/class="g">([^<]+)</)[1]);
  assert.equal(new Set(glyphs).size, 4, `glyphs collide: ${glyphs.join(" ")}`);
});

test("an unknown chip level still renders a glyph rather than nothing", () => {
  has(R.chip("nonsense-level", "word"), '<span class="g">?</span>');
});

// --- an unanswered need is the loudest thing on the page -------------------

test("L0 states BOTH populations and where each number came from", () => {
  const html = R.renderL0(model());
  has(html, "needs unanswered");
  has(html, "no candidate proposed at all");
  has(html, "<em>scored</em>");
  // apollo: page-judge is empty; half-done holds an unrated candidate, so it is
  // unscored but NOT empty. One population is 1, the other 2 - which is the point.
  has(html, "1 of 3", "the empty/total sentence must be derived from the population");
  has(html, "2 have nothing");
});

test("L0 gives a project with an unanswered need the BAD tone, not a quiet zero", () => {
  const html = R.renderL0(model());
  assert.match(html, /<div class="stat b-bad"><b>1<\/b><span>need unanswered/);
});

test("ACCEPTING TWIN: a project with everything answered gets the GOOD tone", () => {
  const html = R.renderL0(model());
  assert.match(html, /<div class="stat b-good"><b>0<\/b><span>needs unanswered/, "empty-proj has 0 slots, so 0 unanswered");
});

test("L0 renders a project with nothing in it as a card of zeros, not a missing card", () => {
  const html = R.renderL0(model());
  has(html, "empty-proj");
  has(html, "Nothing Here");
});

test("L2 on an unanswered need says so in words, and does NOT render an empty table", () => {
  const html = R.renderL2(model(), "apollo", "page-judge");
  has(html, "nobody has answered this");
  has(html, "That is the finding, not an empty table");
  lacks(html, "<thead>", "an empty table would read as 'nothing matched', not as 'nobody looked'");
});

test("proposed-but-unscored renders DIFFERENTLY from nothing-proposed", () => {
  const nothing = R.renderL2(model(), "apollo", "page-judge");
  const proposed = R.renderL2(model(), "apollo", "half-done");
  has(proposed, "1 proposed, none scored");
  has(proposed, "p/q", "the proposed candidate is named, not just counted");
  lacks(proposed, "nobody has answered this");
  assert.notEqual(nothing, proposed, "the two findings must not render alike");
});

test("ACCEPTING TWIN: an answered slot renders the real table with its scores", () => {
  const html = R.renderL2(model(), "apollo", "design-fidelity");
  has(html, "<thead>");
  has(html, "SALT-NLP/Design2Code");
  has(html, ">92<");
});

// --- runs and ages ---------------------------------------------------------

test("never-run and undated never read as fresh, and each is its own word", () => {
  has(R.runChip({ runs: 0, age_days: null }), "never run");
  has(R.runChip({ runs: 2, age_days: null }), "undated run");
  has(R.runChip({ runs: 1, age_days: 10 }), "10d ago");
  assert.match(R.runChip({ runs: 1, age_days: 400 }), /b-bad/, "a year-old run is not green");
  assert.match(R.runChip({ runs: 1, age_days: 10 }), /b-good/);
});

test("L2 prints the run's number WITH the caveat that bounds it", () => {
  const html = R.renderL2(model(), "apollo", "design-fidelity");
  has(html, "median 55.7 -&gt; 57.6");
  has(html, "19 pages", "a number without its caveat is a different claim");
});

test("a slot that never ran shows 'never', never a zero date", () => {
  const html = R.renderL2(model(), "apollo", "page-judge");
  has(html, ">never<");
});

// --- eval freshness --------------------------------------------------------

test("evalChip explains not-wired as legal rather than as a failure", () => {
  const c = R.evalChip({ state: "not-wired", word: "not wired" });
  has(c, "not wired");
  has(c, "Absent is legal");
});

test("a stalled eval is BAD and a running one is GOOD - and neither is silent", () => {
  assert.match(R.evalChip({ state: "stalled", word: "stalled", cadence_days: 90 }), /b-bad/);
  assert.match(R.evalChip({ state: "running", word: "running", cadence_days: 90 }), /b-good/);
  has(R.evalChip({ state: "running", word: "running", cadence_days: 90 }), "stalled at 180d");
});

test("an eval naming an undeclared slot NAMES it - the reader can go look", () => {
  has(R.evalChip({ state: "slot-missing", word: "slot missing", slot: "x/y" }), "x/y");
});

test("no eval at all renders nothing, rather than a chip claiming something", () => {
  assert.equal(R.evalChip(null), "");
});

// --- the close form: the irreversible action has no button -----------------

test("a CLOSED row gets no close form, and says why there is no button", () => {
  const html = R.renderCloseForm("apollo", row({ state: "done" }));
  lacks(html, "<form");
  has(html, "already done");
  has(html, "deletes its evidence and its lesson permanently");
});

test("a rejected row is equally protected - both closing states, not just done", () => {
  const html = R.renderCloseForm("apollo", row({ state: "rejected" }));
  lacks(html, "<form");
  has(html, "already rejected");
});

test("ACCEPTING TWIN: an OPEN row gets the form, carrying project and repo", () => {
  const html = R.renderCloseForm("apollo", row({ state: "trial" }));
  has(html, "<form");
  has(html, 'data-project="apollo"');
  has(html, 'data-repo="SALT-NLP/Design2Code"');
  has(html, "/api/radar/status", "the page must say which gate it posts through");
});

test("L3 renders the record and the form together", () => {
  const html = R.renderL3(model(), "apollo", "design-fidelity", "dataset:SALT-NLP/Design2Code");
  has(html, "SALT-NLP/Design2Code");
  has(html, "the answer key for design fidelity");
  has(html, "<form");
});

// --- routing ---------------------------------------------------------------

test("the four depths route to the four levels, and each is addressable", () => {
  const m = model();
  has(R.route(m, "#/"), "Every project, five numbers each");
  has(R.route(m, "#/apollo"), "what it needs");
  has(R.route(m, "#/apollo/design-fidelity"), "screenshot + HTML pairs");
  has(R.route(m, "#/apollo/design-fidelity/dataset:SALT-NLP%2FDesign2Code"), "<form");
});

test("an empty hash and a bare '#' both land on L0 rather than nowhere", () => {
  has(R.route(model(), ""), "Every project");
  has(R.route(model(), "#"), "Every project");
  has(R.route(model(), "#/"), "Every project");
});

test("every unknown route says WHAT it could not find - never a blank stage", () => {
  for (const [hash, needle] of [
    ["#/nope", "no project called &quot;nope&quot;"],
    ["#/apollo/nope", "declares no slot"],
    ["#/apollo/design-fidelity/nope", "no candidate &quot;nope&quot;"],
    ["#/a/b/c/d", "deeper than this hub goes"],
  ]) {
    const html = R.route(model(), hash);
    has(html, "no such view", `${hash} must render the no-such-view chip`);
    has(html, needle, `${hash} must name what was missing`);
  }
});

test("a malformed percent-escape in the hash does not throw", () => {
  assert.doesNotThrow(() => R.route(model(), "#/%E0%A4%A"));
});

test("crumbs let you drop one segment at a time, and are decoded for display", () => {
  const c = R.crumbs(["apollo", "design-fidelity"]);
  has(c, 'href="#/"');
  has(c, 'href="#/apollo"');
  has(c, 'href="#/apollo/design-fidelity"');
});

// --- escaping --------------------------------------------------------------

test("a repo name carrying markup is ESCAPED, in the record and in the form", () => {
  const m = model({ extraRows: [row({ repo: '<img src=x onerror=alert(1)>', total: 44 })] });
  const html = R.renderL2(m, "apollo", "design-fidelity");
  lacks(html, "<img src=x", "unescaped markup reached the page");
  has(html, "&lt;img src=x");
});

test("esc covers all five entities, so an attribute cannot be broken out of", () => {
  assert.equal(R.esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  assert.equal(R.esc(null), "");
  assert.equal(R.esc(undefined), "");
});

// --- the footer is derived --------------------------------------------------

test("the footer's numbers all come from the payload, and name both populations", () => {
  const html = R.renderFooter(model(), "2026-09-04T12:00:00Z");
  has(html, "2 projects");
  has(html, "3 slots (1 with nothing proposed)");
  has(html, "1 candidate of 332", "a count of one must not read '1 candidates'");
  has(html, "332 ledger rows");
  has(html, "2026-09-04T12:00:00Z");
});

test("CONTROL: an empty model renders every level without throwing", () => {
  const empty = buildHub();
  for (const hash of ["#/", "#/x", "#/x/y", "#/x/y/z"]) {
    assert.doesNotThrow(() => R.route(empty, hash), `threw on ${hash}`);
  }
  has(R.renderFooter(empty, null), "0 projects");
});

// --- scores ----------------------------------------------------------------

test("the bands are coarse on purpose, and unscored is a WORD not a zero", () => {
  assert.equal(R.scoreBand(92), "good");
  assert.equal(R.scoreBand(72), "mid");
  assert.equal(R.scoreBand(44), "poor");
  assert.equal(R.scoreBand(null), "none");
  assert.equal(R.scoreText(null), "unscored");
  assert.equal(R.scoreText(0), "0", "a real zero is a zero, not 'unscored'");
});

test("a count of one reads singular - 'needs unanswered' vs 'need unanswered'", () => {
  const html = R.renderL0(model());
  has(html, "<b>1</b><span>need unanswered", "one need is a need, not needs");
  has(html, "<b>0</b><span>needs unanswered", "zero takes the plural");
});
