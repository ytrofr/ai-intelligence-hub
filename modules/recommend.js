/**
 * Recommend - per-project recommendation assembly, shared by
 * routes/recommendations.js (HTTP) and modules/weekly-digest.js (in-process).
 * loadPool() reads the discovery pool ONCE; recommendFromPool() ranks it for a
 * project, so the digest's per-project loop parses metadata a single time.
 */

const { rankDiscoveries, stackHealth, DEFAULT_STARS_MIN } = require("../routes/lib/rank");
const { formatMatchReason } = require("./match-reason");

const DISCOVERY_SOURCES = [
  "github-discovery-tech",
  "github-discovery-curated",
  "github-discovery-rising",
  "github-discovery-deps",
  "github-watchlist",
];
const POOL_LIMIT = 2000;

function parseMeta(item) {
  try {
    return typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata || {};
  } catch {
    return {};
  }
}

/** Flatten a raw item into {...item, metadata, relevance} for a project (or globally). */
function enrich(item, forProject) {
  const metadata = parseMeta(item);
  const mps = metadata.matched_projects || [];
  const own = forProject ? mps.find((mp) => mp.id === forProject) : null;
  return {
    ...item,
    metadata,
    relevance: {
      matchedProjects: mps,
      matchReason: own ? formatMatchReason(own) || metadata.match_reason || "" : metadata.match_reason || "",
      dependencyOverlap: own ? own.overlap : metadata.dependency_overlap || 0,
      strategy: metadata.discovery_strategy || "unknown",
    },
  };
}

/** The discovery pool with metadata parsed once. */
function loadPool(db) {
  return db
    .getItems({ sources: DISCOVERY_SOURCES, sortBy: "score", sortOrder: "DESC", limit: POOL_LIMIT })
    .map((item) => ({ ...item, metadata: parseMeta(item) }));
}

/**
 * @returns {{discoveries: object[], stackHealth: object[], poolSize: number}}
 */
function recommendFromPool(pool, project, { limit = 20, starsMin = DEFAULT_STARS_MIN, raw = false } = {}) {
  const matched = pool
    .filter((item) => (item.metadata.matched_projects || []).some((mp) => mp.id === project))
    .map((item) => enrich(item, project));
  matched.sort((a, b) => (b.relevance.dependencyOverlap || 0) - (a.relevance.dependencyOverlap || 0) || (b.score || 0) - (a.score || 0));

  const ownDeps = matched.filter((r) => r.relevance.strategy === "dependency-backed");
  const ownTitles = new Set(ownDeps.map((r) => r.title));
  const candidates = matched.filter((r) => r.relevance.strategy !== "dependency-backed" && !ownTitles.has(r.title));

  let discoveries;
  if (!raw) discoveries = rankDiscoveries(candidates, { starsMin });
  else {
    const seen = new Set();
    discoveries = candidates.filter((r) => (seen.has(r.title) ? false : seen.add(r.title)));
  }
  return { discoveries: discoveries.slice(0, limit), stackHealth: stackHealth(ownDeps).slice(0, limit), poolSize: candidates.length };
}

function recommendForProject(db, project, opts = {}) {
  return recommendFromPool(loadPool(db), project, opts);
}

function topFeed(db, limit = 20) {
  return db.getItems({ sources: DISCOVERY_SOURCES, sortBy: "score", sortOrder: "DESC", limit }).map((i) => enrich(i));
}

module.exports = { recommendForProject, recommendFromPool, loadPool, topFeed, enrich, parseMeta, DISCOVERY_SOURCES };
