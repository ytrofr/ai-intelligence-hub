/**
 * Trends builder - ONE function behind both GET /api/trends and the weekly
 * digest's "Trending by theme" section, so the page and the digest cannot
 * disagree (the Ground Truth board's pattern: modules/ground-truth.js serves
 * routes/ground-truth.js and the digest alike).
 *
 * Pool  = repos a trend source (gh-trending, gh-theme) saw in the last 14 days
 *       ∪ every repo with >= 2 star snapshots in the last 30 days.
 *         gh-theme may not exist yet - its absence is REPORTED in
 *         population.missing_sources, never papered over.
 * Score = routes/lib/velocity.js. `insufficient_history` stays a state: its
 *         gain and velocity are NULL, never 0, and such rows are listed apart
 *         (`unranked`) instead of being sorted to the bottom as zeros.
 * Ruled = the ledger, through the SAME ledgerFilter the recommend path uses,
 *         so "ruled" means one thing across the hub. Hidden by default.
 *
 * Read-only. The lane never writes a radar row; `candidates` is a list for the
 * operator, and the page's "Add to radar as WATCH" goes through the existing
 * POST /api/radar/row like any other manual add.
 *
 * Takes a raw better-sqlite3 handle (items + star_snapshots) so tests can drive
 * `new Database(":memory:")`.
 */

const { computeVelocity, rankByVelocity, velocityOf, GAIN7_FLOOR } = require("./velocity");
const { SnapshotStore, utcDay, slugKey, isSlug } = require("../../database/snapshot-store");
const { compileThemes, matchThemes, loadThemes, OTHER } = require("../../modules/themes");
const { ledgerFilter, loadLedgerRows } = require("../../modules/recommend");

const TREND_SOURCES = ["gh-trending", "gh-theme"];
const POOL_DAYS = 14;
const SPARK_DAYS = 30;
const KNOWN_DAYS = 7;
const UNRANKED_CAP = 200;
const CANDIDATES_PER_THEME = 10;
// "Surged though known": gain7 >= max(SURGE_MIN, SURGE_SHARE x total stars).
const SURGE_MIN = 500;
const SURGE_SHARE = 0.1;
const PERIODS = [7, 30];

const DAY_MS = 86400000;
const dayNum = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const daysSince = (iso, today) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.parse(`${today}T23:59:59Z`) - t) / DAY_MS)) : null;
};

function parseMeta(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}") || {};
  } catch {
    return {};
  }
}

/** Largest gain the trending page reported per period: {daily, weekly, monthly}. */
function trendingGains(meta) {
  const out = {};
  const obs = Array.isArray(meta.trends) && meta.trends.length ? meta.trends : meta.trend ? [meta.trend] : [];
  for (const o of obs) {
    if (!o || !isNum(o.gain) || !o.period) continue;
    if (!isNum(out[o.period]) || o.gain > out[o.period]) out[o.period] = o.gain;
  }
  return out;
}

/**
 * The 30-day sibling of computeVelocity, same shape. A reading 30..33 days
 * back is the base; the trending page's "stars this month" stands in until
 * one exists. Same floor as the 7-day window (GAIN7_FLOOR).
 */
function computeVelocity30(series, { today, monthly } = {}) {
  const rows = (series || [])
    .filter((r) => r && r.day && isNum(r.stars) && (!today || dayNum(r.day) <= dayNum(today)))
    .sort((a, b) => dayNum(a.day) - dayNum(b.day));
  const latest = rows[rows.length - 1] || null;
  const out = { gain7: null, velocity: null, origin: "insufficient_history", eligible: false, stars: latest ? latest.stars : null, stars_7d_ago: null, base_day: null };
  let base = null;
  if (latest) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const age = dayNum(latest.day) - dayNum(rows[i].day);
      if (age >= 30 && age <= 33) {
        base = rows[i];
        break;
      }
    }
  }
  if (base) {
    Object.assign(out, { gain7: latest.stars - base.stars, stars_7d_ago: base.stars, base_day: base.day, origin: "snapshots" });
  } else if (isNum(monthly)) {
    Object.assign(out, { gain7: monthly, stars_7d_ago: latest ? Math.max(0, latest.stars - monthly) : null, origin: "trending-page" });
  } else {
    return out;
  }
  out.velocity = velocityOf(out.gain7, out.stars_7d_ago);
  out.eligible = out.velocity !== null && out.gain7 >= GAIN7_FLOOR;
  return out;
}

function chunk(list, n = 500) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function hasTable(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

/**
 * Everything the hub's github-shaped sources know about these repos (first
 * sighting, created_at, topics). One scan, keys passed as a JSON array, and
 * only the three metadata fields read by json_extract - parsing every
 * metadata blob in JS was 80% of the request time at a 767-repo pool.
 */
function knownInfo(db, keys) {
  const out = new Map();
  if (!keys.length) return out;
  const rows = db
    .prepare(
      `SELECT title, url, description, stars, first_seen_at,
              json_extract(metadata, '$.created_at') AS created_at,
              json_extract(metadata, '$.language')   AS language,
              json_extract(metadata, '$.topics')     AS topics
         FROM items
        WHERE (source LIKE 'github%' OR source LIKE 'gh-%')
          AND lower(title) IN (SELECT value FROM json_each(?))
          AND json_valid(COALESCE(metadata, '{}'))`
    )
    .all(JSON.stringify(keys));
  for (const r of rows) {
    const key = slugKey(r.title);
    const e = out.get(key) || { title: r.title, url: r.url, description: r.description, stars: r.stars, first_seen_at: null, created_at: null, topics: [], language: null };
    if (r.first_seen_at && (!e.first_seen_at || r.first_seen_at < e.first_seen_at)) e.first_seen_at = r.first_seen_at;
    if (!e.created_at && r.created_at) e.created_at = r.created_at;
    if (!e.topics.length && r.topics) {
      const t = parseMeta(r.topics);
      if (Array.isArray(t)) e.topics = t;
    }
    if (!e.language && r.language) e.language = r.language;
    if (!e.description && r.description) e.description = r.description;
    if ((r.stars || 0) > (e.stars || 0)) e.stars = r.stars;
    out.set(key, e);
  }
  return out;
}

/** Ledger -> per-repo status chip. `ruled` is decided by ledgerFilter itself. */
function statusFor(keys, ledgerRows) {
  const lowered = (ledgerRows || []).filter((r) => r && r.repo).map((r) => ({ ...r, repo: slugKey(r.repo) }));
  const byRepo = new Map();
  for (const r of lowered) if (!byRepo.has(r.repo)) byRepo.set(r.repo, r);
  const kept = new Set(ledgerFilter(keys.map((k) => ({ title: k })), lowered).map((c) => c.title));
  const out = new Map();
  for (const k of keys) {
    const row = byRepo.get(k);
    if (!kept.has(k)) {
      out.set(k, { kind: "ruled", label: `ruled: ${row ? row.status : "unknown"}`, projects: row ? row.projects || [] : [] });
    } else if (row) {
      const ps = (row.radar_projects && row.radar_projects.length ? row.radar_projects : row.projects) || [];
      out.set(k, { kind: "on-radar", label: `on radar: ${ps.join(", ") || row.status}`, projects: ps });
    } else {
      out.set(k, { kind: "new", label: "new", projects: [] });
    }
  }
  return out;
}

/** Collect the pool: trend-source items (14d) + repos with >= 2 snapshots (30d). */
function collectPool(db, { today, haveSnapshots }) {
  const sinceIso = `${shiftDay(today, -POOL_DAYS)}T00:00:00.000Z`;
  const pool = new Map();
  const sources = Object.fromEntries(TREND_SOURCES.map((s) => [s, 0]));
  const items = db
    .prepare(
      `SELECT source, title, url, description, stars, metadata, first_seen_at, fetched_at FROM items
       WHERE source IN (${TREND_SOURCES.map(() => "?").join(",")}) AND fetched_at >= ?`
    )
    .all(...TREND_SOURCES, sinceIso);
  for (const it of items) {
    const key = slugKey(it.title);
    if (!isSlug(key)) continue;
    const meta = parseMeta(it.metadata);
    const e = pool.get(key) || { key, repo: it.title, url: it.url, description: it.description || "", stars: it.stars, sources: new Set(), gains: {}, themes: null, language: null, first_seen_at: null };
    if (!e.sources.has(it.source)) sources[it.source] += 1;
    e.sources.add(it.source);
    for (const [p, g] of Object.entries(trendingGains(meta))) if (!isNum(e.gains[p]) || g > e.gains[p]) e.gains[p] = g;
    if (!e.themes && Array.isArray(meta.themes) && meta.themes.length) e.themes = meta.themes;
    if (!e.language && meta.language) e.language = meta.language;
    if (it.first_seen_at && (!e.first_seen_at || it.first_seen_at < e.first_seen_at)) e.first_seen_at = it.first_seen_at;
    const fd = String(it.fetched_at || "").slice(0, 10);
    if (fd && (!e.fetched_day || fd > e.fetched_day)) {
      e.fetched_day = fd;
      if (isNum(it.stars)) e.stars = it.stars;
    }
    pool.set(key, e);
  }
  let snapshotsOnly = 0;
  if (haveSnapshots) {
    const repos = db
      .prepare("SELECT repo FROM star_snapshots WHERE day >= ? AND day <= ? GROUP BY repo HAVING COUNT(*) >= 2")
      .all(shiftDay(today, -SPARK_DAYS), today);
    for (const { repo } of repos) {
      if (pool.has(repo)) continue;
      pool.set(repo, { key: repo, repo, url: `https://github.com/${repo}`, description: "", stars: null, sources: new Set(["snapshots"]), gains: {}, themes: null, language: null, first_seen_at: null });
      snapshotsOnly += 1;
    }
  }
  return { pool, sources: { ...sources, "snapshots-only": snapshotsOnly } };
}

function populationFacts(db, { today, haveSnapshots }) {
  if (!haveSnapshots) return { snapshots_today: 0, oldest_history_days: null };
  const t = db.prepare("SELECT COUNT(*) AS n FROM star_snapshots WHERE day = ?").get(today).n;
  const oldest = db.prepare("SELECT MIN(day) AS d FROM star_snapshots WHERE day <= ?").get(today).d;
  return { snapshots_today: t, oldest_history_days: oldest ? dayNum(today) - dayNum(oldest) : null };
}

function sourceStatus(db) {
  if (!hasTable(db, "sources")) return {};
  const ids = [...TREND_SOURCES, "gh-snapshot"];
  const rows = db
    .prepare(`SELECT id, last_status, last_run_at, last_item_count FROM sources WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  return Object.fromEntries(rows.map((r) => [r.id, { status: r.last_status, last_run_at: r.last_run_at, items: r.last_item_count }]));
}

/**
 * Snapshot series up to `today`. When a pool repo has NO snapshot at all, the
 * trend item's own total (a real reading, taken the day it was fetched) is the
 * one point: without it the trending page's weekly gain would have no base and
 * velocity could not be computed. Never used beside real snapshots.
 */
function seriesFor(e, series, today) {
  const real = (series || []).filter((s) => s.day <= today);
  if (real.length || !isNum(e.stars) || !e.fetched_day || e.fetched_day > today) return real;
  return [{ day: e.fetched_day, stars: e.stars, origin: "item" }];
}

/** One output row per pool entry. */
function buildRow(e, { info, series, today, period, compiled, status }) {
  const known = info.get(e.key) || {};
  const v7 = computeVelocity(series, { today, trending: { weekly: e.gains.weekly, daily: e.gains.daily } });
  const v = period === 30 ? computeVelocity30(series, { today, monthly: e.gains.monthly }) : v7;
  const description = e.description || known.description || "";
  const themes =
    e.themes && e.themes.length
      ? e.themes
      : matchThemes({ name: e.key, description, topics: known.topics || [] }, compiled);
  const firstSeen = [e.first_seen_at, known.first_seen_at].filter(Boolean).sort()[0] || null;
  const stars = isNum(v7.stars) ? v7.stars : isNum(e.stars) ? e.stars : isNum(known.stars) ? known.stars : null;
  return {
    repo: known.title && slugKey(known.title) === e.key && e.repo === e.key ? known.title : e.repo,
    key: e.key,
    url: e.url || known.url || `https://github.com/${e.key}`,
    description,
    language: e.language || known.language || null,
    themes,
    stars,
    gain: v.gain7,
    gain1: v7.gain1,
    gain7: v7.gain7,
    gain7_origin: v7.origin,
    velocity: v.velocity,
    origin: v.origin,
    eligible: v.eligible,
    base_day: v.base_day,
    age_days: daysSince(known.created_at, today),
    first_seen_days: daysSince(firstSeen, today),
    sources: [...e.sources].sort(),
    sparkline: series.map((s) => ({ day: s.day, stars: s.stars })),
    status: status.get(e.key),
  };
}

/**
 * @param db  better-sqlite3 handle with `items` and `star_snapshots`
 * @param opts {theme, period: 7|30, minGain, includeRuled, includeOther, today, themes, ledgerRows}
 *   includeOther  false (default): repos matching NO theme (`other` only) are
 *                 hidden from the all-themes view - the trending page is full of
 *                 non-AI noise. Still counted on the `other` tab, and shown when
 *                 theme === 'other'.
 *   themes      taxonomy with projects[] (default: loadThemes())
 *   ledgerRows  buildLedger rows (default: loadLedgerRows())
 */
function buildTrends(db, opts = {}) {
  const today = opts.today || utcDay();
  const period = PERIODS.includes(Number(opts.period)) ? Number(opts.period) : 7;
  const minGain = isNum(Number(opts.minGain)) && Number(opts.minGain) > 0 ? Number(opts.minGain) : 0;
  const includeRuled = !!opts.includeRuled;
  const includeOther = !!opts.includeOther;
  const theme = opts.theme || "";
  const taxonomy = [...(opts.themes || loadThemes())];
  if (!taxonomy.some((t) => t.id === OTHER)) taxonomy.push({ id: OTHER, label: "Other", projects: [] });
  const compiled = compileThemes(taxonomy.filter((t) => t.id !== OTHER));
  const haveSnapshots = hasTable(db, "star_snapshots");

  const { pool, sources } = collectPool(db, { today, haveSnapshots });
  const keys = [...pool.keys()];
  const info = knownInfo(db, keys);
  const seriesBy = haveSnapshots ? new SnapshotStore(db).seriesMany(keys, shiftDay(today, -SPARK_DAYS)) : new Map();
  const status = statusFor(keys, opts.ledgerRows ?? loadLedgerRows());

  const all = keys.map((k) => buildRow(pool.get(k), { info, series: seriesFor(pool.get(k), seriesBy.get(k), today), today, period, compiled, status }));
  const ruledHidden = includeRuled ? 0 : all.filter((r) => r.status.kind === "ruled").length;
  let visible = includeRuled ? all : all.filter((r) => r.status.kind !== "ruled");
  const beforeGain = visible.length;
  if (minGain) visible = visible.filter((r) => isNum(r.gain) && r.gain >= minGain);

  const counts = new Map(taxonomy.map((t) => [t.id, 0]));
  for (const r of visible) for (const t of r.themes) counts.set(t, (counts.get(t) || 0) + 1);
  const themes = taxonomy.map((t) => ({ id: t.id, label: t.label, count: counts.get(t.id) || 0, projects: t.projects || [] }));

  const rank = (rows) =>
    rankByVelocity(rows.map((r) => ({ r, v: { eligible: r.eligible, velocity: r.velocity, gain7: r.gain } }))).map((x) => x.r);
  const rankedAll = rank(visible);
  const onlyOther = (r) => r.themes.length === 1 && r.themes[0] === OTHER;
  const hideOther = !includeOther && theme !== OTHER;
  const inTheme = (r) => (theme ? r.themes.includes(theme) : !(hideOther && onlyOther(r)));
  const otherHidden = !theme && hideOther ? visible.filter(onlyOther).length : 0;
  const ranked = rankedAll.filter(inTheme).map((r, i) => ({ ...r, rank: i + 1 }));
  const rankedKeys = new Set(ranked.map((r) => r.key));
  const unrankedAll = visible
    .filter((r) => inTheme(r) && !rankedKeys.has(r.key))
    .sort((a, b) => (isNum(b.gain) ? b.gain : -1) - (isNum(a.gain) ? a.gain : -1) || (b.stars || 0) - (a.stars || 0));

  const surgedThoughKnown = visible
    .filter(
      (r) =>
        inTheme(r) &&
        isNum(r.first_seen_days) && r.first_seen_days > KNOWN_DAYS &&
        r.gain7_origin === "snapshots" && isNum(r.gain7) &&
        r.gain7 >= Math.max(SURGE_MIN, SURGE_SHARE * (r.stars || 0))
    )
    .sort((a, b) => b.gain7 - a.gain7);

  const candidates = themes
    .filter((t) => t.id !== OTHER && t.projects.length && (!theme || t.id === theme))
    .map((t) => ({
      theme: t.id,
      label: t.label,
      projects: t.projects,
      repos: rankedAll.filter((r) => r.themes.includes(t.id)).slice(0, CANDIDATES_PER_THEME).filter((r) => r.status.kind === "new"),
    }))
    .filter((c) => c.repos.length);

  return {
    generated_at: new Date().toISOString(),
    today,
    period,
    theme: theme || null,
    min_gain: minGain,
    include_ruled: includeRuled,
    include_other: includeOther,
    population: {
      pool: pool.size,
      shown: ranked.length + unrankedAll.length,
      ranked: ranked.length,
      unranked: unrankedAll.length,
      ruled_hidden: ruledHidden,
      other_hidden: otherHidden,
      below_min_gain: beforeGain - visible.length,
      ...populationFacts(db, { today, haveSnapshots }),
      sources,
      missing_sources: TREND_SOURCES.filter((s) => !sources[s]),
      source_status: sourceStatus(db),
      gain_floor: GAIN7_FLOOR,
    },
    themes,
    rows: ranked,
    unranked: unrankedAll.slice(0, UNRANKED_CAP),
    surgedThoughKnown,
    candidates,
  };
}

/**
 * Velocity for an arbitrary list of repos (the digest's Rising Stars re-rank):
 * the same computeVelocity over snapshots, with any gh-trending gain as the
 * fallback. Map slugKey -> computeVelocity result.
 */
function velocityMap(db, repos, { today = utcDay() } = {}) {
  const keys = [...new Set((repos || []).map(slugKey).filter(isSlug))];
  const out = new Map();
  if (!keys.length) return out;
  const series = hasTable(db, "star_snapshots") ? new SnapshotStore(db).seriesMany(keys, shiftDay(today, -SPARK_DAYS)) : new Map();
  const gains = new Map();
  for (const part of chunk(keys)) {
    const rows = db
      .prepare(`SELECT title, metadata FROM items WHERE source = 'gh-trending' AND lower(title) IN (${part.map(() => "?").join(",")})`)
      .all(...part);
    for (const r of rows) gains.set(slugKey(r.title), trendingGains(parseMeta(r.metadata)));
  }
  for (const k of keys) {
    const g = gains.get(k) || {};
    out.set(k, computeVelocity(series.get(k) || [], { today, trending: { weekly: g.weekly, daily: g.daily } }));
  }
  return out;
}

module.exports = { buildTrends, velocityMap, computeVelocity30, trendingGains, PERIODS, TREND_SOURCES, SURGE_MIN, SURGE_SHARE };
