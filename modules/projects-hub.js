/**
 * The projects hub — one tree, four levels: project > slot > candidate > record.
 *
 * This is a JOIN, not a new store. Two payloads that already exist disagree
 * about what a "candidate" is, and the disagreement is the whole reason this
 * module has tests:
 *
 *   ground truth  owns the project -> slot tree. It is the ONLY source that
 *                 knows a need exists at all, because it is keyed on the SLOT.
 *   the matrix    owns the score, the gates and the next action. It is keyed on
 *                 the CANDIDATE, so a need nobody proposed anything for has no
 *                 row in it and never will.
 *
 * Every candidate-keyed page in this app is therefore structurally blind to an
 * unanswered need. Six of our declared slots are in exactly that state, and
 * making them a ROW - loud, counted, at the top level - is the reason this hub
 * is a page rather than a link.
 *
 * House rules inherited verbatim from modules/ground-truth.js:
 *   - An absence is a ROW, never a missing row.
 *   - `last_ran` is null, never 0.
 *   - A number travels with the caveat that bounds it.
 *   - Counts are DERIVED from the rows actually built, never typed beside them.
 *
 * Pure: no IO, no config loading, no clock of its own (the caller passes `now`).
 */

const DAY_MS = 86400000;

/**
 * Days since an ISO date, or null.
 *
 * Three states, never two: a run with no date and a run with an unparseable
 * date are both `null` - which the caller renders as "undated", never as fresh.
 * A future date clamps to 0 rather than going negative, because a negative age
 * is not something a reader can interpret and the date itself is on the page.
 */
function ageDays(iso, now) {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/** The highest score among rows that HAVE one; null when nothing is scored. */
function bestScore(rows) {
  let best = null;
  for (const r of rows) {
    if (typeof r.total === "number" && (best === null || r.total > best)) best = r.total;
  }
  return best;
}

/**
 * Split a project's matrix rows three ways.
 *
 * A naive `row.slot.startsWith(project + "/")` loses both edge classes, and
 * both are real today: 9 of 42 candidates carry NO slot, and one apollo row is
 * scored against `vega/scene-generation`. Dropping either would make the
 * tree quietly smaller than the matrix, which is the one failure a tidier page
 * hides best.
 */
function partitionRows(rows, projectId) {
  const bySlot = new Map();
  const unslotted = [];
  const borrowed = [];

  for (const r of rows) {
    const slot = typeof r.slot === "string" ? r.slot : "";
    if (!slot) {
      unslotted.push(r);
      continue;
    }
    const [owner, ...rest] = slot.split("/");
    if (owner !== projectId || rest.length === 0) {
      borrowed.push(r);
      continue;
    }
    const key = rest.join("/");
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(r);
  }

  return { bySlot, unslotted, borrowed };
}

/**
 * A slot's state, as one word.
 *
 * `empty` and `unscored` are DIFFERENT findings and must never render alike:
 * the first is a need nobody has looked at, the second is work half done. The
 * counts below carry both populations for the same reason - 6 slots have
 * nothing proposed, 7 have nothing scored, and the extra one holds candidates
 * nobody rated.
 */
function slotState(scored, candidates) {
  if (scored.length) return "scored";
  if (candidates.length) return "unscored";
  return "empty";
}

function buildSlot(slot, scored, now) {
  const candidates = Array.isArray(slot.candidates) ? slot.candidates : [];
  const at = (slot.last_ran && slot.last_ran.at) || null;
  return {
    id: slot.id,
    instrument: slot.instrument || null,
    needs: slot.needs || null,
    kind: slot.kind || null,
    feature: slot.feature || null,
    gap: slot.gap || null,
    note: slot.note || null,
    unvetted_caveat: slot.unvetted_caveat || null,
    runs: Number.isInteger(slot.runs) ? slot.runs : 0,
    last_ran: slot.last_ran || null,
    last_ran_at: at,
    age_days: ageDays(at, now),
    candidates,
    scored,
    best: bestScore(scored),
    state: slotState(scored, candidates),
  };
}

function buildProject(project, rows, now) {
  const { bySlot, unslotted, borrowed } = partitionRows(rows, project.id);
  const declared = Array.isArray(project.slots) ? project.slots : [];
  const slots = declared.map((s) => buildSlot(s, bySlot.get(s.id) || [], now));

  // A matrix row naming a slot this project does not declare would otherwise
  // vanish between the two payloads - it is not borrowed (the owner is us) and
  // it is not unslotted (it names a slot). Surfacing it as a finding rather
  // than silently dropping it is the point of the partition invariant.
  const declaredIds = new Set(declared.map((s) => s.id));
  const orphaned = [];
  for (const [slotId, slotRows] of bySlot) {
    if (!declaredIds.has(slotId)) orphaned.push(...slotRows);
  }

  return {
    id: project.id,
    name: project.name || project.id,
    slots,
    unslotted,
    borrowed,
    orphaned,
    counts: {
      slots: slots.length,
      slots_empty: slots.filter((s) => s.state === "empty").length,
      slots_unscored: slots.filter((s) => s.state !== "scored").length,
      slots_never_run: slots.filter((s) => s.runs === 0).length,
      slots_with_a_gap: slots.filter((s) => s.gap).length,
      candidates: rows.length,
      slotted: rows.length - unslotted.length - borrowed.length - orphaned.length,
      unslotted: unslotted.length,
      borrowed: borrowed.length,
      orphaned: orphaned.length,
      estimated: rows.filter((r) => r.basis === "estimated").length,
      best: bestScore(rows),
    },
  };
}

/**
 * States that mean a project actually took the thing on, as opposed to merely
 * having proposed or rejected it. `in-use` is deliberately absent: a package
 * resolved out of a manifest was never a decision anybody made.
 */
const ADOPTED_STATES = new Set([
  "accepted",
  "accepted-without-evidence",
  "trial",
  "done",
  "done-unverified",
  "done-unseen",
]);

/**
 * Repos more than one project has ADOPTED.
 *
 * This is the operator's original ask - "so one project stops rediscovering
 * what another already solved" - and it is the one thing inventory.html showed
 * that no other surface does. It is computed from each project's OWN authored
 * state, never from the merged row: first-authored-wins means the merged
 * `state` belongs to whichever project happened to write first, so counting on
 * it would credit a project with an adoption it never made.
 */
function sharedAdoptions(ledgerRows = []) {
  const out = [];
  for (const row of ledgerRows) {
    const per = row.per_project || {};
    const adopters = Object.keys(per).filter((pid) => ADOPTED_STATES.has(per[pid] && per[pid].state));
    if (adopters.length >= 2) {
      out.push({ repo: row.repo, kind: row.kind || "repo", projects: adopters.sort(), why: row.why || null });
    }
  }
  return out.sort((a, b) => b.projects.length - a.projects.length || a.repo.localeCompare(b.repo));
}

/**
 * @param {object} input
 * @param {object} input.groundTruth  the /api/ground-truth payload
 * @param {object} input.matrix       the /api/adoption-matrix payload
 * @param {object} [input.ledgerCounts] the /api/ledger counts, for the population line
 * @param {Array}  [input.ledgerRows]   the merged ledger rows, for cross-project adoptions
 * @param {number} [input.now]        epoch ms, passed in and never read here
 */
function buildHub({ groundTruth, matrix, ledgerCounts, ledgerRows, now = Date.now() } = {}) {
  const gtProjects = (groundTruth && groundTruth.projects) || [];
  const rowsByProject = new Map(
    ((matrix && matrix.projects) || []).map((p) => [p.id, Array.isArray(p.rows) ? p.rows : []]),
  );

  const projects = gtProjects.map((p) => buildProject(p, rowsByProject.get(p.id) || [], now));

  // A project the matrix knows about and ground truth does not would be
  // dropped by the map above. It cannot happen today (both read the same
  // projects config) but it is exactly the kind of silent shrink this hub
  // exists to make visible, so it is counted rather than assumed away.
  const known = new Set(projects.map((p) => p.id));
  const unknown_projects = [...rowsByProject.keys()].filter((id) => !known.has(id));

  const sum = (fn) => projects.reduce((n, p) => n + fn(p.counts), 0);
  const population = {
    projects: projects.length,
    slots: sum((c) => c.slots),
    // Both populations, both named. A page printing one of these without
    // saying which is the thing this module exists to prevent.
    slots_empty: sum((c) => c.slots_empty),
    slots_unscored: sum((c) => c.slots_unscored),
    candidates: sum((c) => c.candidates),
    unslotted: sum((c) => c.unslotted),
    borrowed: sum((c) => c.borrowed),
    orphaned: sum((c) => c.orphaned),
    unknown_projects,
    // Carried through so the page can say "42 of 332" without recomputing a
    // denominator it does not own.
    matrix_rows: (matrix && matrix.population && matrix.population.rows) || 0,
    ledger_rows: (matrix && matrix.population && matrix.population.ledger_rows) || 0,
    hidden: (matrix && matrix.population && matrix.population.hidden) || 0,
    in_use: (ledgerCounts && ledgerCounts.unexplained) || 0,
    evals: (matrix && matrix.population && matrix.population.evals) || null,
  };

  return { projects, population, shared: sharedAdoptions(ledgerRows) };
}

module.exports = { buildHub, ageDays, bestScore, partitionRows, slotState, sharedAdoptions, ADOPTED_STATES };
