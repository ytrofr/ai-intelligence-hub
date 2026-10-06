/**
 * Positive-control harness for the gh-trending scrape.
 *
 * Fixtures are REAL github.com/trending pages saved 2026-10-06 (gzipped):
 *   weekly/all, daily/all, monthly/typescript
 * The "rows removed" page used by the drift guard is DERIVED from the real
 * weekly page at test time (its <article> rows cut out), not hand-written.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const Database = require("better-sqlite3");

const Trending = require("../modules/github-trending");
const { parseTrendingPage, validatePage, mergeObservations, pageUrl, TrendingParseError } = Trending;
const { applySnapshotSchema, SnapshotStore } = require("../database/snapshot-store");

const FIX = path.join(__dirname, "fixtures", "github-trending");
const page = (period, lang) =>
  zlib.gunzipSync(fs.readFileSync(path.join(FIX, `trending-${period}-${lang}-2026-10-06.html.gz`))).toString("utf8");
const WEEKLY = page("weekly", "all");
const DAILY = page("daily", "all");
const MONTHLY_TS = page("monthly", "typescript");
const stripRows = (html) => html.replace(/<article class="Box-row">[\s\S]*?<\/article>/g, "");

function freshStore() {
  const db = new Database(":memory:");
  applySnapshotSchema(db);
  return new SnapshotStore(db);
}

/** A module wired to fixtures by URL; unknown URLs 404 like the real site would. */
function moduleWith(pages, config = {}) {
  const store = freshStore();
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    if (!(url in pages)) {
      const e = new Error(`HTTP 404 for ${url}`);
      e.status = 404;
      throw e;
    }
    const v = pages[url];
    if (v instanceof Error) throw v;
    return typeof v === "function" ? v() : v;
  };
  const mod = new Trending({
    id: "gh-trending",
    type: "github-trending",
    url: "https://github.com/trending",
    config: { periods: ["weekly", "daily"], languages: ["all"], page_delay_ms: 0, retry_delay_ms: 0, ...config },
  });
  mod.deps = { fetchText, store, sleep: async () => {}, now: () => new Date("2026-10-06T12:00:00Z") };
  return { mod, store, calls };
}

const URLS = {
  weekly: pageUrl("https://github.com/trending", "weekly", "all"),
  daily: pageUrl("https://github.com/trending", "daily", "all"),
};

test("page URLs: 'all' has no language segment, a language does", () => {
  assert.equal(URLS.weekly, "https://github.com/trending?since=weekly");
  assert.equal(pageUrl("https://github.com/trending", "monthly", "typescript"), "https://github.com/trending/typescript?since=monthly");
});

test("parser reads owner/repo, total stars, period gain and language from every real fixture", () => {
  for (const [html, period, lang, word] of [
    [WEEKLY, "weekly", "all", "this week"],
    [DAILY, "daily", "all", "today"],
    [MONTHLY_TS, "monthly", "typescript", "this month"],
  ]) {
    const rows = validatePage(parseTrendingPage(html), { period, lang });
    assert.ok(rows.length >= 10, `${period}/${lang} parsed ${rows.length}`);
    for (const r of rows) {
      assert.match(r.slug, /^[^/\s]+\/[^/\s]+$/, `slug shape: ${r.slug}`);
      assert.ok(Number.isInteger(r.stars) && r.stars > 0, `${r.slug} total stars`);
      assert.ok(Number.isInteger(r.gain) && r.gain > 0, `${r.slug} gain`);
      assert.equal(r.gainWord, word);
      assert.ok(r.gain <= r.stars, `${r.slug}: gain ${r.gain} cannot exceed total ${r.stars}`);
    }
    // ranks are page order 1..N
    assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
  }
  // monthly/typescript is a TypeScript page: every row that names a language says so
  const ts = parseTrendingPage(MONTHLY_TS).filter((r) => r.language);
  assert.ok(ts.length >= 10 && ts.every((r) => r.language === "TypeScript"));
});

test("POSITIVE CONTROL: the 2026-10-06 weekly top surgers are present with their gain", () => {
  const rows = parseTrendingPage(WEEKLY);
  const by = new Map(rows.map((r) => [r.slug, r]));
  for (const [slug, gain] of [
    ["NVIDIA/OpenShell", 5915],
    ["mvschwarz/openrig", 3776],
    ["VectifyAI/PageIndex", 2860],
  ]) {
    assert.ok(by.has(slug), `${slug} missing from the weekly page`);
    assert.equal(by.get(slug).gain, gain, `${slug} weekly gain`);
    assert.ok(by.get(slug).stars > gain);
  }
  const openrig = by.get("mvschwarz/openrig");
  assert.equal(openrig.language, "TypeScript");
  assert.equal(openrig.stars, 5358);
  assert.equal(openrig.repo_id, 1198124295);
  assert.match(openrig.description, /network of agents/);
});

test("PARSER-DRIFT CONTROL: a real page with its rows removed is an ERROR, never success-with-0", () => {
  const empty = stripRows(WEEKLY);
  assert.ok(empty.length > 100000, "the stripped page is still a full GitHub page");
  assert.deepEqual(parseTrendingPage(empty), []);
  assert.throws(() => validatePage(parseTrendingPage(empty), { period: "weekly", lang: "all" }), TrendingParseError);
  assert.throws(() => validatePage(parseTrendingPage(stripRows(DAILY)), { period: "daily", lang: "python" }), /0 rows/);
});

test("drift guard: weekly/all under 8 rows errors; the same row count on another page does not", () => {
  const seven = parseTrendingPage(WEEKLY).slice(0, 7);
  assert.throws(() => validatePage(seven, { period: "weekly", lang: "all" }), /expected >= 8/);
  // control: the threshold is specific to weekly/all
  assert.doesNotThrow(() => validatePage(seven.map((r) => ({ ...r })), { period: "weekly", lang: "rust" }));
});

test("drift guard: a gain phrased for another period, or no gain at all, errors", () => {
  const rows = parseTrendingPage(DAILY);
  assert.throws(() => validatePage(rows, { period: "weekly", lang: "go" }), /phrased "today"/);
  assert.throws(() => validatePage(rows.map((r) => ({ ...r, gain: null, gainWord: null })), { period: "daily", lang: "go" }), /no row carries/);
  assert.throws(() => validatePage(rows.map((r, i) => (i ? r : { ...r, stars: null })), { period: "daily", lang: "go" }), /without total stars/);
});

test("merge: one entry per repo; weekly is the primary observation when a repo is on several pages", () => {
  const pages = [
    { period: "daily", lang: "all", rows: parseTrendingPage(DAILY) },
    { period: "weekly", lang: "all", rows: parseTrendingPage(WEEKLY) },
  ];
  const merged = mergeObservations(pages);
  const both = [...merged.values()].filter((e) => e.observations.length > 1);
  assert.ok(both.length >= 1, "today's daily and weekly pages share at least one repo");
  for (const e of both) assert.equal(e.primary.period, "weekly");
  const distinct = new Set(pages.flatMap((p) => p.rows.map((r) => r.slug.toLowerCase())));
  assert.equal(merged.size, distinct.size);
});

test("module: items carry gh-trending ids, trend + themes metadata, and one snapshot per repo", async () => {
  const { mod, store } = moduleWith({ [URLS.weekly]: WEEKLY, [URLS.daily]: DAILY });
  const items = await mod.fetch();
  const by = new Map(items.map((i) => [i.title, i]));
  const os = by.get("NVIDIA/OpenShell");
  assert.ok(os, "control repo emitted as an item");
  assert.equal(os.id, "gh-trending-NVIDIA-OpenShell");
  assert.equal(os.source, "gh-trending");
  assert.equal(os.url, "https://github.com/NVIDIA/OpenShell");
  assert.deepEqual(os.metadata.trend, { period: "weekly", gain: 5915, lang: "all", rank: os.metadata.trend.rank });
  assert.ok(Array.isArray(os.metadata.themes) && os.metadata.themes.length >= 1);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, "one item per repo");

  const series = store.series("nvidia/openshell");
  assert.equal(series.length, 1);
  assert.equal(series[0].day, "2026-10-06");
  assert.equal(series[0].stars, os.stars);
  assert.equal(series[0].origin, "trending:weekly");
  const counts = Object.fromEntries(store.originCounts().map((r) => [r.origin, r.n]));
  assert.equal((counts["trending:weekly"] || 0) + (counts["trending:daily"] || 0), items.length);
});

test("module: ONE drifted page fails the whole run and writes NO snapshots", async () => {
  const { mod, store } = moduleWith({ [URLS.weekly]: stripRows(WEEKLY), [URLS.daily]: DAILY });
  await assert.rejects(mod.fetch(), /1\/2 pages failed.*weekly\/all: .*0 rows/);
  assert.deepEqual(store.originCounts(), []);
});

test("module: a transient 503 is retried once; a 404 is final", async () => {
  let n = 0;
  const flaky = () => {
    n += 1;
    if (n === 1) {
      const e = new Error("HTTP 503");
      e.status = 503;
      throw e;
    }
    return WEEKLY;
  };
  const ok = moduleWith({ [URLS.weekly]: flaky }, { periods: ["weekly"] });
  const items = await ok.mod.fetch();
  assert.equal(n, 2);
  assert.ok(items.length >= 8);

  const gone = moduleWith({}, { periods: ["weekly"] });
  await assert.rejects(gone.mod.fetch(), /HTTP 404/);
  assert.equal(gone.calls.length, 1, "a 404 is not retried");
});
