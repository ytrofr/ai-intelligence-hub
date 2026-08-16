/**
 * Recommend - per-project recommendation assembly, shared by
 * routes/recommendations.js (HTTP) and modules/weekly-digest.js (in-process).
 */

const { rankDiscoveries, stackHealth, DEFAULT_STARS_MIN } = require("../routes/lib/rank");

const DISCOVERY_SOURCES = [
  "github-discovery-tech",
  "github-discovery-curated",
  "github-discovery-rising",
  "github-discovery-deps",
  "github-watchlist",
];

function parseMeta(item) {
  try {
    return typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata || {};
  } catch {
    return {};
  }
}

/** Flatten a raw item into {…item, metadata, relevance} for a project (or globally). */
function enrich(item, forProject) {
  const metadata = parseMeta(item);
  const mps = metadata.matched_projects || [];
  const own = forProject ? mps.find((mp) => mp.id === forProject) : null;
  let reason = metadata.match_reason || "";
  if (own) {
    const parts = [];
    if (own.specificDeps && own.specificDeps.length) parts.push(`${own.specificDeps.length} key deps (${own.specificDeps.slice(0, 4).join(", ")})`);
    if (own.specificTopics && own.specificTopics.length) parts.push(`${own.specificTopics.length} topics (${own.specificTopics.slice(0, 3).join(", ")})`);
    if (!parts.length && own.genericDeps && own.genericDeps.length) parts.push(`${own.genericDeps.length} common deps`);
    reason = parts.length
      ? `Shares ${parts.join(" + ")}`
      : own.overlap >= 10 ? "Direct dependency" : own.viaQuery ? `Found via "${own.viaQuery}" search` : reason;
  }
  return {
    ...item,
    metadata,
    relevance: {
      matchedProjects: mps,
      matchReason: reason,
      dependencyOverlap: own ? own.overlap : metadata.dependency_overlap || 0,
      strategy: metadata.discovery_strategy || "unknown",
    },
  };
}

/**
 * @returns {{discoveries: object[], stackHealth: object[], poolSize: number}}
 */
function recommendForProject(db, project, { limit = 20, starsMin = DEFAULT_STARS_MIN, raw = false } = {}) {
  const items = db.getItems({ sources: DISCOVERY_SOURCES, sortBy: "score", sortOrder: "DESC", limit: 2000 });
  const matched = items
    .filter((item) => (parseMeta(item).matched_projects || []).some((mp) => mp.id === project))
    .map((item) => enrich(item, project));
  matched.sort((a, b) => (b.relevance.dependencyOverlap || 0) - (a.relevance.dependencyOverlap || 0) || (b.score || 0) - (a.score || 0));

  const ownDeps = matched.filter((r) => r.relevance.strategy === "dependency-backed");
  const ownTitles = new Set(ownDeps.map((r) => r.title));
  const pool = matched.filter((r) => r.relevance.strategy !== "dependency-backed" && !ownTitles.has(r.title));

  let discoveries;
  if (!raw) discoveries = rankDiscoveries(pool, { starsMin });
  else {
    const seen = new Set();
    discoveries = pool.filter((r) => (seen.has(r.title) ? false : seen.add(r.title)));
  }
  return { discoveries: discoveries.slice(0, limit), stackHealth: stackHealth(ownDeps).slice(0, limit), poolSize: pool.length };
}

function topFeed(db, limit = 20) {
  return db.getItems({ sources: DISCOVERY_SOURCES, sortBy: "score", sortOrder: "DESC", limit }).map((i) => enrich(i));
}

module.exports = { recommendForProject, topFeed, enrich, DISCOVERY_SOURCES };
