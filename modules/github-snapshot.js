/**
 * Daily star snapshot - source `gh-snapshot`.
 *
 * Once a day, GET /repos/{owner}/{repo} (CORE quota, 5000/h - never the
 * 30/min search bucket) for a bounded pool, and write one `api` row per repo
 * into star_snapshots. That series is what turns "total stars" into "gained
 * this week" (routes/lib/velocity.js).
 *
 * Pool, in priority order, deduped case-insensitively, capped (default 800):
 *   1. gh-trending repos seen in the last 14 days   (the lane's own finds)
 *   2. tracked_repos                                 (what we adopted/watch/depend on)
 *   3. radar rows (not rejected, not HF model/dataset ids)
 *   4. top 300 existing github* items by score
 *
 * Excluded BEFORE the pool is built, and counted as `skipped`, never as errors:
 *   - non-GitHub ids: radar rows declaring `kind: model|dataset` are Hugging
 *     Face ids spelled exactly like owner/repo (the tracker checks them via
 *     HF); asking GitHub for them is a guaranteed 404.
 *   - repos the tracker already found gone (tracked_repos.http_status 404),
 *     on EVERY leg - the tracked leg always dropped them, the radar leg did not.
 *
 * Returns NO feed items (like tracked-repos): findings are rows, not news.
 * Honesty: every repo is counted as written / error / skipped. Everything
 * failing THROWS; so does stopping early on a low core quota - rows already
 * written stay (they are real), but the source must not read `success` when
 * part of the pool never ran.
 */

const BaseModule = require("./base-module");
const { fetchResponse } = require("./http");
const { readRadarRows } = require("./tracked-repos");
const { utcDay, slugKey, isSlug } = require("../database/snapshot-store");

const API = "https://api.github.com";
const DEFAULTS = { concurrency: 5, pool_cap: 800, top_items: 300, trending_days: 14, min_core_remaining: 200 };

/** Pure: the four legs -> [{repo, origin}] in priority order, deduped, capped. */
function buildSnapshotPool({ trending = [], tracked = [], radar = [], topItems = [] }, cap = DEFAULTS.pool_cap) {
  const seen = new Set();
  const pool = [];
  const legs = [
    ["trending", trending],
    ["tracked", tracked],
    ["radar", radar],
    ["top-items", topItems],
  ];
  for (const [leg, list] of legs) {
    for (const raw of list) {
      const key = slugKey(raw);
      if (!isSlug(key) || seen.has(key)) continue;
      if (pool.length >= cap) return pool;
      seen.add(key);
      pool.push({ repo: key, leg });
    }
  }
  return pool;
}

/**
 * Pure: drop excluded ids from every leg. `exclude` maps lowercase id -> reason.
 * Returns {legs, skipped: [{repo, reason}]} - one entry per distinct id dropped.
 */
function excludeFromLegs(legs, exclude) {
  const out = {};
  const skipped = new Map();
  for (const [leg, list] of Object.entries(legs || {})) {
    out[leg] = (list || []).filter((raw) => {
      const key = slugKey(raw);
      const reason = exclude.get(key);
      if (!reason) return true;
      if (!skipped.has(key)) skipped.set(key, reason);
      return false;
    });
  }
  return { legs: out, skipped: [...skipped].map(([repo, reason]) => ({ repo, reason })) };
}

/** Pure: radar rows + tracked rows -> Map(lowercase id -> reason) of ids GitHub cannot answer for. */
function nonGithubExclusions(radarRows = [], trackedRows = []) {
  const m = new Map();
  for (const r of radarRows) {
    if (r && r.repo && (r.kind === "model" || r.kind === "dataset")) m.set(slugKey(r.repo), `huggingface ${r.kind}`);
  }
  for (const r of trackedRows) {
    if (r && r.repo && r.http_status === 404 && !m.has(slugKey(r.repo))) m.set(slugKey(r.repo), "tracker: 404 on GitHub");
  }
  return m;
}

/** GET /repos with redirect:"manual" so a rename is followed ONCE and recorded under its new name. */
function ghRepoClient({ token, timeoutMs = 15000 } = {}) {
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const remainingOf = (res) => {
    const n = parseInt(res.headers.get("x-ratelimit-remaining"), 10);
    return Number.isFinite(n) ? n : null;
  };
  return async (slug) => {
    let res;
    try {
      res = await fetchResponse(`${API}/repos/${slug}`, { headers, timeoutMs, redirect: "manual" });
    } catch (err) {
      if (err && err.status === 301 && err.location) {
        const moved = await fetchResponse(err.location, { headers, timeoutMs });
        return { status: 200, renamed: true, body: await moved.json(), remaining: remainingOf(moved) };
      }
      if (err && Number.isFinite(err.status)) return { status: err.status, body: null, remaining: null };
      throw err;
    }
    return { status: res.status, body: await res.json().catch(() => null), remaining: remainingOf(res) };
  };
}

/** The run, injectable end to end. */
async function runSnapshot({ pool, getRepo, store, day, concurrency = DEFAULTS.concurrency, minRemaining = DEFAULTS.min_core_remaining }) {
  let written = 0;
  let renamed = 0;
  let stopped = false;
  const errors = [];
  const skipped = [];
  const queue = [...pool];

  const one = async ({ repo }) => {
    if (stopped) return skipped.push(repo);
    let r;
    try {
      r = await getRepo(repo);
    } catch (err) {
      return errors.push(`${repo}: ${err.message}`);
    }
    if (r.remaining !== null && r.remaining !== undefined && r.remaining < minRemaining) stopped = true;
    const b = r.body;
    if (r.status !== 200 || !b || !Number.isFinite(b.stargazers_count) || !b.full_name) {
      return errors.push(`${repo}: HTTP ${r.status}${r.status === 200 ? " (no stargazers_count)" : ""}`);
    }
    if (r.renamed) renamed += 1;
    store.record({
      repo: b.full_name,
      day,
      stars: b.stargazers_count,
      forks: b.forks_count,
      open_issues: b.open_issues_count,
      pushed_at: b.pushed_at || null,
      origin: "api",
    });
    written += 1;
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await one(next);
  });
  await Promise.all(workers);
  return { pool: pool.length, written, errors, skipped, renamed, stopped };
}

class GitHubSnapshotModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
    this.cfg = { ...DEFAULTS, ...this.config };
  }

  /**
   * Assemble the four legs from the live DB + radar (unless tests injected
   * them), minus the non-GitHub / known-gone ids. Returns {pool, skipped}.
   */
  assemble(db, now) {
    let legs = this.deps.legs;
    let exclude = this.deps.exclude || new Map();
    if (!legs) {
      const since = new Date(now.getTime() - this.cfg.trending_days * 86400000).toISOString();
      const radarRows = readRadarRows();
      const trackedRows = db.tracked.all();
      exclude = nonGithubExclusions(radarRows, trackedRows);
      legs = {
        trending: db.snapshots.trendingSince(since),
        tracked: trackedRows.map((r) => r.repo),
        radar: radarRows.filter((r) => r.status !== "rejected").map((r) => r.repo),
        topItems: db.snapshots.topGithubItems(this.cfg.top_items),
      };
    }
    const cleaned = excludeFromLegs(legs, exclude);
    const pool = buildSnapshotPool(cleaned.legs, this.cfg.pool_cap);
    if (!this.deps.legs) {
      const byLeg = pool.reduce((m, e) => ((m[e.leg] = (m[e.leg] || 0) + 1), m), {});
      console.log(`[snapshot] pool legs: ${Object.entries(byLeg).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    }
    return { pool, skipped: cleaned.skipped };
  }

  async fetch() {
    const token = this.deps.token !== undefined ? this.deps.token : process.env.GITHUB_TOKEN;
    if (!token && !this.deps.getRepo) throw new Error("GITHUB_TOKEN is required for gh-snapshot (core quota is 60/h without it)");
    const db = this.deps.db || require("../database/db");
    const now = (this.deps.now || (() => new Date()))();
    const { pool, skipped: excluded } = this.assemble(db, now);
    if (!pool.length) throw new Error("gh-snapshot: pool is empty - every leg returned nothing, refusing to report success");

    const r = await runSnapshot({
      pool,
      getRepo: this.deps.getRepo || ghRepoClient({ token, timeoutMs: this.cfg.timeout_ms || 15000 }),
      store: this.deps.store || db.snapshots,
      day: utcDay(now),
      concurrency: this.cfg.concurrency,
      minRemaining: this.cfg.min_core_remaining,
    });

    const line = `[snapshot] pool ${r.pool} · written ${r.written} · errors ${r.errors.length} · skipped ${r.skipped.length + excluded.length} (quota ${r.skipped.length}, non-github/gone ${excluded.length}) · renamed ${r.renamed}`;
    console.log(line);
    if (excluded.length) {
      console.log(`[snapshot] skipped before the run: ${excluded.slice(0, 5).map((e) => `${e.repo} (${e.reason})`).join("; ")}${excluded.length > 5 ? ` +${excluded.length - 5} more` : ""}`);
    }
    if (r.errors.length) console.warn(`[snapshot] first errors: ${r.errors.slice(0, 5).join("; ")}`);
    if (r.written === 0) throw new Error(`gh-snapshot: nothing written - ${line.slice(11)}; first error: ${r.errors[0] || "none"}`);
    if (r.stopped) {
      throw new Error(`gh-snapshot: stopped early, core quota below ${this.cfg.min_core_remaining} - ${line.slice(11)}`);
    }
    return [];
  }
}

module.exports = GitHubSnapshotModule;
module.exports.buildSnapshotPool = buildSnapshotPool;
module.exports.runSnapshot = runSnapshot;
module.exports.ghRepoClient = ghRepoClient;
module.exports.excludeFromLegs = excludeFromLegs;
module.exports.nonGithubExclusions = nonGithubExclusions;
