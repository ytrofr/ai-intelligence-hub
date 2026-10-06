const test = require("node:test");
const assert = require("node:assert/strict");

const Discovery = require("../modules/github-discovery");
const { SearchBucket } = require("../modules/github-theme-search");
const { runSource, PartialFetchError } = require("../modules/fetch-runner");
const { HttpError } = require("../modules/http");
const { excludeFromLegs, nonGithubExclusions, buildSnapshotPool } = require("../modules/github-snapshot");

// ---- test doubles (tests only) ---------------------------------------------

function fakeClock(start) {
  const c = { t: start, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.sleeps.push(ms);
    c.t += ms;
  };
  return c;
}

const searchResponse = (items, headers = {}) => ({ headers: new Headers(headers), json: async () => ({ items }) });
const repo = (full_name, stars) => ({
  id: stars,
  full_name,
  html_url: `https://github.com/${full_name}`,
  description: "d",
  stargazers_count: stars,
  forks_count: 0,
  open_issues_count: 0,
  pushed_at: "2026-10-05T00:00:00Z",
  created_at: "2026-09-01T00:00:00Z",
  topics: [],
  owner: { login: full_name.split("/")[0] },
});

const PROJECTS = {
  projects: [
    { id: "p1", name: "P1", searchQueries: ["alpha", "beta", "gamma"], languages: ["python", "go"], topics: [], dependencies: [] },
  ],
};

/** A discovery module wired to fakes: no network, no CDN, no projects.json. */
function discovery(strategy, { fetchRes, clock, bucket, config = {} }) {
  const mod = new Discovery({ id: `github-discovery-${strategy}`, type: "github-discovery", config: { strategy, budget_ms: 600000, ...config } });
  mod.deps = { fetchRes, clock: clock.now, bucket };
  mod.loadProjects = () => PROJECTS;
  mod.shuffleArray = (a) => a; // deterministic order
  mod.analyzeRepo = async () => ({ readmeSummary: "", readmeLength: 0, dependencies: [] });
  return mod;
}

function fakeDb() {
  const calls = { status: [] };
  return {
    calls,
    upsertItems: (items) => items.length,
    updateSourceLastFetched: () => {},
    updateSourceStatus: (row) => calls.status.push(row),
  };
}

const NOW = Date.parse("2026-10-06T12:00:00Z");
let savedToken;
test.before(() => {
  savedToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
});
test.after(() => {
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

// ---- tech-stack -------------------------------------------------------------

test("tech-stack: an exhausted search window WAITS for X-RateLimit-Reset and runs every query (was: abort at 5%)", async () => {
  const clock = fakeClock(NOW);
  const resetSec = Math.floor((NOW + 40000) / 1000);
  let n = 0;
  const fetchRes = async () => {
    n += 1;
    // the first answer says the window is spent - the old wrapper threw here
    const headers = n === 1 ? { "x-ratelimit-resource": "search", "x-ratelimit-remaining": "0", "x-ratelimit-limit": "30", "x-ratelimit-reset": String(resetSec) } : {};
    return searchResponse([repo(`acme/r${n}`, 500 + n)], headers);
  };
  const mod = discovery("tech-stack", { fetchRes, clock, bucket: new SearchBucket({ now: clock.now, sleep: clock.sleep }), config: { max_queries: 3 } });
  const items = await mod.fetch();
  assert.equal(n, 3, "all three queries executed");
  assert.equal(items.length, 3);
  assert.deepEqual(mod.runReport, { executed: 3, planned: 3, repos: 3 });
  assert.ok(clock.t >= resetSec * 1000, "it slept until the reset instead of stopping");
});

test("tech-stack: a reset that lands after the budget -> PARTIAL with executed/planned, never success", async () => {
  const clock = fakeClock(NOW);
  const resetSec = Math.floor((NOW + 3600000) / 1000); // an hour away, budget is 10 min
  const fetchRes = async () =>
    searchResponse([repo("acme/one", 900)], { "x-ratelimit-resource": "search", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSec) });
  const mod = discovery("tech-stack", { fetchRes, clock, bucket: new SearchBucket({ now: clock.now, sleep: clock.sleep }), config: { max_queries: 3 } });
  const db = fakeDb();
  const r = await runSource({ id: "github-discovery-tech", config: {} }, { db, createModule: () => Object.assign(mod, { canFetch: () => true }), timeoutMs: 60000 });
  assert.equal(r.status, "partial");
  assert.match(r.error, /tech-stack: executed 1 \/ planned 3/);
  assert.match(r.error, /budget: 2 searches left/);
  assert.equal(r.items, 1, "what it DID fetch is still ingested");
  assert.equal(db.calls.status[0].last_status, "partial");
  assert.equal(clock.t, NOW, "it did not sleep into a reset it could not reach");
});

test("tech-stack: a failed query is counted as not executed (partial); all failing is an error", async () => {
  const clock = fakeClock(NOW);
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n === 2) throw new HttpError(422, "u", "Validation Failed");
    return searchResponse([repo(`acme/f${n}`, 300)]);
  };
  const bucket = new SearchBucket({ now: clock.now, sleep: clock.sleep });
  await assert.rejects(
    discovery("tech-stack", { fetchRes: flaky, clock, bucket, config: { max_queries: 3 } }).fetch(),
    (e) => e instanceof PartialFetchError && /executed 2 \/ planned 3/.test(e.message) && e.items.length === 2
  );
  const dead = async () => {
    throw new HttpError(503, "u", "");
  };
  await assert.rejects(
    discovery("tech-stack", { fetchRes: dead, clock, bucket, config: { max_queries: 3 } }).fetch(),
    (e) => !(e instanceof PartialFetchError) && /executed 0 \/ planned 3/.test(e.message)
  );
});

// ---- rising-stars shares the same helper ------------------------------------

test("rising-stars: same honesty - executed counted per language, deferred tail is partial", async () => {
  const clock = fakeClock(NOW);
  const fetchRes = async () => searchResponse([repo("acme/rise", 120)]);
  // 1 search/min and a 70s budget (margin 17.5s -> last start at 52.5s): the 2nd language's slot opens at 60s, too late.
  const bucket = new SearchBucket({ now: clock.now, sleep: clock.sleep, perMinute: 1 });
  const mod = discovery("rising-stars", { fetchRes, clock, bucket, config: { budget_ms: 70000 } });
  await assert.rejects(mod.fetch(), (e) => e instanceof PartialFetchError && /rising-stars: executed 1 \/ planned 2/.test(e.message));

  const clock2 = fakeClock(NOW);
  const full = discovery("rising-stars", { fetchRes, clock: clock2, bucket: new SearchBucket({ now: clock2.now, sleep: clock2.sleep }) });
  const items = await full.fetch();
  assert.equal(full.runReport.executed, 2, "control: with room in the window both languages run");
  assert.equal(items.length, 1);
});

// ---- snapshot pool hygiene: non-GitHub ids are skipped, not errors ---------

test("snapshot pool: Hugging Face ids (radar kind model|dataset) and tracker-404s are excluded and reported", () => {
  const radar = [
    { repo: "Example-Org/some-reranker-base", kind: "model" },
    { repo: "example-org/some-dataset", kind: "dataset" },
    { repo: "acme/tool" }, // a plain repo row stays
  ];
  const tracked = [
    { repo: "acme/tool", http_status: 200 },
    { repo: "gone/repo", http_status: 404 },
  ];
  const exclude = nonGithubExclusions(radar, tracked);
  const { legs, skipped } = excludeFromLegs(
    {
      trending: ["acme/hot"],
      tracked: ["example-org/some-reranker-base", "example-org/some-dataset", "acme/tool", "gone/repo"],
      radar: ["Example-Org/some-reranker-base", "acme/tool", "gone/repo"],
      topItems: ["acme/hot"],
    },
    exclude
  );
  const pool = buildSnapshotPool(legs).map((p) => p.repo);
  assert.deepEqual(pool, ["acme/hot", "acme/tool"], "only GitHub repos reach the GitHub API");
  assert.deepEqual(
    skipped.map((s) => `${s.repo}=${s.reason}`).sort(),
    ["example-org/some-dataset=huggingface dataset", "example-org/some-reranker-base=huggingface model", "gone/repo=tracker: 404 on GitHub"],
    "each excluded id counted ONCE, with its reason, however many legs carried it"
  );
});

test("snapshot module: excluded ids are SKIPPED in the run line, never errors (and a real 404 still is one)", async () => {
  const Snapshot = require("../modules/github-snapshot");
  const Database = require("better-sqlite3");
  const { applySnapshotSchema, SnapshotStore } = require("../database/snapshot-store");
  const raw = new Database(":memory:");
  applySnapshotSchema(raw);
  const store = new SnapshotStore(raw);
  const asked = [];
  const mod = new Snapshot({ id: "gh-snapshot", type: "github-snapshot", config: {} });
  mod.deps = {
    token: "t",
    now: () => new Date(NOW),
    db: {},
    store,
    legs: { tracked: ["example-org/some-dataset", "acme/a", "acme/deleted"] },
    exclude: new Map([["example-org/some-dataset", "huggingface dataset"]]),
    getRepo: async (slug) => {
      asked.push(slug);
      if (slug === "acme/deleted") return { status: 404, body: null, remaining: 4000 };
      return { status: 200, remaining: 4000, body: { full_name: slug, stargazers_count: 5 } };
    },
  };
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  try {
    assert.deepEqual(await mod.fetch(), []);
  } finally {
    console.log = orig;
  }
  assert.deepEqual(asked, ["acme/a", "acme/deleted"], "the HF id never reached the GitHub client");
  const line = lines.find((l) => l.startsWith("[snapshot] pool"));
  assert.match(line, /pool 2 · written 1 · errors 1 · skipped 1 \(quota 0, non-github\/gone 1\)/);
});
