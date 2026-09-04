/**
 * Adoption Matrix - render. Pure DOM-building from the /api/adoption-matrix
 * JSON shape (modules/adoption-matrix.js). No framework, no external assets.
 *
 * Two rules govern every cell here:
 *
 * 1. Colour shows FAVOURABILITY, never magnitude. Risk 5 and Impact 5 are the
 *    same number and opposite news, and the old page drew them identically -
 *    five filled circles either way - so the table could not be read without
 *    remembering which columns invert. Each dimension declares its direction
 *    once (DIMS below) and every cell is coloured by "how good is this", not
 *    "how big is this".
 *
 * 2. Colour is never the only channel. The operator who reads this page cannot
 *    reliably tell red from green, so every mark carries a distinct SHAPE and a
 *    WORD as well, and the ramp runs teal -> amber -> orange rather than
 *    green -> red: those two are the pair that collapses for the common form of
 *    colour blindness, and blue-side teal against orange survives it.
 */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The five score dimensions and which way is good. `better: -1` means a LOW
 * number is the favourable one - effort, time and risk are all costs. */
const DIMS = [
  { key: "effort", label: "Effort", better: -1 },
  { key: "effect", label: "Effect", better: +1 },
  { key: "time", label: "Time", better: -1 },
  { key: "impact", label: "Impact", better: +1 },
  { key: "risk", label: "Risk", better: -1 },
];

/** 1-5 raw value -> 1-5 favourability, inverting the cost dimensions. */
function favour(value, better) {
  if (!Number.isInteger(value)) return null;
  return better < 0 ? 6 - value : value;
}

/** Three bands, not five: a 5-step hue ramp is unreadable, and the exact value
 * is already carried by the bar length and the digit beside it. */
function band(fav) {
  if (fav === null) return "none";
  if (fav >= 4) return "good";
  if (fav === 3) return "mid";
  return "poor";
}

/** One dimension cell: a 5-segment bar whose FILLED length is the raw value and
 * whose colour is the favourability, plus the digit so the number survives any
 * rendering of the colour at all. */
function dimCell(value, better) {
  if (!Number.isInteger(value)) return `<td class="dim"><span class="muted">-</span></td>`;
  const b = band(favour(value, better));
  const seg = [1, 2, 3, 4, 5]
    .map((i) => `<i class="${i <= value ? "on" : "off"}"></i>`)
    .join("");
  return `<td class="dim"><span class="minibar b-${b}">${seg}</span><span class="dimn b-${b}">${value}</span></td>`;
}

/** Score band thresholds are absolute, not a ranking: 80 means "strong on every
 * axis at once", and a table where the top row is always green would say
 * nothing. Documented in the page footer so the reader can check them. */
function scoreBand(total) {
  if (typeof total !== "number") return "none";
  if (total >= 80) return "good";
  if (total >= 65) return "mid";
  return "poor";
}

function scoreCell(total) {
  if (typeof total !== "number") return `<td class="score"><span class="muted">unscored</span></td>`;
  const b = scoreBand(total);
  return `<td class="score"><span class="sn b-${b}">${total}</span><span class="sbar"><i class="b-${b}" style="width:${total}%"></i></span></td>`;
}

/** Every status chip on the page goes through here, so a shape and a word are
 * structurally impossible to omit. */
function chip(level, word, title) {
  const glyph = { good: "&#10003;", warn: "&#9650;", bad: "&#10007;", none: "?" }[level] || "?";
  const t = title ? ` title="${esc(title)}"` : "";
  return `<span class="chip b-${level}"${t}><span class="g">${glyph}</span>${esc(word)}</span>`;
}

function basisChip(basis) {
  if (basis === "measured") return chip("good", "measured", "a real run, with a report behind it");
  if (basis === "estimated") return chip("warn", "estimated", "scored by judgement - not run yet");
  return `<span class="muted">-</span>`;
}

/** Read from the artifact's own LICENSE, classified server-side against the
 * permissive allowlist in modules/slot-gate.js - so an unrecognised licence is
 * flagged rather than passed. */
function licenceChip(licence, klass) {
  if (klass === "permissive") return chip("good", licence, "on the permissive allowlist");
  if (klass === "restricted") return chip("bad", licence, "read, and NOT on the permissive allowlist - check before adopting");
  return chip("none", "not read", "nobody has read this licence yet");
}

/** cost_tier/hardware_fit carry a small enum but not a closed one, so an
 * unforeseen value renders as itself rather than being classified wrongly. */
function tierChip(tier, { good, warn, bad }) {
  const t = String(tier || "").toLowerCase();
  if (!t) return `<span class="muted">-</span>`;
  if (good.includes(t)) return chip("good", t);
  if (bad.some((x) => t.includes(x))) return chip("bad", t);
  if (warn.some((x) => t.includes(x))) return chip("warn", t);
  return `<span class="chip b-none">${esc(t)}</span>`;
}

const costChip = (tier) => tierChip(tier, { good: ["free"], warn: ["free-tier"], bad: ["paid"] });

function fitChip(fit, mib) {
  const size = Number.isInteger(mib) ? ` ${mib >= 1024 ? (mib / 1024).toFixed(1) + " GiB" : mib + " MiB"}` : "";
  const base = tierChip(fit, { good: ["fits-cpu", "fits-gpu"], warn: ["unmeasured"], bad: ["too-big"] });
  return size ? `<span class="fitwrap">${base}<span class="size">${esc(size.trim())}</span></span>` : base;
}

/** The whole point of the row: what this candidate would make better, in the
 * project's own words. Never a chip grid - these are sentences, and boxing each
 * one turned a readable line into a stack of narrow cards. */
function improvesCell(r) {
  const labels = (r.features || []).map((f) => f.label);
  const body = labels.length
    ? labels.map((l) => `<span class="imp${l === "(undeclared)" ? " undeclared" : ""}">${esc(l)}</span>`).join('<span class="sep"> &middot; </span>')
    : `<span class="muted">nothing declared yet</span>`;
  const slot = r.slot ? `<div class="slot">${esc(r.slot)}</div>` : "";
  const note = r.note ? `<div class="note">${esc(r.note)}</div>` : "";
  return `<td class="improves">${body}${slot}${note}</td>`;
}

/** Candidate name and owner on two lines, so one 44-character slug can no
 * longer set the width of the column for all thirty rows. */
function candidateCell(r) {
  const href =
    r.kind === "dataset" ? `https://huggingface.co/datasets/${esc(r.repo)}`
    : r.kind === "model" ? `https://huggingface.co/${esc(r.repo)}`
    : `https://github.com/${esc(r.repo)}`;
  const slash = String(r.repo).indexOf("/");
  const owner = slash > 0 ? String(r.repo).slice(0, slash) : "";
  const name = slash > 0 ? String(r.repo).slice(slash + 1) : String(r.repo);
  const badge = r.kind && r.kind !== "repo" ? `<span class="kind">${esc(r.kind)}</span>` : "";
  return `<td class="cand">
    <a href="${href}" target="_blank" rel="noopener" title="${esc(r.repo)}">${esc(name)}</a>
    <div class="owner">${badge}${esc(owner)}</div>
  </td>`;
}

function stateCell(r) {
  const warn = r.state === "accepted-without-evidence" ? `${chip("bad", "no evidence")} ` : "";
  return `<td class="nextcol">${warn}<span class="st">${esc(r.state)}</span><div class="next">${esc(r.next_action)}</div></td>`;
}

function rowHtml(r, { withProject } = {}) {
  return `<tr>
    ${candidateCell(r)}
    ${withProject ? `<td class="proj">${esc(r.project)}</td>` : ""}
    ${improvesCell(r)}
    ${scoreCell(r.total)}
    ${DIMS.map((d) => dimCell(r[d.key], d.better)).join("")}
    <td class="checks">${basisChip(r.basis)}${licenceChip(r.licence, r.licence_class)}${costChip(r.cost_tier)}${fitChip(r.hardware_fit, r.hardware_mib)}</td>
    ${stateCell(r)}
  </tr>`;
}

/** The arrow in each dimension header is load-bearing: it is the only place the
 * page says which direction is the good one. */
function headRow(withProject) {
  const dims = DIMS.map((d) => `<th class="dimh">${d.label}<span class="arrow">${d.better < 0 ? "&darr;" : "&uarr;"}</span></th>`).join("");
  return `<tr>
    <th class="cand-h">Candidate</th>
    ${withProject ? '<th class="proj-h">Project</th>' : ""}
    <th>What it improves</th>
    <th class="score-h">Score</th>
    ${dims}
    <th class="checks-h">Checks</th>
    <th class="next-h">Next</th>
  </tr>`;
}

function table(rows, { withProject, emptyText }) {
  const cols = withProject ? 12 : 11;
  const body = rows.length
    ? rows.map((r) => rowHtml(r, { withProject })).join("")
    : `<tr><td colspan="${cols}" class="empty">${esc(emptyText)}</td></tr>`;
  return `<table><thead>${headRow(withProject)}</thead><tbody>${body}</tbody></table>`;
}

function renderCounts(pop) {
  const cells = [
    { k: "candidates", n: pop.rows },
    { k: "scored", n: pop.scored },
    { k: "unscored", n: pop.unscored, gap: pop.unscored > 0 },
    { k: "measured", n: pop.measured },
    { k: "estimated", n: pop.estimated, gap: pop.estimated > 0 },
    { k: "licence read", n: pop.licence_read },
    { k: "licence restricted", n: pop.licence_restricted, gap: pop.licence_restricted > 0 },
    { k: "undeclared feature", n: pop.undeclared_features, gap: pop.undeclared_features > 0 },
  ];
  return cells
    .map((x) => `<div class="count${x.gap ? " gap" : ""}"><span class="n">${x.n == null ? "-" : x.n}</span><span class="k">${esc(x.k)}</span></div>`)
    .join("");
}

function renderProjectSection(p) {
  const open = p.rows.length > 0 ? " open" : "";
  return `<details class="proj-block"${open}>
    <summary>${esc(p.name)} <span class="count-badge">${p.rows.length}</span></summary>
    ${table(p.rows, { withProject: false, emptyText: "Nothing eligible for this project yet." })}
  </details>`;
}

/** Everything the page shows, built from one JSON payload. */
function renderMatrix(data) {
  document.getElementById("counts").innerHTML = renderCounts(data.population);

  document.getElementById("top").innerHTML = table(data.top, {
    withProject: true,
    emptyText: "Nothing scored yet - every candidate below is still unscored.",
  });

  document.getElementById("projects").innerHTML = data.projects.map(renderProjectSection).join("");

  document.getElementById("unscored").innerHTML = table(data.unscored, {
    withProject: true,
    emptyText: "Nothing unscored - every candidate has a complete score.",
  });

  document.getElementById("parked").innerHTML = table(data.parked_paid, {
    withProject: true,
    emptyText: "Nothing parked on a paid tier.",
  });
}

if (typeof module !== "undefined") {
  module.exports = { renderMatrix, DIMS, favour, band, scoreBand, dimCell, basisChip, licenceChip, costChip, fitChip, chip };
}
