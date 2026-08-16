const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildInventory } = require("../modules/inventory");

function rig({ profiles, radar = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv-"));
  const configPath = path.join(dir, "projects.json");
  fs.writeFileSync(configPath, JSON.stringify({ projects: profiles }));
  const radarDir = path.join(dir, "radar");
  fs.mkdirSync(radarDir);
  for (const [id, audit] of Object.entries(radar)) {
    fs.writeFileSync(path.join(radarDir, `${id}.json`), JSON.stringify({ project: id, audit }));
  }
  return { configPath, radarDir };
}

const P = (id, over = {}) => ({ id, name: id.toUpperCase(), repoPath: `/fake/${id}`, ...over });
const row = (repo, status, verdict = "ADOPT") => ({ repo, status, verdict });

test("every profile appears, in config order", () => {
  const { configPath, radarDir } = rig({ profiles: [P("apollo"), P("hub"), P("lyra")] });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => ["a"], exists: () => true });
  assert.deepEqual(inv.projects.map((p) => p.id), ["apollo", "hub", "lyra"]);
  assert.equal(inv.totals.projects, 3);
});

test("A REPO ADOPTED BY TWO PROJECTS APPEARS ONCE, WITH BOTH NAMES", () => {
  // This column is the entire point: without it each project rediscovers what
  // another already solved.
  const { configPath, radarDir } = rig({
    profiles: [P("apollo"), P("hermes")],
    radar: {
      apollo: [row("google-labs-code/design.md", "accepted")],
      hermes: [row("google-labs-code/design.md", "accepted")],
    },
  });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => [], exists: () => true });
  assert.equal(inv.shared.length, 1);
  assert.deepEqual(inv.shared[0], { repo: "google-labs-code/design.md", projects: ["apollo", "hermes"] });
  assert.equal(inv.totals.adoptions, 1, "one repo, not two adoptions");
});

test("a repo adopted by one project is NOT listed as shared", () => {
  const { configPath, radarDir } = rig({
    profiles: [P("apollo"), P("hub")],
    radar: { apollo: [row("a/solo", "accepted")] },
  });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => [], exists: () => true });
  assert.equal(inv.shared.length, 0);
});

test("A PROJECT WITH NO READABLE REPO REPORTS 'unknown', NEVER 0", () => {
  // Zero dependencies is a claim; an unreadable path is not evidence for it.
  const { configPath, radarDir } = rig({ profiles: [P("ghost", { repoPath: null }), P("real")] });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => ["x", "y"], exists: (p) => p === "/fake/real" });
  assert.equal(inv.projects[0].deps, "unknown");
  assert.equal(inv.projects[1].deps, 2);
});

test("a repo that throws while being read is unknown too, not a crash", () => {
  const { configPath, radarDir } = rig({ profiles: [P("boom")] });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => { throw new Error("EACCES"); }, exists: () => true });
  assert.equal(inv.projects[0].deps, "unknown");
});

test("only accepted and done count as adopted — proposed and rejected do not", () => {
  const { configPath, radarDir } = rig({
    profiles: [P("apollo")],
    radar: { apollo: [row("a/yes", "accepted"), row("b/shipped", "done"), row("c/maybe", "proposed"), row("d/no", "rejected")] },
  });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => [], exists: () => true });
  assert.deepEqual(inv.projects[0].adopted.sort(), ["a/yes", "b/shipped"]);
  assert.equal(inv.projects[0].proposed, 1);
});

test("a drafted blurb is reported as unconfirmed so nobody mistakes it for yours", () => {
  const { configPath, radarDir } = rig({
    profiles: [P("a", { blurb: "drafted", blurb_confirmed: false }), P("b", { blurb: "yours", blurb_confirmed: true })],
  });
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => [], exists: () => true });
  assert.equal(inv.totals.unconfirmed_blurbs, 1);
  assert.equal(inv.projects[0].blurb_confirmed, false);
  assert.equal(inv.projects[1].blurb_confirmed, true);
});

test("an unparseable radar file costs that project's rows, not the whole page", () => {
  const { configPath, radarDir } = rig({ profiles: [P("apollo"), P("hub")], radar: { hub: [row("a/b", "accepted")] } });
  fs.writeFileSync(path.join(radarDir, "apollo.json"), "{ not json");
  const inv = buildInventory({ configPath, radarDir, readDepsFn: () => [], exists: () => true });
  assert.equal(inv.projects.length, 2);
  assert.deepEqual(inv.projects[0].adopted, []);
  assert.deepEqual(inv.projects[1].adopted, ["a/b"]);
});
