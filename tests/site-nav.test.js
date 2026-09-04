/**
 * The one site nav.
 *
 * Two things are worth guarding here, and only one of them is about markup:
 *
 *   1. the nav is on EVERY page - the operator's first ask was that it be
 *      persistent, and a nav that is merely present on the pages someone
 *      remembered is exactly the failure. The scan below is the mechanism; a
 *      page that ships without the mount div fails it.
 *   2. the drill-downs live INSIDE Projects - five links that used to sit flat
 *      in row 1 are lenses on one project, and row 2 only exists once a project
 *      is chosen.
 *
 * Every renderer here is pure, so all of this runs with no DOM.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const N = require("../public/js/site-nav");

const PUBLIC = path.join(__dirname, "..", "public");

// ---------------------------------------------------------------------------
// Row 1 - the three places
// ---------------------------------------------------------------------------

test("row 1 offers exactly three places, and the lenses are NOT among them", () => {
  const html = N.renderSiteNav({ active: "items" });
  assert.equal(N.PRIMARY.length, 3);
  for (const p of N.PRIMARY) assert.match(html, new RegExp(`>${p.label}<`));
  // The regression this whole change exists to prevent: seven flat links.
  for (const gone of ["Stack Ledger", "Adoption Matrix", "Ground Truth", "Adoption Radar", "What We Have"]) {
    assert.doesNotMatch(html, new RegExp(gone), `${gone} must not be a top-level nav item`);
  }
});

test("the active place is marked by a CLASS and aria-current, never by hue alone", () => {
  const html = N.renderSiteNav({ active: "projects" });
  assert.match(html, /<a href="\/projects\.html" class="on" aria-current="page">Projects<\/a>/);
  // ACCEPTING TWIN: a page that is not current carries neither marker, so the
  // assertion above cannot be satisfied by a renderer that marks everything.
  assert.match(html, /<a href="\/">Items<\/a>/);
});

test("the glyph that marks the active item is a SHAPE in css, not a colour", () => {
  const css = fs.readFileSync(path.join(PUBLIC, "css", "site-nav.css"), "utf8");
  assert.match(css, /\.sn a\.on::before\s*\{\s*content:/, "the active item needs a non-colour channel");
});

// ---------------------------------------------------------------------------
// Row 2 - the project lens bar
// ---------------------------------------------------------------------------

test("with no project there is NO lens bar - a lens over nothing has no way back", () => {
  assert.equal(N.renderProjectBar("", "stack"), "");
  assert.doesNotMatch(N.renderSiteNav({ active: "items" }), /all projects/);
});

test("ACCEPTING TWIN: with a project the bar carries every lens and a way back", () => {
  const html = N.renderSiteNav({ project: "apollo", view: "stack" });
  assert.match(html, /&larr; all projects/);
  assert.match(html, /<b>apollo<\/b>/);
  for (const v of N.PROJECT_VIEWS) assert.match(html, new RegExp(`>${v.label}<`));
});

test("every lens carries the project through, so the page you land on is scoped", () => {
  const html = N.renderSiteNav({ project: "apollo", view: "needs" });
  assert.match(html, /\/adoption-matrix\.html\?project=apollo/);
  assert.match(html, /\/stack\.html\?project=apollo/);
  assert.match(html, /\/radar\.html\?project=apollo/);
  assert.match(html, /\/ground-truth\.html\?project=apollo/);
  assert.match(html, /\/projects\.html#\/apollo/);
});

test("a project id is URL-encoded into every lens link", () => {
  const html = N.renderSiteNav({ project: "a b/c", view: "" });
  assert.match(html, /\?project=a%20b%2Fc/);
  assert.doesNotMatch(html, /\?project=a b\/c/);
});

test("a project id is HTML-escaped where it is shown", () => {
  const html = N.renderSiteNav({ project: '<img src=x onerror=1>', view: "" });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("a lens page with no explicit active id still lights Projects", () => {
  const html = N.renderSiteNav({ project: "apollo", view: "stack" });
  assert.match(html, /href="\/projects\.html" class="on"/);
});

test("projectFromUrl reads ?project= and returns '' rather than null", () => {
  assert.equal(N.projectFromUrl("?project=apollo"), "apollo");
  assert.equal(N.projectFromUrl("?other=1"), "");
  assert.equal(N.projectFromUrl(""), "");
  assert.equal(N.projectFromUrl(undefined), "");
});

// ---------------------------------------------------------------------------
// Persistence - the ask was "clear and persistent to ALL pages"
// ---------------------------------------------------------------------------

/**
 * The two exempt pages are redirect stubs: they exist to send you somewhere
 * else, so a nav on them would be furniture on a page nobody reads. The CONTROL
 * below proves each one really does redirect - an exemption list nothing checks
 * is how a real page quietly joins it.
 */
const REDIRECT_STUBS = {
  "digest.html": /window\.location\.href = '\/\?view=digests'/,
};

const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));

test("CONTROL: every exempt page really is a redirect stub", () => {
  for (const [file, tell] of Object.entries(REDIRECT_STUBS)) {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    assert.match(html, tell, `${file} is exempt from the nav but does not redirect`);
  }
});

test("every page that is not a redirect stub mounts the shared nav", () => {
  const missing = [];
  for (const file of pages) {
    if (REDIRECT_STUBS[file]) continue;
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    const has =
      html.includes('id="site-nav"') &&
      html.includes("/js/site-nav.js") &&
      html.includes("/css/site-nav.css");
    if (!has) missing.push(file);
  }
  assert.deepEqual(missing, [], `these pages ship without the shared nav: ${missing.join(", ")}`);
  // The denominator, printed by the assertion below rather than assumed: a scan
  // that found no pages at all would otherwise pass silently.
  assert.ok(pages.length >= 8, `only ${pages.length} pages scanned - the scan is not seeing public/`);
});

test("no page hand-writes its own nav row any more", () => {
  const offenders = [];
  for (const file of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    // The old idiom, on every page before this change.
    if (/class="backlink"/.test(html)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `these pages still carry the old hand-written nav: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Two scripts, one global scope
// ---------------------------------------------------------------------------

/**
 * Classic <script> tags share ONE global scope, and `const esc` in one file
 * beside `function esc` in another is a SyntaxError that kills the whole second
 * file. That is how this nav shipped a hub reading "Could not load the hub:
 * route is not defined" while all 626 unit tests were green - every module was
 * correct alone, and only loading them together was wrong.
 *
 * The suite could not see it because it requires each file separately. This
 * cell puts them in the same room.
 */
function topLevelNames(src) {
  // Column 0 only: inside an IIFE everything is indented, so a file that keeps
  // its declarations private contributes nothing here - which is the point.
  const names = new Set();
  for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

test("no two scripts loaded by the same page declare the same top-level name", () => {
  const collisions = [];
  let scanned = 0;
  for (const file of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, file), "utf8");
    const srcs = [...html.matchAll(/<script src="(\/js\/[^"]+)"/g)].map((m) => m[1]);
    const seen = new Map();
    for (const src of srcs) {
      const p = path.join(PUBLIC, src.replace(/^\//, ""));
      if (!fs.existsSync(p)) continue;
      scanned++;
      for (const name of topLevelNames(fs.readFileSync(p, "utf8"))) {
        if (seen.has(name)) collisions.push(`${file}: ${name} in both ${seen.get(name)} and ${src}`);
        else seen.set(name, src);
      }
    }
  }
  assert.deepEqual(collisions, [], collisions.join(" | "));
  assert.ok(scanned >= 4, `only ${scanned} page scripts scanned - the scan is not finding them`);
});

test("CONTROL: the collision detector can see a top-level name at all", () => {
  const names = topLevelNames(fs.readFileSync(path.join(PUBLIC, "js", "projects-hub-render.js"), "utf8"));
  assert.ok(names.has("esc"), "the detector must find `const esc` - it is the exact name that collided");
  // And it must NOT see names that a file keeps inside its own IIFE.
  const nav = topLevelNames(fs.readFileSync(path.join(PUBLIC, "js", "site-nav.js"), "utf8"));
  assert.equal(nav.has("esc"), false, "site-nav.js must keep its helpers private");
});
