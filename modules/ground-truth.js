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
const UNVETTED_CAVEAT =
  "this slot has not said what it is about - the rows below are the right SHAPE of data, not vetted answer keys";

/**
 * One slot, as the page and the digest both read it. Extracted from
 * `buildGroundTruth`, which had grown past the 50-line cap in §10 of the plan;
 * the per-slot shape is the seam, and nothing about the row changed.
 */
function slotRow(slot, candidates) {
  const runs = slot.ran || [];
  // The LAST run, by the order they were recorded. `null` when there are
  // none — an absence, not a zero.
  const last = runs.length ? runs[runs.length - 1] : null;
  return {
    id: slot.id,
    instrument: slot.instrument || "",
    needs: slot.needs || "",
    kind: slot.kind || "dataset",
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

function buildGroundTruth({ projects = [], items = [], nearMisses = [], classify = () => "needs-you", refusal = () => null } = {}) {
  // Index candidates by "project/slot" — the pair a matched_slots entry names.
  // A project-level topic match is NOT a slot match and must never become one:
  // that conflation is the whole reason the feed filled with plausible rows that
  // grade nothing.
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
      });
    }
  }

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

  const out = projects.map((project) => {
    const slots = (project.slots || []).map((slot) =>
      slotRow(slot, byPair.get(`${project.id}/${slot.id}`) || []));
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

  return { projects: out, counts: countGroundTruth(out) };
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
  };
}

module.exports = { buildGroundTruth, countGroundTruth, UNVETTED_CAVEAT };
