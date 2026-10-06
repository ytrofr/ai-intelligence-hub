const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const ThemeSearch = require("../modules/github-theme-search");
const { SearchBucket, searchRepos, buildThemeJobs, settleSearchRun, mergeHits, isStrong } = ThemeSearch;
const GitHubModule = require("../modules/github");
const { runSource, PartialFetchError } = require("../modules/fetch-runner");
const { loadThemes } = require("../modules/themes");
const { HttpError } = require("../modules/http");
const { applySnapshotSchema, SnapshotStore } = require("../database/snapshot-store");

// ---- test doubles (tests only) ---------------------------------------------

/** A fake clock the bucket sleeps on: sleep(ms) advances time instantly and records the wait. */
function fakeClock(start = 0) {
  const c = { t: start, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.sleeps.push(ms);
    c.t += ms;
  };
  return c;
}

function bucketOn(clock, opts = {}) {
  return new SearchBucket({ now: clock.now, sleep: clock.sleep, ...opts });
}

/** A search response the way http.js#fetchResponse hands it back. */
function searchResponse(items, headers = {}) {
  return { headers: new Headers(headers), json: async () => ({ total_count: items.length, items }) };
}

const repo = (full_name, stars, extra = {}) => ({
  id: stars * 7 + full_name.length,
  full_name,
  html_url: `https://github.com/${full_name}`,
  description: "a neutral widget",
  stargazers_count: stars,
  forks_count: 2,
  open_issues_count: 1,
  pushed_at: "2026-10-05T00:00:00Z",
  created_at: "2026-09-20T00:00:00Z",
  topics: [],
  ...extra,
});

function freshStore() {
  const db = new Database(":memory:");
  applySnapshotSchema(db);
  return new SnapshotStore(db);
}

function fakeDb() {
  const calls = { status: [], upserts: [] };
  return {
    calls,
    upsertItems: (items) => (calls.upserts.push(items), items.length),
    updateSourceLastFetched: () => {},
    updateSourceStatus: (row) => calls.status.push(row),
  };
}

// ---- the bucket: waits, never aborts ---------------------------------------

test("bucket: the 26th search in a minute WAITS for the window, it does not abort", async () => {
  const clock = fakeClock();
  const b = bucketOn(clock, { perMinute: 25 });
  for (let i = 0; i < 25; i++) assert.equal((await b.acquire()).ok, true);
  assert.equal(clock.t, 0, "the first 25 go through without waiting");
  const r = await b.acquire();
  assert.equal(r.ok, true, "never refused when there is no deadline");
  assert.equal(clock.t, 60000, "slept exactly until the oldest slot left the 60s window");
  assert.equal(r.waitedMs, 60000);
});

test("bucket: never more than perMinute acquisitions in any 60s window", async () => {
  const clock = fakeClock();
  const b = bucketOn(clock, { perMinute: 25 });
  const stamps = [];
  for (let i = 0; i < 80; i++) {
    await b.acquire();
    stamps.push(clock.t);
  }
  for (const s of stamps) {
    const inWindow = stamps.filter((x) => x >= s && x < s + 60000).length;
    assert.ok(inWindow <= 25, `window starting ${s} holds ${inWindow}`);
  }
});

test("bucket: X-RateLimit-Remaining 0 holds every caller until X-RateLimit-Reset (+1s), then proceeds", async () => {
  const clock = fakeClock(1_000_000);
  const b = bucketOn(clock);
  await b.acquire();
  const resetSec = Math.floor((clock.t + 30000) / 1000);
  b.observe(new Headers({ "x-ratelimit-resource": "search", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSec) }));
  const r = await b.acquire();
  assert.equal(r.ok, true);
  assert.equal(clock.t, resetSec * 1000 + 1000, "slept to the reset instead of throwing");
});

test("bucket: headers from the CORE resource do not touch the search window", async () => {
  const clock = fakeClock(5000);
  const b = bucketOn(clock);
  b.observe(new Headers({ "x-ratelimit-resource": "core", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "999999" }));
  await b.acquire();
  assert.equal(clock.t, 5000);
});

test("bucket: a slot that cannot start before the deadline is refused WITHOUT being consumed", async () => {
  const clock = fakeClock();
  const b = bucketOn(clock, { perMinute: 2 });
  await b.acquire();
  await b.acquire();
  const r = await b.acquire({ deadline: 30000 });
  assert.equal(r.ok, false);
  assert.equal(r.readyAt, 60000);
  assert.equal(clock.t, 0, "did not sleep past a deadline it could not meet");
  assert.equal(b.stamps.length, 2, "the refused request took no slot");
  assert.equal((await b.acquire({ deadline: 60000 })).ok, true, "control: a deadline the slot CAN meet is served");
});

test("bucket: concurrent callers are served one at a time, in order (FIFO)", async () => {
  const clock = fakeClock();
  const b = bucketOn(clock, { perMinute: 1 });
  const order = [];
  await Promise.all(["a", "b", "c"].map((id) => b.acquire().then(() => order.push([id, clock.t]))));
  assert.deepEqual(order, [["a", 0], ["b", 60000], ["c", 120000]]);
});

// ---- searchRepos ------------------------------------------------------------

test("searchRepos: a 429 holds the bucket one window and retries once, then succeeds", async () => {
  const clock = fakeClock();
  const b = bucketOn(clock);
  let calls = 0;
  const fetchRes = async () => {
    calls += 1;
    if (calls === 1) throw new HttpError(429, "u", "secondary rate limit");
    return searchResponse([repo("a/b", 10)]);
  };
  const r = await searchRepos("q", { bucket: b, fetchRes });
  assert.equal(r.status, "ok");
  assert.equal(calls, 2);
  assert.equal(clock.t, 60000, "waited the penalty window before the retry");
});

test("searchRepos: a non-rate error (422 bad query) is thrown, not retried, not swallowed", async () => {
  let calls = 0;
  const fetchRes = async () => {
    calls += 1;
    throw new HttpError(422, "u", "Validation Failed");
  };
  await assert.rejects(searchRepos("q", { bucket: bucketOn(fakeClock()), fetchRes }), /HTTP 422/);
  assert.equal(calls, 1);
});

test("searchRepos: past the deadline it reports deferred and makes no request", async () => {
  const clock = fakeClock();
  const b = bucketOn(clock, { perMinute: 1 });
  await b.acquire();
  let calls = 0;
  const r = await searchRepos("q", { bucket: b, deadline: 1000, fetchRes: async () => (calls++, searchResponse([])) });
  assert.equal(r.status, "deferred");
  assert.equal(calls, 0);
});

// ---- the honesty gate -------------------------------------------------------

test("settle: executed < planned is PARTIAL with the items kept, never success", () => {
  const items = [{ id: "x" }];
  assert.throws(
    () => settleSearchRun({ label: "t", items, executed: 2, planned: 5, notes: ["budget: 3 searches left"] }),
    (err) => err instanceof PartialFetchError && /executed 2 \/ planned 5/.test(err.message) && err.items === items
  );
});

test("settle: nothing executed is an ERROR (not partial), and full execution returns the items", () => {
  assert.throws(
    () => settleSearchRun({ label: "t", items: [], executed: 0, planned: 4 }),
    (err) => !(err instanceof PartialFetchError) && /executed 0 \/ planned 4, nothing ran/.test(err.message)
  );
  const items = [{ id: "y" }];
  assert.equal(settleSearchRun({ label: "t", items, executed: 4, planned: 4 }), items);
});

// ---- query builder ----------------------------------------------------------

const NOW = new Date("2026-10-06T12:00:00Z");

test("jobs: two windows per base query, dated from today, `other` skipped", () => {
  const themes = [
    { id: "alpha", queries: ["topic:alpha", '"alpha beta" in:name'] },
    { id: "other", queries: ["should-not-run"] },
  ];
  const jobs = buildThemeJobs(themes, {}, NOW);
  assert.equal(jobs.length, 4);
  assert.deepEqual(
    jobs.map((j) => j.q),
    [
      "topic:alpha created:>2026-09-06 stars:>30",
      "topic:alpha pushed:>2026-09-29 stars:>300",
      '"alpha beta" in:name created:>2026-09-06 stars:>30',
      '"alpha beta" in:name pushed:>2026-09-29 stars:>300',
    ]
  );
  assert.ok(jobs.every((j) => j.theme === "alpha"));
});

test("jobs: windows can be trimmed to one per query; an unknown window is refused", () => {
  const themes = [{ id: "alpha", queries: ["topic:alpha"] }];
  assert.deepEqual(buildThemeJobs(themes, { windows: ["active"] }, NOW).map((j) => j.window), ["active"]);
  assert.throws(() => buildThemeJobs(themes, { windows: ["weekly"] }, NOW), /unknown window/);
});

test("jobs: the real taxonomy plans 2 queries x 2 windows for every theme but `other`", () => {
  const themes = loadThemes();
  const real = themes.filter((t) => t.id !== "other");
  const jobs = buildThemeJobs(themes, {}, NOW);
  assert.equal(jobs.length, real.length * 4, "population: every theme contributes exactly 4 searches");
  for (const t of real) assert.equal(t.queries.length, 2, `${t.id} has 2 base queries`);
});

test("isStrong: >=300 stars AND pushed within 30 days (positive control 7's bar)", () => {
  assert.equal(isStrong(repo("a/b", 300, { pushed_at: "2026-09-10T00:00:00Z" }), NOW), true);
  assert.equal(isStrong(repo("a/b", 299, { pushed_at: "2026-10-01T00:00:00Z" }), NOW), false);
  assert.equal(isStrong(repo("a/b", 5000, { pushed_at: "2026-08-01T00:00:00Z" }), NOW), false);
});

test("mergeHits: one entry per repo, found_by deduped, every finding theme kept", () => {
  const m = mergeHits([
    { job: { theme: "a", query: "qa", window: "new" }, items: [repo("X/Y", 10)] },
    { job: { theme: "a", query: "qa", window: "active" }, items: [repo("x/y", 10)] },
    { job: { theme: "b", query: "qb", window: "new" }, items: [repo("x/y", 10)] },
  ]);
  assert.equal(m.size, 1);
  const e = m.get("x/y");
  assert.deepEqual(e.found_by, [{ theme: "a", query: "qa" }, { theme: "b", query: "qb" }]);
  assert.deepEqual([...e.foundThemes], ["a", "b"]);
});

// ---- the module end to end (offline) ----------------------------------------

const THEMES = [
  { id: "alpha", queries: ["qa1", "qa2"] },
  { id: "beta", queries: ["qb1"] },
  { id: "other", queries: [] },
];

function themeModule({ fetchRes, store, clock, bucket, config = {} }) {
  const mod = new ThemeSearch({ id: "gh-theme", type: "github-theme", config: { budget_ms: 600000, timeout_ms: 20000, ...config } });
  mod.deps = { token: "t", themes: THEMES, fetchRes, store, clock: clock.now, bucket };
  return mod;
}

test("module: full run -> items gh-theme-<owner>-<name>, themes ∪ finder, found_by, search snapshots", async () => {
  const clock = fakeClock(NOW.getTime());
  const store = freshStore();
  store.record({ repo: "acme/shared", day: "2026-10-06", stars: 999, origin: "api" });
  const fetchRes = async (url) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("q"));
    if (q.startsWith("qa1")) return searchResponse([repo("acme/shared", 400), repo("acme/only-a", 50)]);
    if (q.startsWith("qb1")) return searchResponse([repo("acme/shared", 400)]);
    return searchResponse([]);
  };
  const mod = themeModule({ fetchRes, store, clock, bucket: bucketOn(clock) });
  const items = await mod.fetch();
  assert.equal(mod.runReport.executed, 6);
  assert.equal(mod.runReport.planned, 6);
  const shared = items.find((i) => i.title === "acme/shared");
  assert.equal(shared.id, "gh-theme-acme-shared");
  assert.equal(shared.source, "gh-theme");
  assert.deepEqual(shared.metadata.themes.sort(), ["alpha", "beta"]);
  assert.deepEqual(shared.metadata.found_by, [{ theme: "alpha", query: "qa1" }, { theme: "beta", query: "qb1" }]);
  assert.equal(mod.runReport.per_theme.alpha.hits, 2);
  assert.equal(mod.runReport.per_theme.beta.hits, 1);
  assert.equal(mod.runReport.per_theme.beta.strong, 1);
  assert.deepEqual(store.series("acme/only-a"), [{ day: "2026-10-06", stars: 50, origin: "search" }]);
  assert.deepEqual(store.series("acme/shared"), [{ day: "2026-10-06", stars: 999, origin: "api" }], "an api reading outranks a search one");
});

test("module: budget runs out mid-run -> PARTIAL via the runner (items + snapshots kept), never success", async () => {
  const clock = fakeClock(NOW.getTime());
  const store = freshStore();
  // 2 searches/min, deadline = 100s budget - 30s margin = 70s: four searches fit (t=0,0,60,60), the 5th would start at 120s.
  const mod = themeModule({
    fetchRes: async () => searchResponse([repo("acme/one", 40)]),
    store,
    clock,
    bucket: bucketOn(clock, { perMinute: 2 }),
    config: { budget_ms: 100000 },
  });
  const db = fakeDb();
  const r = await runSource({ id: "gh-theme", config: {} }, { db, createModule: () => Object.assign(mod, { canFetch: () => true }), timeoutMs: 60000 });
  assert.equal(r.status, "partial");
  assert.match(r.error, /executed 4 \/ planned 6/);
  assert.equal(r.items, 1, "the items it DID get are ingested");
  assert.equal(r.report.executed, 4);
  assert.equal(db.calls.status[0].last_status, "partial");
  assert.equal(store.series("acme/one").length, 1, "the snapshot it took is kept");
});

test("module: a failed query also makes the run partial; every query failing is an error", async () => {
  const clock = fakeClock(NOW.getTime());
  let n = 0;
  const flaky = themeModule({
    fetchRes: async () => {
      n += 1;
      if (n === 2) throw new HttpError(422, "u", "Validation Failed");
      return searchResponse([repo("acme/one", 40)]);
    },
    store: freshStore(),
    clock,
    bucket: bucketOn(clock),
  });
  await assert.rejects(flaky.fetch(), (e) => e instanceof PartialFetchError && /executed 5 \/ planned 6/.test(e.message));

  const dead = themeModule({
    fetchRes: async () => {
      throw new HttpError(500, "u", "");
    },
    store: freshStore(),
    clock,
    bucket: bucketOn(clock),
  });
  await assert.rejects(dead.fetch(), (e) => !(e instanceof PartialFetchError) && /executed 0 \/ planned 6/.test(e.message));
});

// ---- github.js now runs sequentially through the same bucket -----------------

test("github: topic searches go one at a time through the bucket, and a deferred tail is partial", async () => {
  const clock = fakeClock(NOW.getTime());
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchRes = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight -= 1;
    return searchResponse([repo("acme/topic", 10)]);
  };
  const full = new GitHubModule({ id: "github", type: "github", config: { topics: ["ai", "llm"] } });
  full.deps = { fetchRes, clock: clock.now, bucket: bucketOn(clock) };
  const items = await full.fetch();
  assert.equal(maxInFlight, 1, "never more than one search in flight");
  assert.equal(full.runReport.executed, 4);
  assert.equal(items.length, 1);

  const clock2 = fakeClock(NOW.getTime());
  const short = new GitHubModule({ id: "github", type: "github", config: { topics: ["ai", "llm"], budget_ms: 100000, timeout_ms: 20000 } });
  short.deps = { fetchRes, clock: clock2.now, bucket: bucketOn(clock2, { perMinute: 1 }) };
  await assert.rejects(short.fetch(), (e) => e instanceof PartialFetchError && /executed 2 \/ planned 4/.test(e.message));
});
