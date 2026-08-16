/**
 * Recommendation ranking - pure functions applied on the SERVE path.
 *   starFloor        - drop low-star repos (default 200; ?starsMin=0 disables)
 *   dropForksArchived- forks/archived never recommended (metadata from discovery)
 *   canonicalDedup   - same repo name OR same description = one row (mirrors, renames)
 *   recencyFactor    - decay by age of last push (published_at = pushed_at)
 *   rankDiscoveries  - overlap first, then decayed score
 *   stackHealth      - our own deps: not recommendations, just upstream staleness
 */

const DEFAULT_STARS_MIN = 200;
const DESC_KEY_MIN = 20;

function starFloor(items, min = DEFAULT_STARS_MIN) {
  if (!min || min <= 0) return items;
  return items.filter((i) => (i.stars || 0) >= min);
}

function dropForksArchived(items) {
  return items.filter((i) => !(i.metadata && (i.metadata.fork === true || i.metadata.archived === true)));
}

function descKey(desc) {
  const s = String(desc || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return s.length >= DESC_KEY_MIN ? s : null;
}

function repoKey(title) {
  return String(title || "").toLowerCase().split("/").pop();
}

/** Keep the higher-star row for any group sharing a repo name or a description. */
function canonicalDedup(items) {
  const sorted = [...items].sort((a, b) => (b.stars || 0) - (a.stars || 0));
  const seenName = new Set();
  const seenDesc = new Set();
  const out = [];
  for (const it of sorted) {
    const nk = repoKey(it.title);
    const dk = descKey(it.description);
    if (seenName.has(nk) || (dk && seenDesc.has(dk))) continue;
    seenName.add(nk);
    if (dk) seenDesc.add(dk);
    out.push(it);
  }
  return out;
}

function recencyFactor(publishedAt, now = Date.now()) {
  if (!publishedAt) return 0.25;
  const t = new Date(publishedAt).getTime();
  if (isNaN(t)) return 0.25;
  const days = (now - t) / 86400000;
  if (days < 30) return 1.0;
  if (days < 90) return 0.7;
  if (days < 180) return 0.45;
  return 0.25;
}

function rankDiscoveries(items, { starsMin = DEFAULT_STARS_MIN, now = Date.now() } = {}) {
  const filtered = canonicalDedup(dropForksArchived(starFloor(items, starsMin)));
  for (const it of filtered) {
    const f = recencyFactor(it.published_at, now);
    it.relevance = { ...(it.relevance || {}), recencyFactor: f, decayedScore: Math.round((it.score || 0) * f * 100) / 100 };
  }
  return filtered.sort(
    (a, b) =>
      (b.relevance.dependencyOverlap || 0) - (a.relevance.dependencyOverlap || 0) ||
      (b.relevance.decayedScore || 0) - (a.relevance.decayedScore || 0) ||
      (b.stars || 0) - (a.stars || 0),
  );
}

/** Our own dependencies, reframed: upstream health, stalest first. Not a recommendation. */
function stackHealth(items, now = Date.now()) {
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    if (seen.has(it.title)) continue;
    seen.add(it.title);
    const t = it.published_at ? new Date(it.published_at).getTime() : NaN;
    rows.push({
      title: it.title,
      url: it.url,
      stars: it.stars || 0,
      description: it.description || "",
      pushed_at: it.published_at || null,
      daysSincePush: isNaN(t) ? null : Math.round((now - t) / 86400000),
      openIssues: (it.metadata && it.metadata.open_issues) ?? null,
    });
  }
  return rows.sort((a, b) => (b.daysSincePush ?? 1e9) - (a.daysSincePush ?? 1e9));
}

module.exports = { starFloor, dropForksArchived, canonicalDedup, recencyFactor, rankDiscoveries, stackHealth, DEFAULT_STARS_MIN };
