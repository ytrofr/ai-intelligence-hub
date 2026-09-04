/**
 * Adoption Matrix rendering contracts.
 *
 * The defect these exist for: the page used to draw every dimension with the
 * same five circles, so `risk: 5` (very risky) and `impact: 5` (very valuable)
 * were pixel-identical. A reader had to remember which three columns invert.
 * The first test below is the regression cell for exactly that, and it fails
 * on any change that stops encoding direction.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const R = require("../public/js/adoption-matrix-render.js");
const { licenceClass } = require("../modules/adoption-matrix.js");

const dimBetter = (key) => R.DIMS.find((d) => d.key === key).better;

// --- direction ------------------------------------------------------------

test("favour() inverts the three cost dimensions and leaves the value dimensions alone", () => {
  assert.equal(R.favour(5, dimBetter("risk")), 1, "risk 5 is the WORST news");
  assert.equal(R.favour(1, dimBetter("risk")), 5);
  assert.equal(R.favour(5, dimBetter("impact")), 5, "impact 5 is the BEST news");
  assert.equal(R.favour(1, dimBetter("impact")), 1);
  assert.equal(R.favour(null, +1), null, "an unscored dimension has no favourability");
});

test("REGRESSION: risk 5 and impact 5 do not render identically", () => {
  const risk = R.dimCell(5, dimBetter("risk"));
  const impact = R.dimCell(5, dimBetter("impact"));
  assert.notEqual(risk, impact, "the two must differ - this is the bug the redesign fixed");
  assert.match(impact, /b-good/);
  assert.match(risk, /b-poor/);
  // CONTROL: two cells that really ARE the same news must still match, or the
  // assertion above would pass for a renderer that simply never repeats itself.
  assert.equal(R.dimCell(5, dimBetter("impact")), R.dimCell(5, dimBetter("effect")));
});

test("the bar LENGTH stays the raw value even when the colour inverts", () => {
  const on = (html) => (html.match(/class="on"/g) || []).length;
  assert.equal(on(R.dimCell(5, dimBetter("risk"))), 5);
  assert.equal(on(R.dimCell(5, dimBetter("impact"))), 5);
  assert.equal(on(R.dimCell(2, dimBetter("risk"))), 2);
});

// --- colour is never the only channel -------------------------------------

test("every chip carries a glyph AND a word, so colour alone never conveys it", () => {
  const cells = [
    R.basisChip("measured"), R.basisChip("estimated"),
    R.licenceChip("MIT", "permissive"), R.licenceChip("ELv2", "restricted"), R.licenceChip("", "unknown"),
    R.costChip("free"), R.costChip("paid-later"),
    R.fitChip("fits-cpu", 11), R.fitChip("too-big-here", null),
  ];
  for (const html of cells) {
    assert.match(html, /<span class="g">/, `no shape glyph in: ${html}`);
    assert.match(html, />[^<>]*[a-z][^<>]*</i, `no word in: ${html}`);
  }
});

test("the palette avoids the red/green pair the operator cannot distinguish", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/css/favourability.css"), "utf8");
  const fav = [...css.matchAll(/--fav:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
  assert.ok(fav.length >= 4, `expected a favourability ramp, found ${fav.length} stops`);
  // #22c55e / #ef4444 are the project's generic success/error tokens: correct
  // everywhere else, wrong here, because this ramp is the whole signal.
  assert.ok(!fav.includes("#22c55e"), "green must not be a favourability stop");
  assert.ok(!fav.includes("#ef4444"), "red must not be a favourability stop");
});

test("NO page defines its own --fav stops - one ramp, or the guard above is blind", () => {
  // The ramp used to be inlined in adoption-matrix.html and this test read it
  // BY FILENAME. That guard could not see a second page inventing its own
  // palette, and projects.html did exactly that: #22c55e and #ef4444, the one
  // pair the operator cannot tell apart, on a page whose chips ARE the verdict.
  const dir = path.join(__dirname, "..", "public");
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".html")) continue;
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    if (/--fav:\s*#/.test(body)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], "these pages fork the ramp instead of linking /css/favourability.css");
});

test("CONTROL: the shared ramp file really does define stops - the scan can fire", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/css/favourability.css"), "utf8");
  assert.ok(/--fav:\s*#/.test(css), "if this file had no stops, the offender scan above would pass vacuously");
});

// --- licence, fail-closed --------------------------------------------------

test("licenceClass clears only the permissive allowlist, and fails closed otherwise", () => {
  assert.equal(licenceClass("MIT"), "permissive");
  assert.equal(licenceClass("apache-2.0"), "permissive");
  assert.equal(licenceClass("odc-by"), "permissive");
  // Read and NOT cleared: source-available, a per-directory carve-out, and a
  // non-commercial clause are each an adoption blocker, not a footnote.
  assert.equal(licenceClass("Elastic License 2.0"), "restricted");
  assert.equal(licenceClass("Apache-2.0 + src/pro carve-out"), "restricted");
  assert.equal(licenceClass("mixed per sub-set, incl. cc-by-nc-4.0"), "restricted");
  // Never read is its own state - it must not borrow either verdict.
  assert.equal(licenceClass(""), "unknown");
  assert.equal(licenceClass(undefined), "unknown");
});

test("an unread licence renders as a question, never as a pass", () => {
  const unknown = R.licenceChip("", "unknown");
  assert.match(unknown, /not read/);
  assert.ok(!/b-good/.test(unknown), "an unread licence must not render favourable");
});

// --- score banding ---------------------------------------------------------

test("score bands are absolute, and an unscored row gets no band at all", () => {
  assert.equal(R.scoreBand(92), "good");
  assert.equal(R.scoreBand(80), "good");
  assert.equal(R.scoreBand(79), "mid");
  assert.equal(R.scoreBand(65), "mid");
  assert.equal(R.scoreBand(56), "poor");
  assert.equal(R.scoreBand("unscored"), "none");
});

// --- the drawer: the rows the page does not show --------------------------

const HIDDEN_FIXTURE = {
  population: {
    rows: 2, pairs: 6, ledger_rows: 5, hidden: 4,
    hidden_decided: 1, hidden_dependency: 3, adopted_unscored: 1,
  },
  hidden: [
    { repo: "a/decided", kind: "repo", project: "apollo", state: "rejected", hidden_class: "decided" },
    { repo: "a/dep1", kind: "repo", project: "apollo", state: "in-use", hidden_class: "dependency" },
    { repo: "a/dep2", kind: "repo", project: "apollo", state: "in-use", hidden_class: "dependency" },
    { repo: "a/dep3", kind: "repo", project: "atlas", state: "in-use", hidden_class: "dependency" },
  ],
  adopted_unscored: [{ repo: "a/blind", kind: "repo", project: "apollo", state: "done" }],
};

/** Find one drawer section by its HEADING, never by its index - membership is
 *  the contract here, and a layout change must not turn a membership cell red.
 *  The order is pinned separately, by the cell below that is actually about it. */
function section(html, heading) {
  const parts = html.split(/<h3>/).slice(1);
  const hit = parts.find((p) => p.startsWith(heading));
  assert.ok(hit, `no drawer section headed "${heading}"`);
  return hit;
}

test("the drawer splits hidden rows by class and each table gets exactly its own", () => {
  const html = R.renderHidden(HIDDEN_FIXTURE);
  assert.equal(html.split(/<h3>/).length - 1, 3, "adopted-unscored, decided, dependencies");
  const adopted = section(html, "Adopted, and never scored");
  const decided = section(html, "Decided, bound to nothing");
  const deps = section(html, "Plain dependencies");
  assert.match(adopted, /a\/blind/);
  assert.ok(!/a\/dep1/.test(adopted), "a dependency must not appear in the adopted table");
  assert.match(decided, /a\/decided/);
  assert.ok(!/a\/dep1/.test(decided), "a dependency must not appear in the decided table");
  assert.match(deps, /a\/dep1[\s\S]*a\/dep2[\s\S]*a\/dep3/);
  assert.ok(!/a\/decided/.test(deps), "a decided row must not appear in the dependency table");
});

test("the costliest table is FIRST - a drawer nobody scrolls buries what it opened for", () => {
  const headings = R.renderHidden(HIDDEN_FIXTURE).split(/<h3>/).slice(1).map((p) => p.split("<")[0].trim());
  assert.equal(headings[0].startsWith("Adopted, and never scored"), true, "adopted-blind is the one that cost something");
  assert.equal(headings[2].startsWith("Plain dependencies"), true, "294 rows nobody proposed go last");
});

test("REGRESSION: the drawer prints the counts it was GIVEN, not the ones it can reach", () => {
  // The bug this guards: a summary that recomputes from the rows on screen
  // agrees with itself no matter how many were dropped upstream.
  const html = R.renderHidden(HIDDEN_FIXTURE);
  assert.match(html, /The 4 pairs this page does not show/);
  assert.match(html, /1 decided/);
  assert.match(html, /3 plain deps/);
});

test("an empty class says so, and does not borrow another class's rows", () => {
  const html = R.renderHidden({
    population: { rows: 0, pairs: 1, ledger_rows: 1, hidden: 1, hidden_decided: 0, hidden_dependency: 1, adopted_unscored: 0 },
    hidden: [{ repo: "a/dep", kind: "repo", project: "apollo", state: "in-use", hidden_class: "dependency" }],
    adopted_unscored: [],
  });
  assert.match(html, /Nothing adopted without a score/);
  assert.match(html, /Nothing decided-but-unbound/);
  assert.match(html, /a\/dep/);
});

test("CONTROL: every row is reachable wherever its table sits", () => {
  // The membership cell above must not depend on which section came first -
  // that is what section() exists for, and this proves it.
  const html = R.renderHidden(HIDDEN_FIXTURE);
  for (const needle of ["a/blind", "a/decided", "a/dep1", "a/dep2", "a/dep3"]) {
    assert.match(html, new RegExp(needle.replace("/", "\\/")), `${needle} must be reachable wherever its table sits`);
  }
});

test("REGRESSION: a truncated payload still reports the count the SERVER made", () => {
  // Models a drawer that pages its rows: the server counted 9 and sent 4. A
  // summary that recomputes from what is on screen would confidently say 4,
  // and nothing on the page would contradict it.
  const html = R.renderHidden({
    population: { rows: 2, pairs: 11, ledger_rows: 9, hidden: 9, hidden_decided: 5, hidden_dependency: 4, adopted_unscored: 1 },
    hidden: HIDDEN_FIXTURE.hidden,
    adopted_unscored: HIDDEN_FIXTURE.adopted_unscored,
  });
  assert.match(html, /The 9 pairs this page does not show/, "the summary is the server's count, not a re-count of the rows it received");
  assert.match(html, /5 decided/);
  assert.match(html, /4 plain deps/);
});

// --- the eval chip --------------------------------------------------------

test("a row with no eval gets NO chip - a library was never a benchmark", () => {
  assert.equal(R.evalChip(null), "");
  assert.equal(R.evalChip({ state: "not-wired", word: "not wired", shape: "◇" }), "");
});

test("each eval state renders its own word, and colour is never the only channel", () => {
  const mk = (state, word, extra = {}) => R.evalChip({ state, word, age_days: 10, cadence_days: 90, slot: "apollo/s", ...extra });
  const cells = [
    mk("running", "running"), mk("due", "due"), mk("stalled", "stalled"),
    mk("never-ran", "never ran", { age_days: null }), mk("slot-missing", "slot missing", { age_days: null }),
    mk("undated", "undated run", { age_days: null }),
  ];
  assert.equal(new Set(cells).size, 6, "six states, six distinct chips");
  for (const html of cells) {
    assert.match(html, /<span class="g">/, `no shape glyph in: ${html}`);
    assert.match(html, /eval [a-z]/, `no word in: ${html}`);
  }
  assert.match(cells[0], /b-good/);
  assert.match(cells[2], /b-bad/, "stalled must not read favourable");
});

test("REGRESSION: running and stalled do not render identically", () => {
  const running = R.evalChip({ state: "running", word: "running", age_days: 10, cadence_days: 90, slot: "apollo/s" });
  const stalled = R.evalChip({ state: "stalled", word: "stalled", age_days: 400, cadence_days: 90, slot: "apollo/s" });
  assert.notEqual(running, stalled);
  // CONTROL: two chips that really ARE the same news still match, or the
  // assertion above passes for a renderer that never repeats itself.
  assert.equal(
    R.evalChip({ state: "running", word: "running", age_days: 10, cadence_days: 90, slot: "apollo/s" }),
    R.evalChip({ state: "running", word: "running", age_days: 10, cadence_days: 90, slot: "apollo/s" }),
  );
});

test("the chip carries the age, so 'running' is checkable rather than trusted", () => {
  assert.match(R.evalChip({ state: "running", word: "running", age_days: 12, cadence_days: 90, slot: "apollo/s" }), /12d/);
  assert.ok(!/null/.test(R.evalChip({ state: "never-ran", word: "never ran", age_days: null, cadence_days: 90, slot: "apollo/s" })));
});
