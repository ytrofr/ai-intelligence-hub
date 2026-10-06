const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const Snapshot = require("../modules/github-snapshot");
const { buildSnapshotPool, runSnapshot } = Snapshot;
const { applySnapshotSchema, SnapshotStore } = require("../database/snapshot-store");

function freshStore() {
  const db = new Database(":memory:");
  applySnapshotSchema(db);
  return new SnapshotStore(db);
}

const ok = (full_name, stars, extra = {}) => ({
  status: 200,
  remaining: 4000,
  body: { full_name, stargazers_count: stars, forks_count: 3, open_issues_count: 1, pushed_at: "2026-10-05T00:00:00Z" },
  ...extra,
});

test("pool: priority order trending > tracked > radar > top items, deduped case-insensitively", () => {
  const pool = buildSnapshotPool({
    trending: ["NVIDIA/OpenShell", "a/b"],
    tracked: ["nvidia/openshell", "c/d"],
    radar: ["C/D", "e/f", "not-a-slug", ""],
    topItems: ["g/h", "a/b"],
  });
  assert.deepEqual(pool, [
    { repo: "nvidia/openshell", leg: "trending" },
    { repo: "a/b", leg: "trending" },
    { repo: "c/d", leg: "tracked" },
    { repo: "e/f", leg: "radar" },
    { repo: "g/h", leg: "top-items" },
  ]);
});

test("pool: the cap keeps the HIGHER-priority legs", () => {
  const pool = buildSnapshotPool({ trending: ["t/1", "t/2"], tracked: ["k/1"], topItems: ["x/1", "x/2"] }, 3);
  assert.deepEqual(pool.map((p) => p.repo), ["t/1", "t/2", "k/1"]);
});

test("run: writes one api row per answered repo and counts errors honestly", async () => {
  const store = freshStore();
  const answers = {
    "a/b": ok("a/b", 100),
    "gone/repo": { status: 404, body: null, remaining: 3999 },
    "old/name": ok("New/Name", 50, { renamed: true }),
  };
  const r = await runSnapshot({
    pool: [{ repo: "a/b" }, { repo: "gone/repo" }, { repo: "old/name" }, { repo: "boom/x" }],
    getRepo: async (slug) => {
      if (slug === "boom/x") throw new Error("socket hang up");
      return answers[slug];
    },
    store,
    day: "2026-10-06",
  });
  assert.equal(r.pool, 4);
  assert.equal(r.written, 2);
  assert.equal(r.renamed, 1);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors.join(" "), /gone\/repo: HTTP 404/);
  assert.match(r.errors.join(" "), /boom\/x: socket hang up/);
  assert.deepEqual(store.series("a/b"), [{ day: "2026-10-06", stars: 100, origin: "api" }]);
  assert.equal(store.series("new/name")[0].stars, 50, "a renamed repo is recorded under its NEW name");
  assert.deepEqual(store.series("old/name"), []);
});

test("run: a 200 without stargazers_count is an error, never a 0-star reading", async () => {
  const store = freshStore();
  const r = await runSnapshot({
    pool: [{ repo: "a/b" }],
    getRepo: async () => ({ status: 200, body: { full_name: "a/b" }, remaining: 4000 }),
    store,
    day: "2026-10-06",
  });
  assert.equal(r.written, 0);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(store.originCounts(), []);
});

test("run: a low core quota stops the run; the rest are SKIPPED, not silently dropped", async () => {
  const store = freshStore();
  const r = await runSnapshot({
    pool: [{ repo: "a/1" }, { repo: "a/2" }, { repo: "a/3" }],
    getRepo: async (slug) => ok(slug, 10, { remaining: 150 }),
    store,
    day: "2026-10-06",
    concurrency: 1,
    minRemaining: 200,
  });
  assert.equal(r.stopped, true);
  assert.equal(r.written, 1);
  assert.deepEqual(r.skipped, ["a/2", "a/3"]);
});

function moduleWith(deps, config = {}) {
  const mod = new Snapshot({ id: "gh-snapshot", type: "github-snapshot", config });
  mod.deps = { token: "t", now: () => new Date("2026-10-06T12:00:00Z"), db: {}, ...deps };
  return mod;
}

test("module: returns NO feed items on success", async () => {
  const store = freshStore();
  const mod = moduleWith({ legs: { trending: ["a/b", "c/d"] }, store, getRepo: async (s) => ok(s, 7) });
  assert.deepEqual(await mod.fetch(), []);
  assert.equal(store.originCounts()[0].n, 2);
});

test("module: EVERYTHING failing throws (E == N is an error, not success-with-0)", async () => {
  const mod = moduleWith({ legs: { trending: ["a/b", "c/d"] }, store: freshStore(), getRepo: async () => ({ status: 500, body: null }) });
  await assert.rejects(mod.fetch(), /nothing written.*pool 2 · written 0 · errors 2/);
});

test("module: partial errors still succeed (control for the all-failed case)", async () => {
  const mod = moduleWith({
    legs: { trending: ["a/b", "c/d"] },
    store: freshStore(),
    getRepo: async (s) => (s === "a/b" ? ok(s, 1) : { status: 404, body: null }),
  });
  assert.deepEqual(await mod.fetch(), []);
});

test("module: stopping early on quota throws even though rows were written", async () => {
  const store = freshStore();
  const mod = moduleWith(
    { legs: { trending: ["a/1", "a/2"] }, store, getRepo: async (s) => ok(s, 1, { remaining: 10 }) },
    { concurrency: 1 }
  );
  await assert.rejects(mod.fetch(), /stopped early/);
  assert.equal(store.originCounts()[0].n, 1, "the real reading taken before the stop is kept");
});

test("module: an empty pool and a missing token both refuse to run", async () => {
  await assert.rejects(moduleWith({ legs: {}, store: freshStore(), getRepo: async () => ok("a/b", 1) }).fetch(), /pool is empty/);
  await assert.rejects(moduleWith({ token: "", legs: { trending: ["a/b"] }, store: freshStore() }).fetch(), /GITHUB_TOKEN/);
});
