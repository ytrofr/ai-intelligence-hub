/**
 * The trends builder (routes/lib/trends-builder.js) and GET /api/trends.
 *
 * Every cell drives an in-memory SQLite with the real snapshot schema. The
 * data is synthetic test input, built here and nowhere else.
 *
 * Positive control 5 (a repo the hub has known > 7 days, +1,000 stars in our
 * own snapshots, must reach "Surged this week though known") and negative
 * control 3 (stale giants must not reach the top 20) from the lane design live
 * here, each beside the control that proves the cell can tell the difference.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const Database = require("better-sqlite3");
const { applySnapshotSchema, SnapshotStore } = require("../database/snapshot-store");
const { buildTrends, velocityMap, computeVelocity30 } = require("../routes/lib/trends-builder");
const { formatTrendsSection } = require("../modules/digest-sections");

const TODAY = "2026-10-06";
const day = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const iso = (n) => `${day(n)}T08:00:00.000Z`;

const THEMES = [
  { id: "agentic-ai", label: "Agentic AI", keywords: ["agent"], topics: [], projects: ["a", "b"] },
  { id: "evals", label: "Evals", keywords: ["eval"], topics: [], projects: [] },
];

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE items (id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
    description TEXT, author TEXT, stars INTEGER DEFAULT 0, score REAL DEFAULT 0, published_at TEXT,
    fetched_at TEXT NOT NULL, metadata TEXT, first_seen_at TEXT)`);
  applySnapshotSchema(db);
  const ins = db.prepare(
    "INSERT INTO items (id, source, title, url, description, stars, metadata, fetched_at, first_seen_at) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  const snaps = new SnapshotStore(db);
  return {
    db,
    item({ source = "gh-trending", slug, stars = 1000, desc = "", meta = {}, fetched = 0, firstSeen = 0 }) {
      ins.run(`${source}-${slug}`, source, slug, `https://github.com/${slug}`, desc, stars, JSON.stringify(meta), iso(fetched), iso(firstSeen));
    },
    snap(slug, offset, stars) {
      snaps.record({ repo: slug, day: day(offset), stars, origin: "api" });
    },
  };
}

const weekly = (gain, themes = ["agentic-ai"]) => ({ trends: [{ period: "weekly", lang: "all", rank: 1, gain }], themes });
const run = (db, opts = {}) => buildTrends(db, { today: TODAY, themes: THEMES, ledgerRows: [], ...opts });
const keysOf = (rows) => rows.map((r) => r.key);

// ── ranking ───────────────────────────────────────────────────────────────────

test("rows are ranked by velocity (relative surge), not by raw gain", () => {
  const f = freshDb();
  // big/gainer gains the most stars but on a large base; small/surger gains less but doubles.
  for (const [slug, base, now] of [["big/gainer", 50000, 52000], ["small/surger", 1000, 2000], ["mid/one", 5000, 5800]]) {
    f.item({ slug, stars: now, meta: { themes: ["agentic-ai"] } });
    f.snap(slug, -7, base);
    f.snap(slug, 0, now);
  }
  const t = run(f.db);
  assert.deepEqual(keysOf(t.rows), ["small/surger", "mid/one", "big/gainer"]);
  assert.deepEqual(t.rows.map((r) => r.rank), [1, 2, 3]);
  assert.equal(t.rows[0].origin, "snapshots");
  assert.equal(t.rows[2].gain, 2000, "raw gain stays visible even when it ranks last");
  assert.equal(t.rows[0].sparkline.length, 2);
});

test("the trending page's own weekly gain stands in while history is short, and says so", () => {
  const f = freshDb();
  f.item({ slug: "nvidia/openshell", stars: 15058, meta: weekly(5915) });
  f.snap("nvidia/openshell", 0, 15058);
  const [r] = run(f.db).rows;
  assert.equal(r.key, "nvidia/openshell");
  assert.equal(r.gain, 5915);
  assert.equal(r.origin, "trending-page");
  assert.ok(r.velocity > 0);
});

// ── insufficient history is a state, never 0 ─────────────────────────────────

test("insufficient_history stays a state: null gain and velocity, listed apart, never ranked as 0", () => {
  const f = freshDb();
  // Only a DAILY trending observation and one snapshot: no weekly figure exists.
  f.item({ slug: "daily/only", stars: 800, meta: { trends: [{ period: "daily", lang: "all", rank: 3, gain: 400 }], themes: ["agentic-ai"] } });
  f.snap("daily/only", 0, 800);
  // Control: a repo WITH a weekly figure in the same pool is ranked.
  f.item({ slug: "weekly/one", stars: 3000, meta: weekly(900) });
  const t = run(f.db);
  assert.deepEqual(keysOf(t.rows), ["weekly/one"]);
  const u = t.unranked.find((r) => r.key === "daily/only");
  assert.ok(u, "the row is still shown");
  assert.equal(u.origin, "insufficient_history");
  assert.equal(u.gain, null);
  assert.equal(u.velocity, null);
  assert.equal(u.gain1, 400, "the daily gain is still reported where it exists");
  assert.equal(t.population.unranked, 1);
});

test("a gain below the 150 floor is unranked, not ranked low", () => {
  const f = freshDb();
  f.item({ slug: "tiny/gain", stars: 300, meta: weekly(100) });
  const t = run(f.db);
  assert.equal(t.rows.length, 0);
  assert.equal(t.unranked[0].gain, 100);
});

// ── the ruled filter ─────────────────────────────────────────────────────────

test("repos the ledger ruled are hidden by default, shown with their chip on include_ruled", () => {
  const f = freshDb();
  f.item({ slug: "Owner/Ruled", stars: 2000, meta: weekly(900) });
  f.item({ slug: "owner/proposed", stars: 2000, meta: weekly(800) });
  f.item({ slug: "owner/fresh", stars: 2000, meta: weekly(700) });
  const ledgerRows = [
    { repo: "owner/ruled", status: "rejected", projects: ["a"], radar_projects: ["a"] },
    { repo: "Owner/Proposed", status: "proposed", projects: ["b"], radar_projects: ["b"] },
  ];
  const hidden = run(f.db, { ledgerRows });
  assert.deepEqual(keysOf(hidden.rows), ["owner/proposed", "owner/fresh"]);
  assert.equal(hidden.population.ruled_hidden, 1);
  assert.equal(hidden.rows[0].status.label, "on radar: b", "ledger matching is case-insensitive");
  assert.equal(hidden.rows[1].status.label, "new");

  const shown = run(f.db, { ledgerRows, includeRuled: true });
  const ruled = shown.rows.find((r) => r.key === "owner/ruled");
  assert.equal(ruled.status.kind, "ruled");
  assert.equal(ruled.status.label, "ruled: rejected");
  assert.equal(shown.population.ruled_hidden, 0);
});

// ── positive control 5: surged though known ──────────────────────────────────

test("POSITIVE CONTROL 5: a repo known > 7 days with a +1,000-star snapshot gap reaches 'surged though known'", () => {
  const f = freshDb();
  // Known to the hub for 20 days via an ordinary discovery source, not trending.
  f.item({ source: "github-discovery-tech", slug: "known/surger", stars: 5000, desc: "an agent runtime", firstSeen: -20, fetched: -1 });
  f.snap("known/surger", -7, 5000);
  f.snap("known/surger", 0, 6000);
  // Controls in the same pool: a NEW repo with the same gap, and a known repo with a small gain.
  f.item({ source: "github-discovery-tech", slug: "new/surger", stars: 5000, firstSeen: -3 });
  f.snap("new/surger", -7, 5000);
  f.snap("new/surger", 0, 6000);
  f.item({ source: "github-discovery-tech", slug: "known/quiet", stars: 5000, firstSeen: -20 });
  f.snap("known/quiet", -7, 5000);
  f.snap("known/quiet", 0, 5200);

  const t = run(f.db);
  assert.equal(t.population.sources["snapshots-only"], 3, "the pool reaches repos no trend source saw");
  assert.deepEqual(keysOf(t.surgedThoughKnown), ["known/surger"]);
  assert.equal(t.surgedThoughKnown[0].gain7, 1000);
  assert.equal(t.surgedThoughKnown[0].first_seen_days, 20);
  assert.deepEqual(t.surgedThoughKnown[0].themes, ["agentic-ai"], "themes are tagged from the description when no trend item carries them");

  const md = formatTrendsSection(t);
  const section = md.slice(md.indexOf("### 🚀 Surged this week though known"), md.indexOf("### 👀 Worth a WATCH?"));
  assert.match(section, /known\/surger.*\+1,000★ in 7d \(snapshots\)/);
  assert.doesNotMatch(section, /new\/surger|known\/quiet/);
});

// ── negative control 3: stale giants ─────────────────────────────────────────

test("NEGATIVE CONTROL 3: stale giants stay out of the top 20 velocity list", () => {
  const f = freshDb();
  for (let i = 0; i < 20; i++) {
    const slug = `small/s${i}`;
    f.item({ source: "github", slug, stars: 2500 + i * 10 });
    f.snap(slug, -7, 2000);
    f.snap(slug, 0, 2500 + i * 10);
  }
  f.item({ source: "github", slug: "openai/whisper", stars: 200300 });
  f.snap("openai/whisper", -7, 200000);
  f.snap("openai/whisper", 0, 200300);
  f.item({ source: "github", slug: "torvalds/linux", stars: 220100 });
  f.snap("torvalds/linux", -7, 220000);
  f.snap("torvalds/linux", 0, 220100);

  // These synthetic repos carry no theme, so the `other` view is asked for explicitly.
  const t = run(f.db, { includeOther: true });
  const top20 = keysOf(t.rows.slice(0, 20));
  assert.ok(!top20.includes("openai/whisper"));
  assert.ok(!top20.includes("torvalds/linux"));
  // Control: the instrument DOES see them - whisper is ranked (eligible) but last; linux is under the floor.
  assert.equal(t.rows[t.rows.length - 1].key, "openai/whisper");
  assert.ok(t.unranked.some((r) => r.key === "torvalds/linux"));
  assert.equal(t.surgedThoughKnown.length, 0, "300 on 200k is not a surge");
});

// ── the `other` theme is hidden by default, reachable on its own tab ─────────

test("repos matching no theme are hidden from the all view by default, counted, and shown on the other tab", () => {
  const f = freshDb();
  f.item({ slug: "ai/agent", meta: weekly(900, ["agentic-ai"]) });
  f.item({ slug: "gym/app", meta: weekly(950, ["other"]) });
  f.item({ slug: "both/x", meta: weekly(800, ["agentic-ai", "evals"]) });

  const def = run(f.db);
  assert.deepEqual(keysOf(def.rows), ["ai/agent", "both/x"]);
  assert.equal(def.population.other_hidden, 1);
  assert.equal(def.themes.find((x) => x.id === "other").count, 1, "the Other tab still shows its count");

  const tab = run(f.db, { theme: "other" });
  assert.deepEqual(keysOf(tab.rows), ["gym/app"]);
  assert.equal(tab.population.other_hidden, 0);

  const all = run(f.db, { includeOther: true });
  assert.deepEqual(keysOf(all.rows), ["gym/app", "ai/agent", "both/x"]);
  assert.equal(all.population.other_hidden, 0);

  // Page and digest share the default: the digest says how many it left out.
  const md = formatTrendsSection(def);
  assert.doesNotMatch(md, /gym\/app/);
  assert.match(md, /1 more repos match no theme \("other"\)/);
});

// ── population, themes, candidates ───────────────────────────────────────────

test("population names a missing gh-theme source, and stops naming it once rows exist", () => {
  const f = freshDb();
  f.item({ slug: "a/one", meta: weekly(500) });
  f.snap("a/one", 0, 1000);
  let t = run(f.db);
  assert.deepEqual(t.population.missing_sources, ["gh-theme"]);
  assert.equal(t.population.sources["gh-trending"], 1);
  assert.equal(t.population.snapshots_today, 1);
  assert.equal(t.population.oldest_history_days, 0);
  assert.equal(t.population.pool, 1);

  f.item({ source: "gh-theme", slug: "b/two", meta: { themes: ["evals"] } });
  t = run(f.db);
  assert.deepEqual(t.population.missing_sources, []);
  assert.equal(t.population.sources["gh-theme"], 1);
});

test("items older than the 14-day window leave the pool", () => {
  const f = freshDb();
  f.item({ slug: "stale/trend", meta: weekly(900), fetched: -15 });
  f.item({ slug: "fresh/trend", meta: weekly(900), fetched: -2 });
  assert.deepEqual(keysOf(run(f.db).rows), ["fresh/trend"]);
});

test("theme tabs count over the visible pool; a theme filter narrows rows but not the counts", () => {
  const f = freshDb();
  f.item({ slug: "a/agent", meta: weekly(900, ["agentic-ai"]) });
  f.item({ slug: "b/eval", meta: weekly(800, ["evals"]) });
  f.item({ slug: "c/both", meta: weekly(700, ["agentic-ai", "evals"]) });
  const t = run(f.db, { theme: "evals" });
  assert.deepEqual(keysOf(t.rows), ["b/eval", "c/both"]);
  const count = Object.fromEntries(t.themes.map((x) => [x.id, x.count]));
  assert.equal(count["agentic-ai"], 2);
  assert.equal(count.evals, 2);
  assert.equal(count.other, 0);
});

test("candidates: top velocity in a theme mapped to a project, never ruled or already on a radar", () => {
  const f = freshDb();
  f.item({ slug: "x/new", meta: weekly(900, ["agentic-ai"]) });
  f.item({ slug: "x/radar", meta: weekly(950, ["agentic-ai"]) });
  f.item({ slug: "x/eval", meta: weekly(990, ["evals"]) });
  const t = run(f.db, { ledgerRows: [{ repo: "x/radar", status: "proposed", projects: ["a"], radar_projects: ["a"] }] });
  assert.equal(t.candidates.length, 1, "evals maps to no project, so it offers none");
  assert.equal(t.candidates[0].theme, "agentic-ai");
  assert.deepEqual(t.candidates[0].projects, ["a", "b"]);
  assert.deepEqual(keysOf(t.candidates[0].repos), ["x/new"]);
});

test("min_gain drops rows below it, and insufficient-history rows with it", () => {
  const f = freshDb();
  f.item({ slug: "hi/gain", meta: weekly(900) });
  f.item({ slug: "lo/gain", meta: weekly(300) });
  f.item({ slug: "no/history", meta: { themes: ["agentic-ai"] } });
  const t = run(f.db, { minGain: 500 });
  assert.deepEqual(keysOf(t.rows), ["hi/gain"]);
  assert.equal(t.unranked.length, 0);
  assert.equal(t.population.below_min_gain, 2);
});

test("period 30 reads a base 30 days back, else the trending page's monthly gain", () => {
  const v = computeVelocity30([{ day: day(-30), stars: 1000 }, { day: day(0), stars: 3000 }], { today: TODAY });
  assert.equal(v.origin, "snapshots");
  assert.equal(v.gain7, 2000);
  const m = computeVelocity30([{ day: day(0), stars: 3000 }], { today: TODAY, monthly: 1200 });
  assert.equal(m.origin, "trending-page");
  assert.equal(m.gain7, 1200);
  const none = computeVelocity30([{ day: day(-7), stars: 1000 }, { day: day(0), stars: 3000 }], { today: TODAY });
  assert.equal(none.origin, "insufficient_history");
  assert.equal(none.gain7, null);
});

test("velocityMap gives the digest the same velocity for any repo list", () => {
  const f = freshDb();
  f.snap("r/one", -7, 1000);
  f.snap("r/one", 0, 2500);
  f.item({ slug: "r/two", stars: 900, meta: weekly(400) });
  const m = velocityMap(f.db, ["R/One", "r/two", "r/none", "not a slug"], { today: TODAY });
  assert.equal(m.get("r/one").gain7, 1500);
  assert.equal(m.get("r/two").origin, "trending-page");
  assert.equal(m.get("r/none").origin, "insufficient_history");
  assert.equal(m.size, 3);
});

// ── the route ────────────────────────────────────────────────────────────────

test("parseQuery refuses a bad parameter by name instead of defaulting it", () => {
  const { parseQuery } = require("../routes/trends");
  assert.match(parseQuery({ period: "14" }, []).error, /period/);
  assert.match(parseQuery({ min_gain: "-1" }, []).error, /min_gain/);
  assert.match(parseQuery({ theme: "nope" }, ["evals"]).error, /unknown theme/);
  assert.deepEqual(parseQuery({ period: "30", min_gain: "200", theme: "evals", include_ruled: "1" }, ["evals"]).opts, {
    period: 30, minGain: 200, theme: "evals", includeRuled: true, includeOther: false,
  });
  assert.equal(parseQuery({ include_other: "1" }, []).opts.includeOther, true);
  assert.deepEqual(parseQuery({ theme: "other" }, []).opts.theme, "other");
});

test("GET /api/trends serves the builder's shape with its population, and 400s a bad period", async () => {
  const app = express();
  app.use("/api/trends", require("../routes/trends"));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = server.address().port;
    const get = (path) =>
      new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        }).on("error", reject);
      });
    const ok = await get("/api/trends?period=7");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.period, 7);
    assert.ok(ok.body.population && typeof ok.body.population.pool === "number", "population is the denominator, always present");
    assert.ok(Array.isArray(ok.body.rows) && Array.isArray(ok.body.themes));
    const bad = await get("/api/trends?period=14");
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /period/);
  } finally {
    server.close();
  }
});

// ── /api/health counts `partial` (lives here only because this lane's file
//    boundary allowed no new test file; a tests/health.test.js would be its home) ─

test("health: a partial source makes the hub degraded and is listed apart from failures", () => {
  // server.js maps `degraded` to its "degraded"|"healthy" literal; this pins the input to that line.
  assert.match(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8"), /status: src\.degraded \? "degraded" : "healthy"/);
  const { summarizeSourceStatus } = require("../database/db");
  const rows = [
    { id: "a", last_status: "success", last_run_at: "2026-10-06T06:30:00Z" },
    { id: "b", last_status: "partial", last_error: "12/45 queries ran", last_run_at: "2026-10-06T06:31:00Z" },
    { id: "c", last_status: "timeout", last_run_at: "2026-10-06T06:29:00Z" },
  ];
  const s = summarizeSourceStatus(rows);
  assert.equal(s.degraded, true);
  assert.equal(s.sources_total, 3);
  assert.equal(s.sources_failed_last_run, 1);
  assert.equal(s.sources_partial_last_run, 1);
  assert.deepEqual(s.failed_sources.map((r) => r.id), ["c"]);
  assert.deepEqual(s.partial_sources.map((r) => r.id), ["b"]);
  assert.equal(s.last_fetch_at, "2026-10-06T06:31:00Z");
  // partial ALONE is enough to degrade - the case the old SQL let read as healthy.
  assert.equal(summarizeSourceStatus([rows[0], rows[1]]).degraded, true);
  // CONTROL: all success is healthy, so the verdict is not stuck on degraded.
  const ok = summarizeSourceStatus([rows[0]]);
  assert.equal(ok.degraded, false);
  assert.equal(ok.sources_partial_last_run, 0);
  assert.equal(summarizeSourceStatus([]).last_fetch_at, null);
});
