/**
 * Adoption queue — the weekly-digest section that says, per project, what to
 * run next. Monday is when the digest is read, so Monday is when the queue
 * refreshes: nothing here is typed, it is the scorecard read back.
 *
 * Reads buildScorecard (RAW radar rows, one file per project) so the digest
 * and /p/<id>/scorecard can never disagree, and so a bench run on project A
 * is never quoted under project B (one bench per project, operator 2026-09-05).
 *
 * Three buckets per project, in the order they need attention:
 *   ⛔ run it or drop it   — accepted/trial before the bench gate, still no bench
 *   👀 measured            — a bench on this project's data, waiting on a verdict
 *   ▶ ready to bench       — judged ADOPT on paper, nothing run yet
 * Everything else proposed (WATCH/SKIP, unscored) is a count, not a list: a
 * row nobody has named a slot for is not queued, it is backlog.
 */

const { buildScorecard } = require("./adoption-scorecard");
const { CLOSED } = require("./ledger");

const HEADING = "## 🧭 Adoption queue — what to run next";
const PER_LIST = 6;
const CLIP = 140;

const clip = (s) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > CLIP ? `${t.slice(0, CLIP - 1)}…` : t;
};
// A repo name is rendered as text, never as a link label: the digest already
// proved a title containing `](` can open its own link (weekly-digest tests).
const plain = (s) => String(s || "").replace(/[\[\]()]/g, "");
const day = (iso) => (iso ? String(iso).slice(0, 10) : "undated");

function bucketsOf(rows) {
  const open = rows.filter((r) => !CLOSED.has(r.status));
  const debt = open.filter((r) => r.legacy_unbenched);
  const measured = open.filter((r) => !r.legacy_unbenched && r.measure === "measured");
  const ready = open.filter((r) => !r.legacy_unbenched && r.measure !== "measured" && r.verdict === "ADOPT");
  return { open, debt, measured, ready, rest: open.length - debt.length - measured.length - ready.length };
}

function list(lines, title, rows, render, perList) {
  if (!rows.length) return;
  lines.push(`**${title}** (${rows.length})`, "");
  for (const r of rows.slice(0, perList)) lines.push(`- ${render(r)}`);
  if (rows.length > perList) lines.push(`- … ${rows.length - perList} more on the scorecard`);
  lines.push("");
}

function projectSection(p, perList) {
  const b = bucketsOf(p.rows);
  const lines = [`### ${p.name} — \`/p/${p.id}/scorecard\``, ""];
  if (!p.rows.length) return [...lines, "- _no candidates on this project's radar_", ""];
  if (!b.open.length) return [...lines, `- _nothing open — ${p.rows.length} closed_`, ""];
  list(lines, "⛔ Run it or drop it — taken before the bench gate, no bench on this project", b.debt,
    (r) => `${plain(r.repo)} — ${r.status} · ${r.verdict} · last touched ${day(r.updated_at)}`, perList);
  list(lines, "👀 Measured on this project — waiting on a verdict", b.measured,
    (r) => `${plain(r.repo)} — bench ${day(r.bench && r.bench.date)}: ${clip(r.bench && r.bench.result)} → **${r.next}**`, perList);
  list(lines, "▶ Ready to bench — judged ADOPT on paper, nothing run", b.ready,
    (r) => `${plain(r.repo)} — ${clip(r.why) || "no why recorded"}`, perList);
  if (b.rest > 0) lines.push(`- ${b.rest} more proposed (WATCH/SKIP or unscored): backlog, not queued`, "");
  return lines;
}

function formatAdoptionQueueSection(scorecard, { perList = PER_LIST } = {}) {
  const pop = scorecard.population;
  const lines = ["", HEADING, "",
    `> ${pop.rows} rows across ${pop.projects} projects · ${pop.measured} measured on their own data · ` +
    `${pop.estimated} scored by estimate · ${pop.not_run} never run · ${pop.legacy_unbenched} taken before the ` +
    `bench gate and still unbenched. A bench counts for ONE project; \`accepted\` needs one (radar-store, 2026-09-05). ` +
    `Front door: \`/adopt <repo> <project>\`.`, ""];
  for (const p of scorecard.projects) lines.push(...projectSection(p, perList));
  return lines.join("\n") + "\n";
}

/** Same failure contract as the ground-truth section: a failed section is
 *  printed as failed, never silently missing and never fatal to the digest. */
function buildAdoptionQueueDigestSection() {
  try {
    const { readAllRadarRows, readProjects } = require("../routes/lib/hub-sources");
    return formatAdoptionQueueSection(buildScorecard({ radarRows: readAllRadarRows(), projects: readProjects() }));
  } catch (err) {
    return `\n${HEADING}\n\n- _section failed: ${err.message}_\n`;
  }
}

module.exports = { formatAdoptionQueueSection, buildAdoptionQueueDigestSection, HEADING };
