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
  const css = fs.readFileSync(path.join(__dirname, "../public/adoption-matrix.html"), "utf8");
  const fav = [...css.matchAll(/--fav:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
  assert.ok(fav.length >= 4, `expected a favourability ramp, found ${fav.length} stops`);
  // #22c55e / #ef4444 are the project's generic success/error tokens: correct
  // everywhere else, wrong here, because this ramp is the whole signal.
  assert.ok(!fav.includes("#22c55e"), "green must not be a favourability stop");
  assert.ok(!fav.includes("#ef4444"), "red must not be a favourability stop");
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
