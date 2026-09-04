/**
 * Digest sections split out of weekly-digest.js so that file stays under the
 * 500-line cap (H5). Every renderer here is pure — rows/data in, markdown
 * out, no IO, no config reads — same discipline as modules/ground-truth.js.
 * `buildGroundTruthDigestSection` (the one function that DOES read config
 * and the DB) stays in weekly-digest.js, which calls `formatGroundTruthSection`
 * below with the rows already loaded.
 *
 * Parked-paid has TWO sources, and both must show up in one list:
 *   ledger rows   a repo/dataset/model with cost_tier "paid-later" — has a
 *                 GitHub-shaped slug because a radar row requires one
 *   slot strings  a paid SERVICE with no owner/name slug at all (SEMrush,
 *                 Ahrefs, SimilarWeb, a paid Langfuse tier) — a slot's own
 *                 `paid_later: ["..."]` array in config/projects.json
 * These are exactly `counts.parked_paid` from modules/ground-truth.js,
 * distinguished by their `source` field; this file only renders them.
 */

/**
 * A title safe to use as MARKDOWN LINK TEXT — the single source both this
 * file and weekly-digest.js's own three link sites (renderItem, renderTLDR,
 * formatProjectSections) route through.
 *
 * HuggingFace ids and titles are written by anyone with an account and we
 * ingest them verbatim. A title containing `](` closes our link early and
 * opens its own: `[evil](https://attacker.example)[](https://huggingface.co/
 * datasets/x)` renders as a link labelled "evil" pointing wherever the
 * publisher chose. Measured 2026-09-03: 0 of 9,335 live titles carry `](`
 * and 11 carry a bare bracket (`[pdf]`, `[2026]`), so this is latent rather
 * than live — but the digest is a file the operator reads and clicks.
 *
 * Escaping the brackets is enough: with `]` escaped the link text cannot end
 * early. A renderer shows `\[pdf\]` as `[pdf]`, so benign titles are unchanged.
 */
function mdLinkText(s) {
  return String(s == null ? '' : s).replace(/([[\]])/g, '\\$1');
}

/** A ledger-sourced parked entry: repo, who depends on it, why it waits. */
function renderLedgerParked(p) {
  const who = p.projects && p.projects.length ? ` (${p.projects.join(", ")})` : "";
  return `- \`${p.repo}\`${who}${p.why ? ` — ${p.why}` : ""}`;
}

/** A slot-sourced parked entry: no repo at all, just a service and why. */
function renderSlotParked(p) {
  return `- \`${p.project}/${p.slot}\` — ${p.text}`;
}

function formatParkedPaidSection(parkedPaid = []) {
  const lines = ["", "### 💸 Parked: paid-later", ""];
  if (!parkedPaid.length) {
    lines.push("_nothing parked on cost this week_", "");
    return lines.join("\n");
  }
  for (const p of parkedPaid) {
    lines.push(p.source === "slot" ? renderSlotParked(p) : renderLedgerParked(p));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * One line: totals across the requested window, per ledger funnel stage —
 * summed over `funnelData.weeks` only ("undated" rows are a separate bucket
 * `funnel()` returns and are deliberately not part of this window's total).
 */
function formatFunnelSection(funnelData) {
  const weeks = (funnelData && funnelData.weeks) || [];
  const counts = (funnelData && funnelData.counts) || {};
  if (!weeks.length) return "";
  const totals = { proposed: 0, accepted: 0, trial: 0, done: 0, rejected: 0 };
  for (const wk of weeks) {
    const c = counts[wk] || {};
    for (const stage of Object.keys(totals)) totals[stage] += c[stage] || 0;
  }
  const strip = Object.entries(totals)
    .map(([stage, n]) => `${stage} ${n}`)
    .join(" → ");
  return `\n_Funnel, last ${weeks.length} weeks (${weeks[0]}..${weeks[weeks.length - 1]}): ${strip}_\n`;
}

/**
 * One candidate line. Item-sourced candidates carry a RUNNABLE/NEEDS-YOU
 * verdict from the cheap-run gate; ledger-sourced ones carry no such verdict
 * at all (a ledger row is a DECISION, not a run) — they show cost/fit/state/
 * score instead. Mislabeling a ledger row "NEEDS YOU" from a null status was
 * the trap here: check `source`, never fall through on a missing field.
 */
function renderCandidateLine(c) {
  const head = `    - [${mdLinkText(c.title)}](${c.url})`;
  if (c.source === 'ledger') {
    const cost = c.cost_tier ? `cost \`${c.cost_tier}\`` : null;
    const fit = c.hardware_fit
      ? `fit \`${c.hardware_fit}\`${c.hardware_mib ? ` (${c.hardware_mib} MiB)` : ''}`
      : null;
    const score = c.score_total === null || c.score_total === undefined ? null : `score ${c.score_total}`;
    const basis = c.basis ? `(${c.basis})` : '';
    const bits = [cost, fit, c.state ? `state \`${c.state}\`` : null, score].filter(Boolean).join(' · ');
    return `${head}${bits ? ` — ${bits}` : ''}${score ? ` ${basis}` : ''}`;
  }
  return (
    `${head} · ${(c.downloads || 0).toLocaleString()} downloads · ` +
    `licence \`${c.license || 'UNDECLARED'}\`` +
    (c.size_category ? ` · ${c.size_category}` : '') +
    ` — **${c.status === 'runnable' ? 'RUNNABLE' : 'NEEDS YOU'}**` +
    (c.why ? ` (${c.why})` : '')
  );
}

/** One slot's block of lines: head + last-run/gap/never + candidates. */
function formatSlotLines(s) {
  const lines = [];
  // Shape, not colour: ● ran · ◇ never · — a declared gap.
  const mark = s.runs > 0 ? '●' : s.gap ? '—' : '◇';
  const head = `- ${mark} \`${s.kind}\` \`${s.id}\`` + (s.instrument ? ` (\`${s.instrument}\`)` : '');
  if (s.last_ran) {
    const ref = [s.last_ran.reference, s.last_ran.n ? `n=${s.last_ran.n}` : null, s.last_ran.at]
      .filter(Boolean)
      .join(' · ');
    lines.push(`${head} — **${s.last_ran.number || 'ran'}**${ref ? ` · ${ref}` : ''}`);
    // The caveat is never dropped. It is what stops the number being quoted
    // as something it does not support.
    if (s.last_ran.caveat) lines.push(`    - _${s.last_ran.caveat}_`);
  } else if (s.gap) {
    lines.push(`${head} — _gap: ${s.gap}_`);
  } else {
    lines.push(`${head} — **never checked**`);
  }
  // Same claim the page makes, from the same builder: a slot that never said
  // what it is about matched on HuggingFace's task category alone, which is a
  // SHAPE signal. Unsaid, the list reads as answers.
  if (s.candidates.length && !s.subject_declared) {
    lines.push(`    - _${s.unvetted_caveat}_`);
  }
  for (const c of s.candidates.slice(0, 5)) lines.push(renderCandidateLine(c));
  if (s.candidates.length > 5) lines.push(`    - _+${s.candidates.length - 5} more candidates_`);
  return lines;
}

/** One project's section: heading + every slot's lines + its near misses. */
function formatProjectLines(p) {
  const lines = [`### ${p.name}`];
  if (!p.slots.length) lines.push('- _no instrument declared for this project yet_');
  for (const s of p.slots) lines.push(...formatSlotLines(s));
  if (p.near_misses.length) {
    // Not a defect: this is the corpus for the next slot, and the reason names
    // the gate that refused it.
    lines.push(`- _near misses (${p.near_misses.length}): ` +
      p.near_misses.slice(0, 5).map((n) => `${n.title} — ${n.reason}`).join(' · ') + '_');
  }
  lines.push('');
  return lines;
}

/**
 * The weekly ground-truth section - one row per INSTRUMENT, not per project.
 * Reads modules/ground-truth.js, the SAME builder public/ground-truth.html
 * reads. Two renderers, one builder: a section with its own tally could
 * report a different week from the page and both would look right.
 */
function formatGroundTruthSection(items, projects, nearMisses = [], ledgerRows = []) {
  const HuggingFaceModule = require('./huggingface');
  const { buildGroundTruth } = require('./ground-truth');
  const hf = new HuggingFaceModule({ id: 'huggingface', config: {} });

  const { projects: tree, counts } = buildGroundTruth({
    projects: projects || [],
    items: items || [],
    nearMisses: nearMisses || [],
    ledgerRows: ledgerRows || [],
    // Anything the cheap-run gate refuses needs the operator: terms to accept, or
    // a card to rule. The gate fails closed, so an unknown lands here.
    classify: (item) => (hf.isCheapRun(item) ? 'runnable' : 'needs-you'),
    refusal: (item) => hf.cheapRunRefusal(item),
  });

  const lines = [
    '',
    '## 🔬 External ground truth — what checks each instrument',
    '',
    `_${counts.slots} instruments · ${counts.slots_with_a_run} have a number · ` +
      `**${counts.slots_never_run} never checked** · ${counts.slots_recording_a_gap} recorded gap · ` +
      `${counts.near_misses} near misses` +
      (counts.candidates_unvetted ? ` · **${counts.candidates_unvetted} candidates are shape-only**` : '') + '_',
    '',
  ];

  for (const p of tree) lines.push(...formatProjectLines(p));
  if (!tree.length) lines.push('- _no projects declare an instrument yet_', '');

  // Parked-paid merges both sources (ledger rows + slot paid_later[]
  // strings) already — see modules/ground-truth.js's own doc comment on
  // `counts.parked_paid` for why a paid SERVICE with no GitHub slug still
  // has to show up here.
  lines.push(formatParkedPaidSection(counts.parked_paid));
  lines.push(formatFunnelSection(counts.funnel));

  return lines.join('\n');
}

module.exports = {
  formatParkedPaidSection,
  formatFunnelSection,
  formatGroundTruthSection,
  mdLinkText,
};
