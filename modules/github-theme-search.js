/**
 * GitHub theme search - source `gh-theme` (type `github-theme`) - plus the ONE
 * process-wide GitHub search bucket every search caller shares.
 *
 * WHY THE BUCKET LIVES HERE: GitHub allows 30 searches/min per token, and the
 * all-sources fetch (routes/fetch.js) runs every source in parallel. `github`,
 * `github-discovery-tech`, `github-discovery-rising` and `gh-theme` each used
 * to pace themselves alone, so together they drained the minute and
 * tech-stack aborted in 22 of 26 daily runs. Now all four acquire a slot from
 * `searchBucket` below, so the PROCESS stays under the limit however many
 * sources run at once.
 *
 * The bucket is a rolling-window limiter: at most `perMinute` (25) acquisitions
 * in any 60s window, handed out FIFO. It also reads each response's
 * X-RateLimit-Remaining / X-RateLimit-Reset (someone else may share the token)
 * and, when the window is spent, SLEEPS until the reset instead of aborting.
 * A caller passes its deadline: if the next slot cannot start before it, the
 * caller gets `deferred` back and reports the run as partial - it never
 * blows its budget and loses everything to a timeout.
 *
 * The source: for each theme in config/themes.json (except `other`), each of
 * its base queries in two windows:
 *   new     `created:>{today-30d} stars:>30`
 *   active  `pushed:>{today-7d} stars:>300`
 * sort=stars, per_page 30. Items `gh-theme-<owner>-<name>` carry
 * metadata.themes (tagger ∪ the theme that found it) and metadata.found_by
 * [{theme, query}]; one star_snapshots row per repo (origin `search`; the
 * store keeps `api` rows above it). executed < planned -> PartialFetchError
 * (status `partial`, items kept); executed 0 -> throw.
 */

const BaseModule = require("./base-module");
const { fetchResponse } = require("./http");
const { loadThemes, tagRepo, OTHER } = require("./themes");
const { utcDay } = require("../database/snapshot-store");
const { PartialFetchError } = require("./fetch-runner");

const API = "https://api.github.com";
const MIN = 60000;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SearchBucket {
  /**
   * perMinute: max acquisitions in any `windowMs`; reserve: when a response says
   * remaining <= reserve, hold every caller until its X-RateLimit-Reset.
   * now/sleep are injectable so tests drive a fake clock.
   */
  constructor({ perMinute = 25, windowMs = MIN, reserve = 1, penaltyMs = MIN, now = Date.now, sleep = defaultSleep } = {}) {
    Object.assign(this, { perMinute, windowMs, reserve, penaltyMs, now, sleep });
    this.stamps = [];
    this.blockedUntil = 0;
    this.tail = Promise.resolve();
    this.stats = { granted: 0, deferred: 0, waitedMs: 0, headerWaits: 0 };
  }

  /** When the next slot could start, given the window and any header block. */
  readyAt() {
    const t = this.now();
    while (this.stamps.length && this.stamps[0] <= t - this.windowMs) this.stamps.shift();
    const windowReady = this.stamps.length < this.perMinute ? t : this.stamps[this.stamps.length - this.perMinute] + this.windowMs;
    return Math.max(t, windowReady, this.blockedUntil);
  }

  /** FIFO. Resolves {ok:true, waitedMs} once a slot is taken, or {ok:false, readyAt} when it cannot start before `deadline`. */
  acquire({ deadline = Infinity } = {}) {
    const run = this.tail.then(async () => {
      let waited = 0;
      // Loop: a header observed by another caller while we slept can push readyAt later.
      for (;;) {
        const at = this.readyAt();
        if (at > deadline) {
          this.stats.deferred += 1;
          return { ok: false, readyAt: at, waitedMs: waited };
        }
        const wait = at - this.now();
        if (wait <= 0) break;
        await this.sleep(wait);
        waited += wait;
      }
      this.stamps.push(this.now());
      this.stats.granted += 1;
      this.stats.waitedMs += waited;
      return { ok: true, waitedMs: waited };
    });
    this.tail = run.catch(() => {});
    return run;
  }

  /** Read GitHub's own view of the search window from a response's headers. */
  observe(headers) {
    if (!headers || typeof headers.get !== "function") return;
    const resource = headers.get("x-ratelimit-resource");
    if (resource && resource !== "search") return;
    const remaining = parseInt(headers.get("x-ratelimit-remaining"), 10);
    const reset = parseInt(headers.get("x-ratelimit-reset"), 10);
    if (!Number.isFinite(remaining) || !Number.isFinite(reset)) return;
    if (remaining <= this.reserve) {
      const until = reset * 1000 + 1000;
      if (until > this.blockedUntil) {
        this.blockedUntil = until;
        this.stats.headerWaits += 1;
      }
    }
  }

  /** A 403/429 came back with no readable headers (http.js throws before we see them): hold one window. */
  penalize(ms = this.penaltyMs) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
  }
}

/** The process-wide bucket. Every GitHub search caller must go through it. */
const searchBucket = new SearchBucket();

const isRateLimit = (err) =>
  !!err && (err.status === 429 || (err.status === 403 && /rate limit|abuse|secondary/i.test(String(err.message))));

function ghHeaders(token = process.env.GITHUB_TOKEN) {
  const h = { Accept: "application/vnd.github+json" };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

/**
 * One repository search through the bucket.
 *   -> {status:"ok", data}        executed (both carry waitedMs: time spent queued)
 *   -> {status:"deferred", ...}   not run: no slot before `deadline`
 *   throws                        the request ran and failed (HttpError, timeout)
 * A rate-limit refusal (403/429) holds the bucket one window and retries once.
 */
async function searchRepos(query, { perPage = 30, deadline = Infinity, bucket = searchBucket, headers = ghHeaders(), timeoutMs = 30000, fetchRes = fetchResponse } = {}) {
  const url = `${API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;
  let waitedMs = 0;
  for (let attempt = 0; ; attempt++) {
    const slot = await bucket.acquire({ deadline });
    waitedMs += slot.waitedMs || 0;
    if (!slot.ok) return { status: "deferred", readyAt: slot.readyAt, waitedMs };
    try {
      const res = await fetchRes(url, { headers, timeoutMs });
      bucket.observe(res.headers);
      return { status: "ok", data: await res.json(), waitedMs };
    } catch (err) {
      if (isRateLimit(err) && attempt === 0) {
        bucket.penalize();
        continue;
      }
      throw err;
    }
  }
}

/**
 * The latest moment a caller may START a search and still finish inside its
 * budget: start + budget - margin. Margin covers the request itself plus the
 * caller's own post-processing.
 */
function searchDeadline({ budgetMs, startedAt, marginMs }) {
  return startedAt + budgetMs - marginMs;
}

/**
 * Pure honesty gate shared by every search source. Never returns when
 * executed < planned - that is `partial` (items kept) or, with nothing
 * executed, an error.
 */
function settleSearchRun({ label, items, executed, planned, notes = [], report }) {
  const tally = `executed ${executed} / planned ${planned}`;
  const why = notes.length ? ` - ${notes.slice(0, 3).join("; ")}` : "";
  if (planned > 0 && executed === 0) throw new Error(`${label}: ${tally}, nothing ran${why}`);
  if (executed < planned) throw new PartialFetchError(`${label}: ${tally}${why}`, items, report);
  return items;
}

const dayMinus = (now, days) => utcDay(new Date(now.getTime() - days * 86400000));

/** Pure: themes + config + now -> the planned search list. */
function buildThemeJobs(themes, cfg = {}, now = new Date()) {
  const wins = {
    new: `created:>${dayMinus(now, cfg.new_days ?? 30)} stars:>${cfg.new_min_stars ?? 30}`,
    active: `pushed:>${dayMinus(now, cfg.active_days ?? 7)} stars:>${cfg.active_min_stars ?? 300}`,
  };
  const windowKeys = cfg.windows || ["new", "active"];
  const unknown = windowKeys.filter((k) => !wins[k]);
  if (unknown.length) throw new Error(`gh-theme: unknown window(s) ${unknown.join(", ")}`);
  const jobs = [];
  for (const t of themes || []) {
    if (!t || t.id === OTHER) continue;
    for (const query of t.queries || []) {
      for (const w of windowKeys) jobs.push({ theme: t.id, query, window: w, q: `${query} ${wins[w]}` });
    }
  }
  return jobs;
}

/** Pure: a repo counts toward positive control 7 when stars >= 300 and pushed within 30 days. */
function isStrong(repo, now, { minStars = 300, days = 30 } = {}) {
  const pushed = Date.parse(repo.pushed_at || "");
  return (repo.stargazers_count || 0) >= minStars && Number.isFinite(pushed) && now.getTime() - pushed <= days * 86400000;
}

/** Pure: [{job, items}] -> Map(key -> {repo, found_by[], foundThemes Set}). */
function mergeHits(results) {
  const byRepo = new Map();
  for (const { job, items } of results) {
    for (const repo of items || []) {
      if (!repo || !repo.full_name) continue;
      const key = repo.full_name.toLowerCase();
      if (!byRepo.has(key)) byRepo.set(key, { repo, found_by: [], foundThemes: new Set(), windows: new Set() });
      const e = byRepo.get(key);
      if (!e.found_by.some((f) => f.theme === job.theme && f.query === job.query)) e.found_by.push({ theme: job.theme, query: job.query });
      e.foundThemes.add(job.theme);
      e.windows.add(job.window);
    }
  }
  return byRepo;
}

class GitHubThemeSearchModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
  }

  async fetch() {
    const token = this.deps.token !== undefined ? this.deps.token : process.env.GITHUB_TOKEN;
    if (!token && !this.deps.fetchRes) throw new Error("GITHUB_TOKEN is required for gh-theme (search is 10/min without it)");
    const clock = this.deps.clock || Date.now;
    const now = new Date(clock());
    const themes = this.deps.themes || loadThemes();
    const jobs = buildThemeJobs(themes, this.config, now);
    if (!jobs.length) throw new Error("gh-theme: no theme queries configured - refusing to report success");

    const timeoutMs = this.config.timeout_ms || 20000;
    const deadline = searchDeadline({
      budgetMs: this.config.budget_ms || 600000,
      startedAt: clock(),
      marginMs: Math.max(timeoutMs + 10000, (this.config.budget_ms || 600000) * 0.05),
    });
    const opts = {
      perPage: this.config.per_page || 30,
      deadline,
      bucket: this.deps.bucket || searchBucket,
      headers: ghHeaders(token),
      timeoutMs,
      ...(this.deps.fetchRes ? { fetchRes: this.deps.fetchRes } : {}),
    };

    const results = [];
    const notes = [];
    let waitedMs = 0;
    const perTheme = {};
    for (const t of themes) if (t.id !== OTHER) perTheme[t.id] = { planned: 0, executed: 0, hits: 0, strong: 0 };
    for (const j of jobs) perTheme[j.theme].planned += 1;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      let r;
      try {
        r = await searchRepos(job.q, opts);
        waitedMs += r.waitedMs || 0;
      } catch (err) {
        notes.push(`${job.theme} "${job.q}": ${err.message}`.slice(0, 200));
        continue;
      }
      if (r.status === "deferred") {
        notes.unshift(`budget: ${jobs.length - i} searches left, next slot only at ${new Date(r.readyAt).toISOString()}`);
        break;
      }
      perTheme[job.theme].executed += 1;
      results.push({ job, items: (r.data && r.data.items) || [] });
    }
    const executed = results.length;

    const merged = mergeHits(results);
    const day = utcDay(now);
    const items = [];
    const snaps = [];
    for (const { repo, found_by, foundThemes, windows } of merged.values()) {
      const tagged = tagRepo({ name: repo.full_name, description: repo.description, topics: repo.topics || [] }).filter((t) => t !== OTHER);
      const themesOut = [...new Set([...tagged, ...foundThemes])];
      const strong = isStrong(repo, now);
      for (const t of foundThemes) {
        perTheme[t].hits += 1;
        if (strong) perTheme[t].strong += 1;
      }
      const [owner, name] = repo.full_name.split("/");
      items.push(
        this.normalize({
          id: `${owner}-${name}`,
          title: repo.full_name,
          url: repo.html_url || `https://github.com/${repo.full_name}`,
          description: repo.description || "",
          author: owner,
          stars: repo.stargazers_count,
          score: (repo.stargazers_count || 0) + 2 * (repo.forks_count || 0),
          published_at: repo.pushed_at,
          metadata: {
            language: repo.language,
            forks: repo.forks_count,
            repo_id: repo.id,
            topics: repo.topics || [],
            open_issues: repo.open_issues_count,
            created_at: repo.created_at,
            pushed_at: repo.pushed_at,
            fork: !!repo.fork,
            archived: !!repo.archived,
            windows: [...windows],
            themes: themesOut,
            found_by,
          },
        })
      );
      if (Number.isFinite(repo.stargazers_count)) {
        snaps.push({
          repo: repo.full_name,
          day,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          open_issues: repo.open_issues_count,
          pushed_at: repo.pushed_at || null,
          origin: "search",
        });
      }
    }

    let written = 0;
    if (snaps.length) {
      const store = this.deps.store || require("../database/db").snapshots;
      written = store.recordMany(snaps);
    }

    const hits = Object.entries(perTheme).map(([t, v]) => `${t} ${v.hits}/${v.strong}`).join(", ");
    console.log(
      `[theme-search] executed ${executed} / planned ${jobs.length} · repos ${items.length} · snapshots ${written} · waited for search slots ${Math.round(waitedMs / 1000)}s`
    );
    console.log(`[theme-search] per-theme hits/strong(>=300★, pushed 30d): ${hits}`);
    if (notes.length) console.warn(`[theme-search] not executed: ${notes.slice(0, 5).join("; ")}`);

    this.runReport = { executed, planned: jobs.length, repos: items.length, snapshots: written, waited_ms: waitedMs, per_theme: perTheme };
    return settleSearchRun({ label: "gh-theme", items, executed, planned: jobs.length, notes, report: this.runReport });
  }
}

module.exports = GitHubThemeSearchModule;
module.exports.SearchBucket = SearchBucket;
module.exports.searchBucket = searchBucket;
module.exports.searchRepos = searchRepos;
module.exports.searchDeadline = searchDeadline;
module.exports.settleSearchRun = settleSearchRun;
module.exports.buildThemeJobs = buildThemeJobs;
module.exports.mergeHits = mergeHits;
module.exports.isStrong = isStrong;
module.exports.ghHeaders = ghHeaders;
module.exports.isRateLimit = isRateLimit;
