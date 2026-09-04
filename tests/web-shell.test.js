/**
 * The front-end shell's invariants — the two that are cheap to lose in a rewrite
 * and expensive to notice.
 *
 * This file REPLACES the "no two scripts loaded by the same page declare the
 * same top-level name" scan in tests/site-nav.test.js. That guard existed
 * because classic <script> tags share one global scope: earlier in this arc a
 * `function esc` in site-nav.js collided with a `const esc` in
 * projects-hub-render.js, which is a SyntaxError, which killed the whole
 * renderer - and the page said "Could not load the hub: route is not defined"
 * while all 626 tests stayed green. Nothing but dumping the rendered DOM found
 * it.
 *
 * ES modules do not share global scope, so that collision is structurally
 * impossible here. What replaces it is the assertion that the page really is
 * one module - because the day someone adds a second classic <script>, the old
 * failure becomes possible again and nothing else would say so.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const INDEX = path.join(__dirname, "..", "web", "index.html");
const html = fs.readFileSync(INDEX, "utf8");

/** Every <script> tag, with its attributes, in source order. */
function scripts() {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
}

test("the app is exactly one module script - no classic script can share its scope", () => {
  const all = scripts();
  const modules = all.filter((a) => /type\s*=\s*["']module["']/.test(a));
  assert.equal(
    modules.length,
    1,
    `expected one module script, found ${modules.length}: ${modules.join(" | ")}`,
  );
});

test("POSITIVE CONTROL: the script scanner can see a script at all", () => {
  // A regex that matched nothing would make every assertion above vacuous.
  assert.ok(scripts().length >= 2, `found ${scripts().length} script tags, expected at least 2`);
});

test("the browser-capture tag survives every rewrite of index.html", () => {
  // The operator's own evidence ring for this project. Losing it does not break
  // the page - it silently blinds `/capture hub`, which is where a UI failure is
  // supposed to be diagnosed from. A test is the only thing that notices.
  assert.match(html, /localhost:9876\/inject\.js/, "the :9876 capture tag is gone from web/index.html");
  assert.match(html, /data-project="hub"/, "the capture tag must name this project or the ring cannot route it");
});

test("the built artifact carries the capture tag too, not just the source", () => {
  // Presence in markup is not presence in what ships. If Vite ever starts
  // stripping or rewriting that tag, the source assertion above stays green
  // while the served page goes blind.
  const built = path.join(__dirname, "..", "dist", "index.html");
  if (!fs.existsSync(built)) {
    console.log("SKIPPED: no dist/ - run `npm --prefix web run build` to exercise this cell");
    return;
  }
  assert.match(fs.readFileSync(built, "utf8"), /localhost:9876\/inject\.js/);
});
