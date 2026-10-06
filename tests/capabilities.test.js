const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTrust } = require("../modules/capabilities");

const registry = {
  projects: ["limor", "smith"],
  capabilities: [
    { id: "tool-evidence", name: "Tool calls saved", spec: "tool-evidence/SPEC.md", control: "limor" },
    { id: "otel-genai-spans", name: "OTel spans", spec: "otel-genai-spans/SPEC.md", control: "smith" },
  ],
};

test("no state file: every cell renders as unprobed, none missing", () => {
  const t = buildTrust({ registry, state: null });
  assert.equal(t.projects.length, 2);
  for (const p of t.projects) {
    assert.deepEqual(Object.keys(p.cells).sort(), ["otel-genai-spans", "tool-evidence"]);
    for (const c of Object.values(p.cells)) assert.equal(c.state, "unprobed");
  }
  assert.deepEqual(t.counts, { cells: 4, probed: 0, by_state: { live: 0, built: 0, absent: 0, error: 0, unprobed: 4 } });
  assert.equal(t.generated_at, null);
});

test("state cells pass through; a project missing from state is unprobed", () => {
  const state = {
    generated_at: "2026-09-14T12:00:00+00:00",
    capabilities: { "tool-evidence": { control_fired: true } },
    projects: {
      limor: {
        trunk: "origin/main", trunk_sha: "abc", checkout_behind_trunk: "11", prod_status: "readable",
        cells: {
          "tool-evidence": { state: "live", reason: "9 of 10", impl: { files: ["a.py"] }, caller: { files: ["b.py"] }, prod: { status: "ok", population: 10, hits: 9 } },
          "otel-genai-spans": { state: "error", reason: "grep failed" },
        },
      },
    },
  };
  const t = buildTrust({ registry, state });
  const limor = t.projects.find((p) => p.id === "limor");
  assert.equal(limor.cells["tool-evidence"].state, "live");
  assert.deepEqual(limor.cells["tool-evidence"].files, ["a.py", "b.py"]);
  assert.equal(limor.cells["otel-genai-spans"].state, "error");
  assert.equal(t.projects.find((p) => p.id === "smith").cells["tool-evidence"].state, "unprobed");
  assert.equal(t.capabilities[0].control_fired, true);
  assert.equal(t.capabilities[1].control_fired, null);
  assert.deepEqual(t.counts, { cells: 4, probed: 2, by_state: { live: 1, built: 0, absent: 0, error: 1, unprobed: 2 } });
});

test("an unknown state word is not trusted - it renders unprobed with the reason", () => {
  const state = { projects: { limor: { cells: { "tool-evidence": { state: "green" } } } } };
  const c = buildTrust({ registry, state }).projects[0].cells["tool-evidence"];
  assert.equal(c.state, "unprobed");
  assert.match(c.reason, /unknown state green/);
});

test("counts equal the rendered cells", () => {
  const state = { projects: { limor: { cells: { "tool-evidence": { state: "absent" }, "otel-genai-spans": { state: "built" } } },
                              smith: { cells: { "tool-evidence": { state: "absent" }, "otel-genai-spans": { state: "live" } } } } };
  const t = buildTrust({ registry, state });
  const rendered = t.projects.flatMap((p) => Object.values(p.cells).map((c) => c.state));
  for (const s of Object.keys(t.counts.by_state)) {
    assert.equal(t.counts.by_state[s], rendered.filter((x) => x === s).length);
  }
  assert.equal(t.counts.probed, 4);
});
