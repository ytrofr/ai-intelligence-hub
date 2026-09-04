/**
 * Recommend - per-project recommendation assembly, shared by
 * routes/recommendations.js (HTTP) and modules/weekly-digest.js (in-process).
 * loadPool() reads the discovery pool ONCE; recommendFromPool() ranks it for a
 * project, so the digest's per-project loop parses metadata a single time.
 *
 * H1 fix (2026-09): the served list used to dedupe candidates by title alone
 * and never asked the ledger whether we had already RULED on a repo. Over five
 * weekly digests that suggested 60 distinct repos and adopted zero of them, 12+
 * came back every single week - including `browser-use/browser-use`, rejected
 * TWICE, on both Apollo and Orion's radar. `ledgerFilter` closes that: drop
 * anything the ledger has already decided, demote (never drop) anything still
 * `proposed` or repeated across prior digests, so a genuinely fresh candidate
 * is not crowded out by the same familiar names forever.
 */

const fs = require("fs");
const path = require("path");
const { rankDiscoveries, stackHealth, DEFAULT_STARS_MIN } = require("../routes/lib/rank");
const { formatMatchReason } = require("./match-reason");

// A decision this final means suggesting it again is not a fresh idea, it is
// noise. `proposed` is deliberately absent - an undecided row is demoted
// below, never dropped, because "nobody has looked yet" is not "no".
const LEDGER_DROP_STATUSES = new Set(["rejected", "done", "accepted", "trial", "in-use"]);

// A repo mentioned in two or more PAST digests has already had its turn -
// showing it a third time is not discovery, it is repetition. One mention is
// still new information; two is the same suggestion twice.
const REPEAT_DEMOTE_THRESHOLD = 2;

const DISCOVERY_SOURCES = [
  "huggingface",
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
 * Pure: distinct owner/name slugs mentioned under a digest's
 * "## 🎯 Per-project suggestions" heading, and NOWHERE else in the document.
 * The TL;DR / rising-stars / ecosystem sections mention plenty of repos that
 * were never actually suggested to a project, and the ground-truth section
 * below the suggestions can mention a suggested repo again in passing - both
 * would inflate the repeat count for reasons unrelated to this filter.
 *
 * Total on bad input: a non-string, or a document with no such heading, is an
 * empty result, never a throw - a missing digest must not crash the recommend
 * path it exists to protect.
 */
function extractSuggestedSlugs(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const start = text.indexOf("## 🎯 Per-project suggestions");
  if (start === -1) return [];
  // Skip past this heading's own "## " so the end-of-section search below
  // cannot immediately re-match the line we just found.
  const body = text.slice(start + 2);
  const nextHeading = body.search(/\n## /);
  const section = nextHeading === -1 ? body : body.slice(0, nextHeading);
  const slugs = new Set();
  const re = /\[([\w.-]+\/[\w.-]+)\]\(https?:\/\/[^)\s]+\)/g;
  let m;
  while ((m = re.exec(section))) slugs.add(m[1]);
  return [...slugs];
}

/**
 * Every past digest's suggested slugs, one array per file. The dir is
 * injectable so a test never touches the real (gitignored-content) digests
 * folder; a missing dir - or one with nothing in it yet - is the identity
 * control: no prior digests, ledgerFilter demotes nothing on that basis.
 */
function readPriorDigests(dir = path.join(__dirname, "..", "digests")) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^weekly-.*\.md$/.test(f))
    .map((f) => {
      try {
        return extractSuggestedSlugs(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch {
        return [];
      }
    });
}

/**
 * The ledger, built the same way routes/ledger.js builds it for the page - so
 * the recommend path and the ledger page can never disagree about a repo's
 * status. Lazy + defensive: a ledger read failure must demote the whole
 * feature to "no ledger data" (the identity behaviour), never crash serving.
 */
function loadLedgerRows() {
  try {
    // eslint-disable-next-line global-require
    const ledgerRoute = require("../routes/lib/hub-sources");
    const { buildLedger } = require("./ledger");
    const { depRepos } = ledgerRoute.readDepRepos();
    return buildLedger({ radarRows: ledgerRoute.readAllRadarRows(), depRepos }).rows;
  } catch (err) {
    console.warn(`[recommend] ledger unavailable, serving without it: ${err.message}`);
    return [];
  }
}

/**
 * Drop what the ledger already settled; demote (never drop) what is merely
 * `proposed` or has already had its turn in >= REPEAT_DEMOTE_THRESHOLD prior
 * digests. Pure and total: an empty ledger + no prior digests is the IDENTITY
 * - the exact behaviour before this filter existed.
 *
 * @param {object[]} candidates - each carrying `.title` as an "owner/name" slug
 * @param {object[]} [ledgerRows] - rows shaped like modules/ledger.js buildLedger() output
 * @param {{priorDigests?: string[][]}} [opts] - one array of slugs per past digest
 */
function ledgerFilter(candidates, ledgerRows = [], { priorDigests = [] } = {}) {
  const byRepo = new Map();
  for (const row of ledgerRows) {
    if (row && row.repo && !byRepo.has(row.repo)) byRepo.set(row.repo, row);
  }

  const priorCount = new Map();
  for (const slugs of priorDigests) {
    for (const slug of new Set(slugs || [])) priorCount.set(slug, (priorCount.get(slug) || 0) + 1);
  }

  const kept = [];
  const demoted = [];
  for (const c of candidates) {
    const row = byRepo.get(c.title);
    if (row && LEDGER_DROP_STATUSES.has(row.status)) continue;
    const stillProposed = !!row && row.status === "proposed";
    const repeated = (priorCount.get(c.title) || 0) >= REPEAT_DEMOTE_THRESHOLD;
    (stillProposed || repeated ? demoted : kept).push(c);
  }
  return [...kept, ...demoted];
}

/**
 * @returns {{discoveries: object[], stackHealth: object[], poolSize: number}}
 */
function recommendFromPool(
  pool,
  project,
  { limit = 20, starsMin = DEFAULT_STARS_MIN, raw = false, ledgerRows, priorDigests } = {},
) {
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

  // Consult the ledger AFTER ranking/dedup, BEFORE the final limit slice - a
  // demoted repeat should lose its spot to a fresh candidate when both compete
  // for the same `limit`, not just get reordered within an already-cut list.
  discoveries = ledgerFilter(discoveries, ledgerRows ?? loadLedgerRows(), {
    priorDigests: priorDigests ?? readPriorDigests(),
  });

  return { discoveries: discoveries.slice(0, limit), stackHealth: stackHealth(ownDeps).slice(0, limit), poolSize: candidates.length };
}

function recommendForProject(db, project, opts = {}) {
  return recommendFromPool(loadPool(db), project, opts);
}

function topFeed(db, limit = 20) {
  return db.getItems({ sources: DISCOVERY_SOURCES, sortBy: "score", sortOrder: "DESC", limit }).map((i) => enrich(i));
}

module.exports = {
  recommendForProject,
  recommendFromPool,
  loadPool,
  topFeed,
  enrich,
  parseMeta,
  DISCOVERY_SOURCES,
  ledgerFilter,
  extractSuggestedSlugs,
  readPriorDigests,
  loadLedgerRows,
};
