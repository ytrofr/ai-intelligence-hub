const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDepsFile, mergeDepsFile } = require("../scripts/ledger-backfill");

/**
 * The backfill is the only step that writes at volume, so both of its safety
 * properties are pinned here: it must be idempotent, and it must never touch a
 * reason a person wrote.
 */

const owners = (pairs) => {
  const m = new Map();
  for (const [pkg, projects] of pairs) m.set(pkg, projects);
  return m;
};

// --- T7: idempotent ----------------------------------------------------------

test("T7 the same input twice produces byte-identical deps, ordering included", () => {
  const input = {
    owners: owners([["trafilatura", ["apollo"]], ["react", ["hermes", "apollo"]]]),
    resolved: new Map([["trafilatura", "adbar/trafilatura"], ["react", "facebook/react"]]),
    unresolved: [],
  };
  const a = buildDepsFile(input);
  const b = buildDepsFile(input);
  assert.deepEqual(a.deps, b.deps);
  assert.deepEqual(
    a.deps.map((d) => d.pkg),
    ["react", "trafilatura"],
    "sorted, so a re-run is a no-op rather than a reshuffle",
  );
});

test("T7 project lists are sorted, so input ordering cannot churn the file", () => {
  const one = buildDepsFile({
    owners: owners([["react", ["hermes", "apollo"]]]),
    resolved: new Map([["react", "facebook/react"]]),
  });
  const two = buildDepsFile({
    owners: owners([["react", ["apollo", "hermes"]]]),
    resolved: new Map([["react", "facebook/react"]]),
  });
  assert.deepEqual(one.deps, two.deps);
  assert.deepEqual(one.deps[0].projects, ["apollo", "hermes"]);
});

// --- unresolved / unknown: three states, never two ---------------------------

test("an unresolved package is RECORDED as unresolved, not dropped", () => {
  const out = buildDepsFile({
    owners: owners([["some-private-thing", ["apollo"]]]),
    resolved: new Map(),
    unresolved: ["some-private-thing"],
  });
  assert.equal(out.deps.length, 1);
  assert.equal(out.deps[0].repo, "unresolved");
  assert.equal(out.deps[0].pkg, "some-private-thing");
  assert.equal(out.counts.unresolved, 1);
});

test("an UNKNOWN package (nobody answered) is not recorded at all", () => {
  // dep-resolve returns null when no registry answered. Recording that as
  // 'unresolved' would turn a timeout into a fact.
  const out = buildDepsFile({
    owners: owners([["maybe-real", ["apollo"]]]),
    resolved: new Map(),
    unresolved: [],
    unknown: ["maybe-real"],
  });
  assert.equal(out.deps.length, 0, "a package nobody answered about is not a finding");
  assert.equal(out.counts.unknown, 1, "but it must still be COUNTED, or the loss is silent");
});

// --- T8: a previous run's knowledge is never destroyed -----------------------

test("T8 merging keeps a previously resolved slug when the new run says unknown", () => {
  const previous = { deps: [{ pkg: "react", repo: "facebook/react", projects: ["apollo"] }] };
  const fresh = buildDepsFile({ owners: owners([]), resolved: new Map(), unknown: ["react"] });
  const merged = mergeDepsFile(previous, fresh, { unknown: ["react"] });
  const row = merged.deps.find((d) => d.pkg === "react");
  assert.ok(row, "a timeout must not delete what we already knew");
  assert.equal(row.repo, "facebook/react");
});

test("T8 a package that genuinely left the manifests IS removed", () => {
  const previous = { deps: [{ pkg: "gone", repo: "old/gone", projects: ["apollo"] }] };
  const fresh = buildDepsFile({
    owners: owners([["stays", ["apollo"]]]),
    resolved: new Map([["stays", "a/stays"]]),
  });
  const merged = mergeDepsFile(previous, fresh, { unknown: [] });
  assert.equal(merged.deps.find((d) => d.pkg === "gone"), undefined);
  assert.ok(merged.deps.find((d) => d.pkg === "stays"));
});

test("T8 the deps file carries no `why` field at all — reasons live on radar rows", () => {
  // Structural guarantee for "never overwrites an authored reason": this writer
  // has no field to overwrite it with.
  const out = buildDepsFile({
    owners: owners([["react", ["apollo"]]]),
    resolved: new Map([["react", "facebook/react"]]),
  });
  assert.deepEqual(Object.keys(out.deps[0]).sort(), ["pkg", "projects", "repo"]);
});

// --- the diff a person actually reads ----------------------------------------

test("the run reports a diff against the previous file, not a total", () => {
  const previous = { deps: [{ pkg: "old", repo: "a/old", projects: ["apollo"] }] };
  const fresh = buildDepsFile({
    owners: owners([["old", ["apollo"]], ["new", ["hub"]]]),
    resolved: new Map([["old", "a/old"], ["new", "b/new"]]),
  });
  const merged = mergeDepsFile(previous, fresh, { unknown: [] });
  assert.equal(merged.diff.added.length, 1);
  assert.equal(merged.diff.added[0], "new");
  assert.equal(merged.diff.removed.length, 0);
});
