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
    // The numerator AND its denominator, side by side. A count with no
    // population is how "42 candidates" read as "42 things we use".
    { k: "candidates", n: pop.rows },
    { k: "of pairs", n: pop.pairs },
    { k: "ledger rows", n: pop.ledger_rows },
    { k: "not shown", n: pop.hidden, gap: pop.hidden > 0 },
    { k: "adopted unscored", n: pop.adopted_unscored, gap: pop.adopted_unscored > 0 },
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

/**
 * The rows the filter removes. `isMatrixEligible` is the right filter - what
 * was wrong is that it used to leave no trace, so "42 candidates" had no
 * denominator anywhere on the page and nobody could ask what the rest were.
 *
 * Three tables, most actionable first. The first is the one that costs
 * something: a repo a project ADOPTED and never scored, counted per candidate
 * rather than per merged row, because first-authored-wins puts one project's
 * score on the shared row and would hide the other project's blind adoption.
 */
function hiddenRow(r) {
  return `<tr>
    <td class="k">${esc(r.repo)}</td>
    <td class="k">${esc(r.kind)}</td>
    <td class="k">${esc(r.project)}</td>
    <td>${esc(r.state || "-")}</td>
  </tr>`;
}

function hiddenTable(rows, emptyText) {
  if (!rows.length) return `<p class="empty-note">${esc(emptyText)}</p>`;
  return `<div class="tablewrap"><table class="hidden-t">
    <thead><tr><th>repo</th><th>kind</th><th>project</th><th>state</th></tr></thead>
    <tbody>${rows.map(hiddenRow).join("")}</tbody></table></div>`;
}

function renderHidden(data) {
  const pop = data.population;
  const hidden = data.hidden || [];
  const adopted = data.adopted_unscored || [];
  const decided = hidden.filter((r) => r.hidden_class === "decided");
  const deps = hidden.filter((r) => r.hidden_class === "dependency");
  return `<details class="drawer">
    <summary>
      The ${pop.hidden} pairs this page does not show
      <span class="count-badge">${pop.hidden_decided} decided &middot; ${pop.hidden_dependency} plain deps</span>
    </summary>
    <h3>Adopted, and never scored <span class="n">${adopted.length}</span></h3>
    <p class="section-hint">A project took it and recorded no score. Counted per candidate, not
      per merged row - a repo one project scored and another adopted blind is one of these,
      and counting on the merged row would hide exactly that. This list CROSSES the two below
      rather than partitioning with them: a row here also appears in whichever of them it
      belongs to, so the three counts deliberately do not sum to the total.</p>
    ${hiddenTable(adopted, "Nothing adopted without a score.")}
    <h3>Decided, bound to nothing <span class="n">${decided.length}</span></h3>
    <p class="section-hint">Somebody ruled on it, and it names no slot, no feature and no score -
      so there is nothing for this page to rank.</p>
    ${hiddenTable(decided, "Nothing decided-but-unbound.")}
    <h3>Plain dependencies <span class="n">${deps.length}</span></h3>
    <p class="section-hint">The manifests say we use it and this project never proposed it -
      ${pop.hidden_dependency} pairs across ${pop.hidden_dependency_repos} distinct repos, because a package three
      projects use is three pairs. Compare with the Stack Ledger's own row-level
      <code>unexplained</code>: the two need not match, since a repo one project decided and
      another merely depends on is a dependency here and an explained row there.</p>
    ${hiddenTable(deps, "No plain dependencies.")}
  </details>`;
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
  const pop = data.population;
  document.getElementById("counts").innerHTML = renderCounts(pop);

  // Derived from the payload, never typed into the page - a hand-written
  // denominator is the first thing to go stale, and nobody re-checks it.
  const den = document.getElementById("denominator");
  if (den) {
    den.innerHTML =
      `<b>${pop.rows}</b> candidates out of <b>${pop.pairs}</b> (repo &times; project) pairs, ` +
      `drawn from <b>${pop.ledger_rows}</b> rows in the Stack Ledger. The other ` +
      `<b>${pop.hidden}</b> are in the drawer at the bottom: <b>${pop.hidden_dependency}</b> are ` +
      `plain dependencies nobody proposed, <b>${pop.hidden_decided}</b> were decided and bound to ` +
      `nothing. <b>${pop.adopted_unscored}</b> were adopted by a project that never scored them.`;
  }

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

  document.getElementById("hidden").innerHTML = renderHidden(data);
}

if (typeof module !== "undefined") {
  module.exports = { renderMatrix, renderHidden, DIMS, favour, band, scoreBand, dimCell, basisChip, licenceChip, costChip, fitChip, chip };
}
