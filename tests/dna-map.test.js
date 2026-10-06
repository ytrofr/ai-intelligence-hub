const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDnaMap, EMPTY_MESSAGE } = require("../modules/dna-map");

// Synthetic fixture only - every name here is invented.
function cell(over = {}) {
  return {
    loads: { state: "yes", matched_files: 3, sample: "src/a.py" },
    used: { state: "yes", count: 4, unit: "rows" },
    proven: { state: "no-probe", via: [], reason: null },
    na: null,
    wire_next: false,
    why: null,
    ...over,
  };
}

function fixture() {
  return {
    generated_at: "2026-01-01T00:00:00+00:00",
    projects: ["apollo", "atlas"],
    trunks: {
      apollo: { trunk: "origin/main", behind: 2, files: 10, state: "ok", error: null },
      atlas: { trunk: "origin/main", behind: null, files: null, state: "error", error: "ls-tree exit 128" },
    },
    population: { assets: 3, cells: 6 },
    controls: [
      { name: "positive: x loads in apollo", expect: "yes", result: "FIRED" },
      { name: "negative: nothing matches", expect: "no", result: "FIRED" },
    ],
    sources: { usage: { generated_at: null, error: null } },
    assets: [
      {
        id: "rules/example-rule.md", kind: "rule", name: "example-rule", tier: "scoped", globs: ["**/x/**"], capabilities: [],
        cells: {
          apollo: cell({ used: { state: "unknown", count: null, unit: "rows" } }),
          atlas: cell({ loads: { state: "no", matched_files: 0, sample: null }, used: { state: "no", count: 0, unit: "rows" },
                       wire_next: true, why: "used elsewhere" }),
        },
      },
      {
        id: "skills/example-skill", kind: "skill", name: "example-skill", tier: "global", globs: [], capabilities: [],
        cells: { apollo: cell({ loads: { state: "always", matched_files: null, sample: null } }) },
      },
      {
        id: "capabilities/example-cap", kind: "capability", name: "Example capability", tier: "capability", globs: [], capabilities: ["example-cap"],
        cells: {
          apollo: cell({ loads: { state: "n/a", matched_files: null, sample: null }, used: { state: "n/a", count: null, unit: null },
                        proven: { state: "live", via: ["example-cap"], reason: "example-cap: 5 of 5 rows" } }),
          atlas: cell({ loads: { state: "n/a", matched_files: null, sample: null }, used: { state: "n/a", count: null, unit: null },
                       proven: { state: "absent", via: ["example-cap"], reason: "example-cap: nothing on trunk" } }),
        },
      },
    ],
    wire_next: {
      apollo: [],
      atlas: [
        { asset: "rules/example-rule.md", why: "used elsewhere" },
        { asset: "capabilities/example-cap", why: "live elsewhere" },
      ],
    },
  };
}

test("missing or unparsable map: an honest empty state, no fabricated rows", () => {
  for (const input of [null, undefined, {}, { assets: "nope" }, "garbage"]) {
    const m = buildDnaMap(input);
    assert.equal(m.status, "empty");
    assert.equal(m.message, EMPTY_MESSAGE);
    assert.equal(m.assets, undefined);
    assert.equal(m.wire_next, undefined);
  }
  assert.equal(buildDnaMap(null, { reason: "SyntaxError" }).reason, "SyntaxError");
});

test("a null count stays null and is never rendered as 0", () => {
  const m = buildDnaMap(fixture());
  const unknown = m.groups.flatMap((g) => g.assets).find((a) => a.id === "rules/example-rule.md").cells.apollo.used;
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.count, null);
  assert.doesNotMatch(unknown.title, /\b0\b/);
  assert.match(unknown.title, /count unknown/);

  const atlas = m.projects.find((p) => p.id === "atlas");
  assert.equal(atlas.trunk.behind, null);
  assert.doesNotMatch(atlas.trunk.label, /\b0 behind/);
  assert.match(atlas.trunk.label, /behind unknown/);

  // A measured zero is still a zero.
  const zero = m.groups.flatMap((g) => g.assets).find((a) => a.id === "rules/example-rule.md").cells.atlas.used;
  assert.equal(zero.count, 0);
  assert.match(zero.title, /\b0 rows\b/);
});

test("wire_next counts equal the rendered items, and an empty list is a rendered row", () => {
  const m = buildDnaMap(fixture());
  assert.deepEqual(m.wire_next.map((w) => w.project), ["apollo", "atlas"]);
  for (const w of m.wire_next) assert.equal(w.count, w.items.length);
  assert.equal(m.wire_next[0].count, 0);
  assert.equal(m.wire_next[1].count, 2);
  assert.equal(m.wire_next[1].items[1].name, "Example capability");
  assert.equal(m.counts.wire_next, m.wire_next.reduce((n, w) => n + w.items.length, 0));
});

test("a project the map lists but wire_next omits still renders a card", () => {
  const f = fixture();
  delete f.wire_next.apollo;
  const m = buildDnaMap(f);
  assert.deepEqual(m.wire_next.find((w) => w.project === "apollo"), { project: "apollo", items: [], count: 0 });
});

test("an ABSENT control produces a warning; all FIRED produces none", () => {
  assert.deepEqual(buildDnaMap(fixture()).controls.filter((c) => c.warning), []);
  const f = fixture();
  f.controls[1].result = "ABSENT";
  const m = buildDnaMap(f);
  const bad = m.controls.find((c) => c.name.startsWith("negative"));
  assert.equal(bad.warning, true);
  assert.ok(m.warnings.some((w) => /negative/.test(w)));
});

test("no controls at all is itself a warning, never silence", () => {
  const f = fixture();
  f.controls = [];
  assert.ok(buildDnaMap(f).warnings.some((w) => /no controls/i.test(w)));
});

test("unknown and no stay distinct marks through the module", () => {
  const m = buildDnaMap(fixture());
  const rule = m.groups.flatMap((g) => g.assets).find((a) => a.id === "rules/example-rule.md");
  const unknown = rule.cells.apollo.used;
  const no = rule.cells.atlas.used;
  assert.equal(unknown.state, "unknown");
  assert.equal(no.state, "no");
  assert.notEqual(unknown.glyph, no.glyph);
  assert.notEqual(unknown.word, no.word);
});

test("a project cell the map omits renders as can't-tell, not as no", () => {
  const skill = buildDnaMap(fixture()).groups.flatMap((g) => g.assets).find((a) => a.id === "skills/example-skill");
  const atlas = skill.cells.atlas;
  assert.equal(atlas.loads.state, "error");
  assert.equal(atlas.used.state, "unknown");
  assert.equal(atlas.proven.state, "unprobed");
});

test("an unrecognised state word is not trusted", () => {
  const f = fixture();
  f.assets[0].cells.apollo.proven.state = "green";
  const c = buildDnaMap(f).groups.flatMap((g) => g.assets).find((a) => a.id === "rules/example-rule.md").cells.apollo.proven;
  assert.equal(c.state, "error");
  assert.match(c.title, /unknown state green/);
});

test("groups come in order capabilities, rules, skills and counts derive from rendered marks", () => {
  const m = buildDnaMap(fixture());
  assert.deepEqual(m.groups.map((g) => g.kind), ["capability", "rule", "skill"]);
  const assets = m.groups.flatMap((g) => g.assets);
  assert.equal(m.population.assets, assets.length);
  assert.equal(m.population.projects, 2);
  assert.equal(m.population.cells, assets.length * 2);
  for (const axis of ["loads", "used", "proven"]) {
    const rendered = assets.flatMap((a) => m.projects.map((p) => a.cells[p.id][axis].state));
    for (const [s, n] of Object.entries(m.counts[axis])) assert.equal(n, rendered.filter((x) => x === s).length);
  }
});
