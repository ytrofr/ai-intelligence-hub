/**
 * GitHub Trending scrape - source `gh-trending`.
 *
 * github.com/trending?since={daily,weekly,monthly} for [all + 5 languages] =
 * 18 pages, one request each, ZERO search quota. Each row gives owner/repo,
 * total stars, forks, language, and the page's own "N stars this
 * week|today|this month" - the one gain figure available before our own
 * snapshot history is 7 days deep.
 *
 * This is unofficial HTML, so the parser is guarded rather than trusted:
 *   - any page parsing 0 rows                     -> THROW (parser drift)
 *   - the weekly all-language page under 8 rows   -> THROW
 *   - a page whose rows carry no gain at all      -> THROW
 *   - a gain phrased for another period           -> THROW
 * The failure shape this exists to prevent is "success with 0 items".
 *
 * Writes items (one per repo, id `gh-trending-<owner>-<name>`) and one
 * star_snapshots row per repo (origin `trending:<period>`). Nothing is written
 * unless every page passed.
 */

const BaseModule = require("./base-module");
const { fetchText } = require("./http");
const { tagRepo } = require("./themes");
const { utcDay } = require("../database/snapshot-store");

const PERIODS = ["daily", "weekly", "monthly"];
const LANGUAGES = ["all", "python", "typescript", "javascript", "go", "rust"];
const GAIN_WORD = { daily: "today", weekly: "this week", monthly: "this month" };
const MIN_ROWS_WEEKLY_ALL = 8;
// Preference when one repo trends on several pages: the weekly window is what
// the lane ranks on; daily is noisier, monthly staler.
const PERIOD_RANK = { weekly: 0, daily: 1, monthly: 2 };

class TrendingParseError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "TrendingParseError";
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}
const stripTags = (s) => decode(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const toInt = (s) => (s === undefined || s === null ? null : Number(String(s).replace(/,/g, "")));

/**
 * Pure: one page of HTML -> rows. Never throws on a weird row; it returns what
 * it could read and lets validatePage decide whether the page is usable.
 * Row: {owner, name, slug, description, language, stars, forks, gain, gainWord, rank, repo_id}
 */
function parseTrendingPage(html) {
  const rows = [];
  const articles = String(html || "").match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  articles.forEach((a, i) => {
    const h = a.match(/<h2[^>]*>[\s\S]*?href="\/([^"/]+)\/([^"/?#]+)"/);
    if (!h) return;
    const [owner, name] = [decode(h[1]), decode(h[2])];
    const desc = a.match(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/);
    const lang = a.match(/itemprop="programmingLanguage">([^<]*)</);
    const starsM = a.match(new RegExp(`href="/${escapeRe(h[1])}/${escapeRe(h[2])}/stargazers"[^>]*>[\\s\\S]*?([\\d,]+)\\s*</a>`));
    const forksM = a.match(new RegExp(`href="/${escapeRe(h[1])}/${escapeRe(h[2])}/forks"[^>]*>[\\s\\S]*?([\\d,]+)\\s*</a>`));
    const gainM = a.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/);
    const idM = a.match(/repository_id&quot;:(\d+)/);
    rows.push({
      owner,
      name,
      slug: `${owner}/${name}`,
      description: desc ? stripTags(desc[1]) : "",
      language: lang ? lang[1].trim() || null : null,
      stars: starsM ? toInt(starsM[1]) : null,
      forks: forksM ? toInt(forksM[1]) : null,
      gain: gainM ? toInt(gainM[1]) : null,
      gainWord: gainM ? gainM[2] : null,
      rank: i + 1,
      repo_id: idM ? Number(idM[1]) : null,
    });
  });
  return rows;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Throws TrendingParseError when a page cannot be trusted; returns rows otherwise. */
function validatePage(rows, { period, lang }) {
  const where = `trending ${period}/${lang}`;
  if (!rows.length) throw new TrendingParseError(`${where}: parsed 0 rows (parser drift or empty page)`);
  if (period === "weekly" && lang === "all" && rows.length < MIN_ROWS_WEEKLY_ALL) {
    throw new TrendingParseError(`${where}: parsed ${rows.length} rows, expected >= ${MIN_ROWS_WEEKLY_ALL}`);
  }
  const noStars = rows.filter((r) => !Number.isFinite(r.stars));
  if (noStars.length) throw new TrendingParseError(`${where}: ${noStars.length}/${rows.length} rows without total stars (first: ${noStars[0].slug})`);
  const withGain = rows.filter((r) => Number.isFinite(r.gain));
  if (!withGain.length) throw new TrendingParseError(`${where}: no row carries a "stars ${GAIN_WORD[period]}" gain`);
  const wrong = withGain.find((r) => r.gainWord !== GAIN_WORD[period]);
  if (wrong) throw new TrendingParseError(`${where}: gain phrased "${wrong.gainWord}", expected "${GAIN_WORD[period]}"`);
  return rows;
}

function pageUrl(base, period, lang) {
  return `${base}${lang === "all" ? "" : `/${encodeURIComponent(lang)}`}?since=${period}`;
}

/**
 * Pure: page observations -> one entry per repo, keyed lowercase. `primary` is
 * the observation the item's metadata.trend reports; `observations` keeps all.
 */
function mergeObservations(pages) {
  const byRepo = new Map();
  for (const { period, lang, rows } of pages) {
    for (const r of rows) {
      const key = r.slug.toLowerCase();
      if (!byRepo.has(key)) byRepo.set(key, { row: r, observations: [] });
      const e = byRepo.get(key);
      e.observations.push({ period, lang, rank: r.rank, gain: r.gain });
      // keep the richest row text (description/language can be missing on one page)
      if (!e.row.description && r.description) e.row = { ...e.row, description: r.description };
      if (!e.row.language && r.language) e.row = { ...e.row, language: r.language };
    }
  }
  for (const e of byRepo.values()) {
    e.primary = [...e.observations].sort(
      (a, b) =>
        PERIOD_RANK[a.period] - PERIOD_RANK[b.period] ||
        (a.lang === "all" ? 0 : 1) - (b.lang === "all" ? 0 : 1) ||
        a.rank - b.rank
    )[0];
  }
  return byRepo;
}

class GitHubTrendingModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
  }

  async fetchPage(url) {
    const get = this.deps.fetchText || fetchText;
    const sleep = this.deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const opts = { headers: { Accept: "text/html" }, timeoutMs: this.config.timeout_ms || 20000 };
    try {
      return await get(url, opts);
    } catch (err) {
      // One polite retry for a transient answer (429/5xx/timeout); anything else is final.
      const transient = err && (err.name === "TimeoutError" || err.status === 429 || err.status >= 500);
      if (!transient) throw err;
      await sleep(this.config.retry_delay_ms ?? 5000);
      return get(url, opts);
    }
  }

  async fetch() {
    const base = (this.url || "https://github.com/trending").replace(/\/+$/, "");
    const periods = this.config.periods || PERIODS;
    const langs = this.config.languages || LANGUAGES;
    const sleep = this.deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const gap = this.config.page_delay_ms ?? 750;

    const pages = [];
    const failures = [];
    for (const period of periods) {
      for (const lang of langs) {
        if (pages.length + failures.length) await sleep(gap);
        try {
          const html = await this.fetchPage(pageUrl(base, period, lang));
          pages.push({ period, lang, rows: validatePage(parseTrendingPage(html), { period, lang }) });
        } catch (err) {
          failures.push(`${period}/${lang}: ${err.message}`);
        }
      }
    }
    const planned = periods.length * langs.length;
    if (failures.length) {
      throw new Error(`gh-trending: ${failures.length}/${planned} pages failed - ${failures.slice(0, 3).join("; ")}`);
    }

    const now = (this.deps.now || (() => new Date()))();
    const day = utcDay(now);
    const merged = mergeObservations(pages);
    const items = [];
    const snaps = [];
    for (const { row, observations, primary } of merged.values()) {
      const themes = tagRepo({ name: row.name, description: row.description, topics: [] });
      items.push(
        this.normalize({
          id: `${row.owner}-${row.name}`,
          title: row.slug,
          url: `https://github.com/${row.slug}`,
          description: row.description,
          author: row.owner,
          stars: row.stars,
          score: row.stars + 2 * (row.forks || 0),
          // The page carries no push date; the repo was observed trending now.
          published_at: now.toISOString(),
          metadata: {
            language: row.language,
            forks: row.forks,
            repo_id: row.repo_id,
            trend: { period: primary.period, gain: primary.gain, lang: primary.lang, rank: primary.rank },
            trends: observations,
            themes,
          },
        })
      );
      snaps.push({ repo: row.slug, day, stars: row.stars, forks: row.forks, origin: `trending:${primary.period}` });
    }

    const store = this.deps.store || require("../database/db").snapshots;
    const written = store.recordMany(snaps);
    const rowsSeen = pages.reduce((n, p) => n + p.rows.length, 0);
    console.log(`[trending] pages ${pages.length}/${planned} · rows ${rowsSeen} · repos ${items.length} · snapshots ${written}`);
    return items;
  }
}

module.exports = GitHubTrendingModule;
module.exports.parseTrendingPage = parseTrendingPage;
module.exports.validatePage = validatePage;
module.exports.mergeObservations = mergeObservations;
module.exports.pageUrl = pageUrl;
module.exports.TrendingParseError = TrendingParseError;
module.exports.PERIODS = PERIODS;
module.exports.LANGUAGES = LANGUAGES;
