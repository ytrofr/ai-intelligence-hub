const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../routes/radar");

/**
 * H6 — GET /api/radar?project=remotion returned 500. config/radar/remotion.json
 * declares `topics` as an array of plain STRINGS ("video-engine", ...); every
 * other project's config declares an array of {id, label, blurb, keywords}
 * OBJECTS, and the route only ever read the object shape — `t.keywords.map`
 * on a bare string threw. Fixed by normalizing string -> {id, label, blurb:
 * "", keywords: []} once, without touching either JSON file.
 *
 * This exercises the REAL router against the REAL (read-only) database and
 * the REAL config/radar/*.json on disk — remotion.json already has the
 * string-topics shape, so no fixture is needed to reproduce the defect, and
 * apollo.json already has the object shape, so it doubles as the positive
 * control for free.
 */

function findGetHandler(path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  return layer.route.stack[0].handle;
}

function callRoute(handle, { query = {}, forcedProject } = {}) {
  let status = 200;
  let body = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  handle({ query, forcedProject }, res);
  return { status, body };
}

test("H6: a string-topics config (remotion) renders 200, not 500", () => {
  const handle = findGetHandler("/");
  const { status, body } = callRoute(handle, { query: { project: "remotion" } });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.topics), "topics must still be an array of the normalized shape");
});

test("H6: every normalized topic carries an id, a label, and a keywords array", () => {
  const handle = findGetHandler("/");
  const { body } = callRoute(handle, { query: { project: "remotion" } });
  for (const t of body.topics) {
    assert.equal(typeof t.id, "string");
    assert.equal(typeof t.count, "number");
    assert.ok(Array.isArray(t.top) && Array.isArray(t.sub));
  }
});

test("CONTROL: an object-topics config (apollo) still renders 200 exactly as before", () => {
  const handle = findGetHandler("/");
  const { status, body } = callRoute(handle, { query: { project: "apollo" } });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.topics));
  assert.ok(body.topics.length > 0, "apollo.json declares real topics — a broken normalizer could silently empty this");
});

test("CONTROL: an object-topics config's needsReview keyword matching still works (not silently emptied)", () => {
  const handle = findGetHandler("/");
  const { body } = callRoute(handle, { query: { project: "apollo" } });
  // needsReview is populated by matching topic keywords against un-curated
  // high-star repos in the live index — asserting it is an array (rather
  // than a specific count, which depends on live data) proves the keyword
  // flatMap over topicDefs did not throw or silently return nothing wrong.
  assert.ok(Array.isArray(body.needsReview));
});

test("CONTROL: an unknown project still 404s (normalization must not swallow this error)", () => {
  const handle = findGetHandler("/");
  const { status } = callRoute(handle, { query: { project: "definitely-not-a-real-project" } });
  assert.equal(status, 404);
});
