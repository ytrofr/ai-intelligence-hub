/**
 * The ground-truth board — what checks each of our instruments, and what did it
 * last say?
 *
 * Every scoring instrument across the four repos was found (2026-09-02) to have
 * ZERO external ground truth, and three of them turned out to be wrong in ways
 * nobody could see from inside. This page exists so that the answer "nothing
 * checks this" is visible rather than absent.
 *
 * That single fact shapes every decision here:
 *
 *  - **An absence is a ROW, never a missing row.** A project with no slots, a
 *    slot that has never run, a slot recording a declared GAP — all render. A
 *    board that omits them looks finished and teaches nothing.
 *  - **`last_ran` is null, never 0.** A zero reads as a measured zero, which is
 *    the opposite of "never measured".
 *  - **A number travels with the caveat that bounds it.** Every run recorded in
 *    config/projects.json carries one, because the numbers this arc produced are
 *    exactly the kind that get lifted out of context ("3 of 20 fonts" bounds the
 *    analyzer on published web pages, not on live traffic).
 *  - **Counts are derived from the rendered rows** and nothing else, so the
 *    headline cannot disagree with the table underneath it.
 *
 * Pure: projects, items and near-misses come in, a render tree goes out. The
 * route does the IO; `classify` and `refusal` are injected because the cheap-run
 * gate lives on the HuggingFace module and this must stay testable with no
 * config and no DB.
 */

/**
 * @param {object}   input
 * @param {object[]} input.projects    config/projects.json projects[] (with slots[])
 * @param {object[]} input.items       stored items (metadata.matched_slots is what binds)
 * @param {object[]} input.nearMisses  rows from the slot_near_miss log
 * @param {Function} input.classify    (item) => "runnable" | "needs-you" | "rejected"
 * @param {Function} input.refusal     (item) => why it is not runnable, or null
 */
/**
 * What a slot's candidate list actually claims.
 *
 * Written HERE and nowhere else. The page and the digest both render it, and two
 * copies of one claim drift - the same reason `matchSlots` and `slotMissReason`
 * share one gate chain and `isCheapRun` is defined as `cheapRunRefusal(...) === null`.
 */
// funnel() is pure — it takes rows already passed in and does no IO of its
// own — so requiring it here does not cost this module the "no config, no
// database" property its own doc comment promises above.
const { funnel } = require("./ledger");

const UNVETTED_CAVEAT =
  "this slot has not said what it is about - the rows below are the right SHAPE of data, not vetted answer keys";

// H5: a slot's `kind` is data, not code — `dataset` is the legacy spelling
// for what this page calls `ground-truth` (an answer-key corpus), and an
// absent kind means the same thing. Everything else must be one of the four
// live shapes; an unrecognized kind fails CLOSED rather than rendering a
// slot nobody can classify.
const KIND_ALIASES = { dataset: "ground-truth", "": "ground-truth" };
const VALID_KINDS = new Set(["ground-truth", "model", "package", "service", "skill-eval"]);

function normalizeKind(raw, where) {
  const key = raw || "";
  const kind = KIND_ALIASES[key] || key;
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`ground-truth: ${where} has an unrecognized slot kind "${raw}"`);
  }
  return kind;
}

/**
 * Fail closed on the config BEFORE it is rendered: every project that has
 * slots must declare `features[]`, and every slot must name one of them.
 * This is a separate, explicit gate (not called from inside buildGroundTruth)
 * so the pure builder stays usable with minimal fixtures in tests — the real
 * config/projects.json is validated by its callers (the route, the digest)
 * before they build from it.
 */
function validateFeatures(projects = []) {
  for (const project of projects) {
    const slots = project.slots || [];
    if (!slots.length) continue;
    const features = project.features || [];
    if (!features.length) {
      throw new Error(`ground-truth: project "${project.id}" has slots but no features[] declared`);
    }
    const ids = new Set(features.map((f) => f && f.id));
    for (const slot of slots) {
      if (!slot.feature) {
        throw new Error(`ground-truth: ${project.id}/${slot.id} declares no feature`);
      }
      if (!ids.has(slot.feature)) {
        throw new Error(
          `ground-truth: ${project.id}/${slot.id} names unknown feature "${slot.feature}"`
        );
      }
    }
  }
}

/**
 * A ledger row (modules/ledger.js buildLedger output) rendered as a slot
 * candidate. Ledger rows use their OWN kind vocabulary (repo|dataset|model —
 * "is this a repo we depend on, an answer-key dataset, or a model"), which is
 * a different question from the slot's own `kind` and must not be conflated
 * with it.
 */
function ledgerCandidate(row) {
  return {
    id: `ledger:${row.kind || "repo"}:${row.repo}`,
    title: row.repo,
    repo: row.repo,
    url: row.repo && row.repo.includes("/") ? `https://github.com/${row.repo}` : "",
    status: null,
    why: null,
    license: null,
    license_declared: null,
    gated: null,
    size_category: null,
    downloads: 0,
    source: "ledger",
    kind: row.kind || "repo",
    cost_tier: row.cost_tier || null,
    hardware_fit: row.hardware_fit || null,
    hardware_mib: Number.isInteger(row.hardware_mib) ? row.hardware_mib : null,
    state: row.state || null,
    score_total: row.score_total === undefined ? null : row.score_total,
    basis: (row.score && row.score.basis) || null,
  };
}

/**
 * One slot, as the page and the digest both read it. Extracted from
 * `buildGroundTruth`, which had grown past the 50-line cap in §10 of the plan;
 * the per-slot shape is the seam, and nothing about the row changed.
 */
function slotRow(slot, candidates, featuresById = new Map(), where = slot.id) {
  const runs = slot.ran || [];
  // The LAST run, by the order they were recorded. `null` when there are
  // none — an absence, not a zero.
  const last = runs.length ? runs[runs.length - 1] : null;
  const feature = slot.feature
    ? featuresById.get(slot.feature) || { id: slot.feature, label: slot.feature }
    : null;
  return {
    id: slot.id,
    instrument: slot.instrument || "",
    needs: slot.needs || "",
    kind: normalizeKind(slot.kind, where),
    feature,
    note: slot.note || null,
    language: slot.language || null,
    // A declared gap is a FINDING — "HF cannot supply this" is knowledge, and
    // it is the reason this slot is allowed to have no candidates.
    gap: slot.gap || null,
    // Did this slot say what it is ABOUT, or only what SHAPE of data it takes?
    // A slot with no declared subject matches on HuggingFace's task category
    // alone, and that is a shape signal: `image-to-text` covers OCR and
    // captioning as well as screenshot->code. Its candidates are a shortlist
    // to read, never answers, and the page has to say which kind it is showing.
    subject_declared: Boolean((slot.subject_any || []).length),
    // The sentence itself, so neither renderer writes its own copy of it.
    unvetted_caveat: (slot.subject_any || []).length ? null : UNVETTED_CAVEAT,
    runs: runs.length,
    last_ran: last
      ? {
          reference: last.reference || "",
          n: last.n === undefined ? null : last.n,
          number: last.number || "",
          // Never dropped. The caveat is what stops the number being quoted
          // as something it does not support.
          caveat: last.caveat || "",
          // The slot config writes `date`; `at` was the builder's own name for
          // it and matched nothing, so every recorded run rendered undated.
          at: last.at || last.date || null,
        }
      : null,
    candidates,
    counts: {
      candidates: candidates.length,
      runnable: candidates.filter((c) => c.status === "runnable").length,
      needs_you: candidates.filter((c) => c.status === "needs-you").length,
      rejected: candidates.filter((c) => c.status === "rejected").length,
    },
  };
}

/**
 * An item-sourced candidate. Index candidates by "project/slot" — the pair a
 * matched_slots entry names. A project-level topic match is NOT a slot match
 * and must never become one: that conflation is the whole reason the feed
 * filled with plausible rows that grade nothing.
 */
function indexItemCandidates(items, classify, refusal) {
  const byPair = new Map();
  for (const item of items) {
    const meta = (item && item.metadata) || {};
    for (const s of meta.matched_slots || []) {
      if (!s || !s.project || !s.slot) continue;
      const key = `${s.project}/${s.slot}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push({
        id: item.id,
        title: item.title || item.id,
        repo: item.title || item.id,
        url: item.url || "",
        status: classify(item),
        // WHY it is not runnable, asked of the gate rather than re-derived. A
        // reason computed a second time beside the gate printed "licence is not
        // permissive" next to an apache-2.0 row refused for its size.
        why: refusal(item),
        license: meta.license || null,
        license_declared: meta.license_declared === undefined ? null : meta.license_declared,
        gated: meta.gated === undefined ? null : meta.gated,
        size_category: meta.size_category || null,
        downloads: meta.downloads || 0,
        source: "items",
        kind: meta.kind || null,
        // H5: HF items carry none of this — the ledger is the only source for
        // it. Absent rather than a fabricated value.
        cost_tier: null,
        hardware_fit: null,
        hardware_mib: null,
        state: null,
        score_total: null,
        basis: null,
      });
    }
  }
  return byPair;
}

/**
 * Ledger rows, indexed the same way — by the "project/slot" the row itself
 * names. A row that names no slot (or a slot on another project) never
 * becomes a candidate anywhere; it may still be a paid-later PARK.
 *
 * A repo scored by TWO projects is one ledger row (modules/ledger.js keys on
 * the repo), and its top-level `slot` is single-valued — first-authored-wins
 * across whichever project's radar entry merged first. Reading `row.slot`
 * alone would show that ONE project's slot and silently drop every other
 * project's own binding for the same repo, however differently they named
 * it. `row.per_project[project].slot` is where the others survive, so every
 * project's own slot is indexed here — using THAT project's own cost/fit/
 * score/state, never the winning project's.
 */
function indexLedgerCandidates(ledgerRows) {
  const ledgerByPair = new Map();
  // Repo+kind+slot, so the row's own top-level slot and its echo inside
  // per_project (the SAME project's data, reached two ways) add one
  // candidate, not two.
  const seen = new Set();
  const add = (slot, candidate) => {
    if (!slot) return;
    const dedupeKey = `${slot}::${candidate.repo}::${candidate.kind}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    if (!ledgerByPair.has(slot)) ledgerByPair.set(slot, []);
    ledgerByPair.get(slot).push(candidate);
  };
  for (const row of ledgerRows) {
    if (!row) continue;
    if (row.slot) add(row.slot, ledgerCandidate(row));
    for (const fields of Object.values(row.per_project || {})) {
      if (fields && fields.slot) add(fields.slot, ledgerCandidate({ ...row, ...fields }));
    }
  }
  return ledgerByPair;
}

function indexNearMisses(nearMisses) {
  const missesByProject = new Map();
  for (const m of nearMisses) {
    if (!m || !m.project) continue;
    if (!missesByProject.has(m.project)) missesByProject.set(m.project, []);
    missesByProject.get(m.project).push({
      item_id: m.item_id,
      title: m.title || m.item_id,
      url: m.url || "",
      kind: m.kind || "dataset",
      reason: m.reason,
      seen_at: m.seen_at || null,
    });
  }
  return missesByProject;
}

/**
 * The paid-later PARK list has two sources that never overlap: a ledger row
 * (a repo/dataset/model, which always has a GitHub-shaped slug) and a slot's
 * own `paid_later[]` strings (a paid SERVICE with no such slug at all — an
 * analytics tool, a hosted eval platform). Ledger first, so its authored
 * `why` reads before the terser per-slot service strings.
 */
function collectParkedPaid(projects, ledgerRows) {
  const slotParkedPaid = [];
  for (const project of projects) {
    for (const slot of project.slots || []) {
      for (const text of slot.paid_later || []) {
        slotParkedPaid.push({ source: "slot", project: project.id, slot: slot.id, text });
      }
    }
  }
  const ledgerParkedPaid = ledgerRows
    .filter((r) => r && r.cost_tier === "paid-later")
    .map((r) => ({
      source: "ledger",
      repo: r.repo,
      kind: r.kind || "repo",
      projects: r.projects || [],
      why: r.why || "",
    }));
  return [...ledgerParkedPaid, ...slotParkedPaid];
}

function buildProjectTree(projects, byPair, ledgerByPair, missesByProject) {
  return projects.map((project) => {
    const featuresById = new Map((project.features || []).map((f) => [f && f.id, f]));
    const slots = (project.slots || []).map((slot) => {
      const key = `${project.id}/${slot.id}`;
      const candidates = [...(byPair.get(key) || []), ...(ledgerByPair.get(key) || [])];
      return slotRow(slot, candidates, featuresById, key);
    });
    const near_misses = missesByProject.get(project.id) || [];
    return {
      id: project.id,
      name: project.name || project.id,
      slots,
      near_misses,
      counts: {
        slots: slots.length,
        slots_with_a_run: slots.filter((s) => s.runs > 0).length,
        slots_never_run: slots.filter((s) => s.runs === 0).length,
        candidates: slots.reduce((n, s) => n + s.candidates.length, 0),
        near_misses: near_misses.length,
      },
    };
  });
}

function buildGroundTruth({
  projects = [],
  items = [],
  nearMisses = [],
  // H5: rows from modules/ledger.js buildLedger(). A row feeds a slot's
  // candidates when its own `slot` field names "project/slot"; every row
  // parked at cost_tier "paid-later" also feeds counts.parked_paid, whether
  // or not it names a slot at all.
  ledgerRows = [],
  classify = () => "needs-you",
  refusal = () => null,
  now = new Date(),
} = {}) {
  const byPair = indexItemCandidates(items, classify, refusal);
  const ledgerByPair = indexLedgerCandidates(ledgerRows);
  const missesByProject = indexNearMisses(nearMisses);

  const out = buildProjectTree(projects, byPair, ledgerByPair, missesByProject);

  const counts = countGroundTruth(out);
  counts.parked_paid = collectParkedPaid(projects, ledgerRows);
  counts.funnel = funnel(ledgerRows, { weeks: 8, now });

  return { projects: out, counts };
}

/** Derived from the rendered tree, so a headline cannot outrun its own table. */
function countGroundTruth(projects = []) {
  const slots = projects.flatMap((p) => p.slots);
  return {
    projects: projects.length,
    slots: slots.length,
    slots_with_a_run: slots.filter((s) => s.runs > 0).length,
    slots_never_run: slots.filter((s) => s.runs === 0).length,
    slots_recording_a_gap: slots.filter((s) => s.gap).length,
    candidates: slots.reduce((n, s) => n + s.candidates.length, 0),
    // Split, because the two are not the same claim: a candidate under a slot
    // that declared its subject cleared a subject gate; one under a slot that did
    // not is only the right SHAPE of data, and 22 of 23 such rows were measured
    // wrong on 2026-09-03 (Arabic book scans offered to a screenshot grader).
    candidates_vetted: slots.filter((s) => s.subject_declared).reduce((n, s) => n + s.candidates.length, 0),
    candidates_unvetted: slots.filter((s) => !s.subject_declared).reduce((n, s) => n + s.candidates.length, 0),
    slots_without_a_subject: slots.filter((s) => !s.subject_declared).length,
    runnable: slots.reduce((n, s) => n + s.counts.runnable, 0),
    needs_you: slots.reduce((n, s) => n + s.counts.needs_you, 0),
    near_misses: projects.reduce((n, p) => n + p.near_misses.length, 0),
    // Per normalized kind, so five ground-truth slots and one skill-eval slot
    // do not read as "six of the same instrument".
    by_kind: slots.reduce((acc, s) => {
      acc[s.kind] = (acc[s.kind] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  buildGroundTruth,
  countGroundTruth,
  validateFeatures,
  UNVETTED_CAVEAT,
  KIND_ALIASES,
  VALID_KINDS,
};
