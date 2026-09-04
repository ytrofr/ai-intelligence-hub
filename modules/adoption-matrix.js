/**
 * Adoption Matrix — "what should we adopt next", read off the Stack Ledger.
 *
 * The ledger (modules/ledger.js) already merges radar decisions and resolved
 * dependencies into one repo-keyed row per third-party thing, with an optional
 * score (effort/effect/time/impact/risk) and an optional slot/feature mapping.
 * This module reshapes THOSE rows into a decision surface: one candidate per
 * (ledger row) x (project that named it), features resolved to that project's
 * own labels, sorted so the highest-scoring candidates read first.
 *
 * A candidate is never scored here — scoreTotal() lives in modules/ledger.js
 * and is imported, never reimplemented, so the number on this page and the
 * number on the Stack Ledger can never quietly drift apart.
 *
 * A row with no slot, no features and no score is a plain in-use dependency —
 * there is nothing to decide about it, so it never becomes a candidate. That
 * is the entire filter: it is what keeps this page a short "what to do next"
 * instead of a second copy of the 300+-row ledger.
 */

const { scoreTotal } = require("./ledger");

const SCORE_DIMS = ["effort", "effect", "time", "impact", "risk"];
const PAID_LATER = "paid-later";

const text = (v) => (typeof v === "string" ? v.trim() : "");
const hasText = (v) => text(v).length > 0;

function isCompleteScore(score) {
  return !!score && typeof score === "object" && SCORE_DIMS.every((d) => Number.isInteger(score[d]));
}

/** A candidate is anything the operator could act on: it names a slot, a set
 * of features it touches, or has been scored — any one is enough. */
function isMatrixEligible(row) {
  return (
    hasText(row && row.slot) ||
    (Array.isArray(row && row.features) && row.features.length > 0) ||
    !!(row && row.score)
  );
}

// One state -> one next physical action. Anything not listed here (an
// "accepted" row with real evidence, or an unforeseen future status) reads as
// "-" rather than a guess — a fabricated action is worse than an honest blank.
const NEXT_ACTION = {
  proposed: "score & pair",
  "accepted-without-evidence": "run it or drop it",
  trial: "read the number",
  done: "adopt card",
  rejected: "-",
};

/**
 * Resolve a row's feature ids against ONE project's own features[] list. An id
 * the project never declared is kept, never dropped - dropping it would hide
 * exactly the mismatch the operator needs to see - and is labelled
 * "(undeclared)", counted so the gap cannot go quiet on the page.
 */
function resolveFeatures(featureIds, project, counters) {
  const labelById = new Map((project.features || []).map((f) => [f.id, f.label]));
  return (featureIds || []).map((id) => {
    if (labelById.has(id)) return { id, label: labelById.get(id) };
    counters.undeclared += 1;
    return { id, label: "(undeclared)" };
  });
}

/**
 * A ledger row is keyed on the REPO, so two projects that each scored the
 * SAME repo collapse into one row — and the H3 fields on that row (slot,
 * features, score, ...) are single-valued, first-authored-wins across
 * whichever project's radar entry happened to merge first. Reading those
 * top-level fields for every project sharing the row would show project B
 * project A's score, which is exactly the bug `per_project` exists to fix
 * (modules/ledger.js).
 *
 * This project's OWN view is, in order:
 *  1. its `per_project` entry, when the row carries one — this project
 *     authored its own H3 data.
 *  2. `null`, when this project authored ANY radar decision about the repo
 *     (`radar_projects`) but that decision carried no H3 fields of its own —
 *     it made an explicit, empty call and must never inherit another
 *     project's score as if it were its own (the openclaw/openclaw bug: an
 *     unscored WATCH row must not dress up in a different project's
 *     telemetry/security/tool-calling score).
 *  3. the row's top-level fields, when this project never authored a radar
 *     decision at all (a pure dependency mention) AND exactly one project
 *     ever did — an unambiguous shared view with nobody to disambiguate
 *     from. Two or more authors makes the top level ambiguous and this
 *     project gets neither.
 *  4. `null` otherwise — genuinely nothing of its own to show.
 */
function projectFields(ledgerRow, projectId) {
  const perProject = ledgerRow.per_project && ledgerRow.per_project[projectId];
  if (perProject) return perProject;

  const radarProjects = Array.isArray(ledgerRow.radar_projects) ? ledgerRow.radar_projects : [];
  if (radarProjects.includes(projectId)) return null;

  const authors = ledgerRow.per_project ? Object.keys(ledgerRow.per_project) : [];
  if (authors.length !== 1) return null;
  return {
    slot: ledgerRow.slot,
    features: ledgerRow.features,
    score: ledgerRow.score,
    cost_tier: ledgerRow.cost_tier,
    hardware_fit: ledgerRow.hardware_fit,
    hardware_mib: ledgerRow.hardware_mib,
    status: ledgerRow.status,
    evidence: ledgerRow.evidence,
    pair: ledgerRow.pair,
    state: ledgerRow.state,
    score_total: ledgerRow.score_total,
  };
}

/** One ledger row, attributed to one project, as a matrix candidate row. */
function buildRow(ledgerRow, projectId, project, counters) {
  const fields = projectFields(ledgerRow, projectId);
  const scored = isCompleteScore(fields && fields.score);
  const score = (fields && fields.score) || {};
  // No per-project record, and the row is shared with at least one other
  // project: this project has not scored the repo itself, so it is
  // "proposed" (score & pair) rather than silently inheriting whatever
  // state another project's own row earned.
  const state = fields ? fields.state || fields.status || "in-use" : "proposed";
  return {
    repo: ledgerRow.repo,
    kind: ledgerRow.kind || "repo",
    project: projectId,
    features: resolveFeatures(fields && fields.features, project, counters),
    slot: (fields && fields.slot) || "",
    cost_tier: (fields && fields.cost_tier) || "",
    hardware_fit: (fields && fields.hardware_fit) || "",
    hardware_mib: fields && Number.isInteger(fields.hardware_mib) ? fields.hardware_mib : null,
    state,
    verdict: ledgerRow.verdict || "",
    effort: scored ? score.effort : null,
    effect: scored ? score.effect : null,
    time: scored ? score.time : null,
    impact: scored ? score.impact : null,
    risk: scored ? score.risk : null,
    // scoreTotal() is the ONE formula - never recomputed here. A row that
    // fails completeness is "unscored" (a string), never a fabricated 0.
    total: scored ? scoreTotal(score) : "unscored",
    basis: scored ? score.basis || "estimated" : "",
    note: scored ? score.note || "" : "",
    why: ledgerRow.why || "",
    next_action: NEXT_ACTION[state] || "-",
  };
}

/** Highest score first; ties broken toward more impact, then less effort. */
function byScoreDesc(a, b) {
  return b.total - a.total || b.impact - a.impact || a.effort - b.effort || a.repo.localeCompare(b.repo);
}

function byProjectThenRepo(a, b) {
  return a.project.localeCompare(b.project) || a.repo.localeCompare(b.repo);
}

/**
 * Every eligible (row x project) pair, resolved against that project's own
 * feature labels. `project`, if given, keeps only that one id — never a
 * silent 0-row result for an id nobody configured yet, as long as at least
 * one ledger row actually names it.
 */
function buildCandidates(ledgerRows, projectById, project, counters) {
  const candidates = [];
  for (const row of ledgerRows) {
    if (!isMatrixEligible(row)) continue;
    for (const pid of Array.isArray(row.projects) ? row.projects : []) {
      if (project && pid !== project) continue;
      const proj = projectById.get(pid) || { id: pid, name: pid, features: [] };
      candidates.push(buildRow(row, pid, proj, counters));
    }
  }
  return candidates;
}

/** Every project id that should get a table: every configured project (so an
 * untouched one still shows as empty, rather than looking unchecked), plus
 * any id a candidate named that config does not know about - never dropped. */
function resolveProjectIds(projectById, candidates, project) {
  if (project) {
    const named = candidates.some((r) => r.project === project);
    return projectById.has(project) || named ? [project] : [];
  }
  const ids = new Set(projectById.keys());
  for (const r of candidates) ids.add(r.project);
  return [...ids].sort();
}

/**
 * Reshape the Stack Ledger into a decision surface: which candidates score
 * best, grouped per project, plus the cross-project Top 10, the Unscored
 * pile, and everything parked on a paid tier.
 *
 * @param {{ledgerRows?: object[], projects?: object[], project?: string|null}} input
 */
/** Slot-level `paid_later[]` strings, shaped like matrix rows (repo = null). */
function slotParkedPaid(projects, project) {
  const out = [];
  for (const p of projects) {
    if (project && p.id !== project) continue;
    for (const slot of p.slots || []) {
      for (const text of Array.isArray(slot.paid_later) ? slot.paid_later : []) {
        out.push({ project: p.id, repo: null, slot: `${p.id}/${slot.id}`, cost_tier: PAID_LATER, why: text, source: "slot" });
      }
    }
  }
  return out;
}

function buildMatrix({ ledgerRows = [], projects = [], project = null } = {}) {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const counters = { undeclared: 0 };
  const candidates = buildCandidates(ledgerRows, projectById, project, counters);

  const projectsOut = resolveProjectIds(projectById, candidates, project).map((id) => {
    const rows = candidates.filter((r) => r.project === id);
    const scoredRows = rows.filter((r) => typeof r.total === "number").sort(byScoreDesc);
    const unscoredRows = rows.filter((r) => r.total === "unscored").sort((a, b) => a.repo.localeCompare(b.repo));
    return { id, name: (projectById.get(id) || {}).name || id, rows: [...scoredRows, ...unscoredRows] };
  });

  const allScored = candidates.filter((r) => typeof r.total === "number").sort(byScoreDesc);
  const allUnscored = candidates.filter((r) => r.total === "unscored").sort(byProjectThenRepo);
  // Paid SERVICES without a repo slug cannot be ledger rows; slots carry them as
  // `paid_later[]` strings. The parked list merges BOTH sources, as the slot
  // page does, so the matrix never reads "nothing parked" while a slot says so.
  const parkedPaid = candidates.filter((r) => r.cost_tier === PAID_LATER).sort(byProjectThenRepo)
    .concat(slotParkedPaid(projects, project));

  const byProject = {};
  for (const p of projectsOut) byProject[p.id] = p.rows.length;

  return {
    population: {
      rows: candidates.length,
      scored: allScored.length,
      unscored: allUnscored.length,
      measured: allScored.filter((r) => r.basis === "measured").length,
      estimated: allScored.filter((r) => r.basis === "estimated").length,
      undeclared_features: counters.undeclared,
      by_project: byProject,
    },
    projects: projectsOut,
    top: allScored.slice(0, 10),
    unscored: allUnscored,
    parked_paid: parkedPaid,
  };
}

module.exports = { buildMatrix, isMatrixEligible };
