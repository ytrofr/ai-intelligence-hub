/**
 * Adoption Matrix — render. Pure DOM-building from the /api/adoption-matrix
 * JSON shape (modules/adoption-matrix.js). No framework, no external assets.
 *
 * Every state that matters is a SHAPE (a glyph, a filled/open circle), never
 * colour alone — the operator who reads this page is colour-blind.
 */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const FILLED = "●"; // ●
const OPEN = "○"; // ○

/** A 1-5 dimension as a 5-cell glyph bar. `null` (unscored) reads as a flat dash. */
function bar(v) {
  if (!Number.isInteger(v)) return `<span class="muted">-----</span>`;
  return FILLED.repeat(v) + OPEN.repeat(5 - v);
}

function basisMark(basis) {
  if (basis === "measured") return `<span class="mk ok">&#10003; measured</span>`;
  if (basis === "estimated") return `<span class="mk warn">&#9650; estimated</span>`;
  return `<span class="muted">-</span>`;
}

/** Permissive on purpose: cost_tier/hardware_fit carry free text, not a fixed
 * enum, so this reads the common cases and falls back to the raw string
 * rather than pretending to classify something it cannot. */
function tierMark(tier, { okWord, warnWord, badWord }) {
  const t = String(tier || "").toLowerCase();
  if (!t) return `<span class="muted">-</span>`;
  if (t === okWord) return `<span class="mk ok">&#10003; ${esc(t)}</span>`;
  if (t.includes(badWord)) return `<span class="mk bad">&#10007; ${esc(t)}</span>`;
  if (t.includes(warnWord) || t === "unmeasured") return `<span class="mk warn">&#9650; ${esc(t)}</span>`;
  return `<span class="mk neu">${esc(t)}</span>`;
}

const costMark = (tier) => tierMark(tier, { okWord: "free", warnWord: "free-tier", badWord: "paid" });
const fitMark = (fit) => tierMark(fit, { okWord: "fits-cpu", warnWord: "unmeasured", badWord: "too-big" });

function featuresCell(features) {
  if (!features || !features.length) return `<span class="muted">-</span>`;
  return features
    .map((f) => `<span class="chip${f.label === "(undeclared)" ? " undeclared" : ""}">${esc(f.label)}</span>`)
    .join(" ");
}

function stateCell(row) {
  const warn = row.state === "accepted-without-evidence" ? `<span class="mk bad">&#9888;</span> ` : "";
  return `${warn}<span class="st">${esc(row.state)}</span>`;
}

/** One <tr> for a candidate row. `withProject` adds the project column, used
 * by the cross-project Top 10 / Unscored / Parked tables. */
function rowHtml(r, { withProject } = {}) {
  const href =
    r.kind === "dataset" ? `https://huggingface.co/datasets/${esc(r.repo)}`
    : r.kind === "model" ? `https://huggingface.co/${esc(r.repo)}`
    : `https://github.com/${esc(r.repo)}`;
  const badge = r.kind && r.kind !== "repo" ? `<span class="kind">${esc(r.kind)}</span>` : "";
  const projectCell = withProject ? `<td class="proj">${esc(r.project)}</td>` : "";
  return `<tr>
    <td class="repo">${badge}<a href="${href}" target="_blank" rel="noopener">${esc(r.repo)}</a></td>
    ${projectCell}
    <td class="touches">${featuresCell(r.features)}${r.slot ? `<div class="slot">${esc(r.slot)}</div>` : ""}</td>
    <td class="dim">${bar(r.effort)}</td>
    <td class="dim">${bar(r.effect)}</td>
    <td class="dim">${bar(r.time)}</td>
    <td class="dim">${bar(r.impact)}</td>
    <td class="dim">${bar(r.risk)}</td>
    <td class="score">${typeof r.total === "number" ? r.total : `<span class="muted">unscored</span>`}</td>
    <td>${basisMark(r.basis)}</td>
    <td>${costMark(r.cost_tier)}</td>
    <td>${fitMark(r.hardware_fit)}</td>
    <td>${stateCell(r)}<div class="next">${esc(r.next_action)}</div></td>
  </tr>`;
}

function headRow(withProject) {
  return `<tr>
    <th>Candidate</th>
    ${withProject ? "<th>Project</th>" : ""}
    <th>What it touches</th>
    <th>Effort</th><th>Effect</th><th>Time</th><th>Impact</th><th>Risk</th>
    <th>Score</th><th>Basis</th><th>Cost</th><th>Fit</th><th>Next</th>
  </tr>`;
}

function table(rows, { withProject, emptyText }) {
  const cols = withProject ? 13 : 12;
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
    { k: "estimated", n: pop.estimated },
    { k: "undeclared feature", n: pop.undeclared_features, gap: pop.undeclared_features > 0 },
  ];
  return cells
    .map((x) => `<div class="count${x.gap ? " gap" : ""}"><span class="n">${x.n}</span><span class="k">${esc(x.k)}</span></div>`)
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
    emptyText: "Nothing scored yet — every candidate below is still unscored.",
  });

  document.getElementById("projects").innerHTML = data.projects.map(renderProjectSection).join("");

  document.getElementById("unscored").innerHTML = table(data.unscored, {
    withProject: true,
    emptyText: "Nothing unscored — every candidate has a complete score.",
  });

  document.getElementById("parked").innerHTML = table(data.parked_paid, {
    withProject: true,
    emptyText: "Nothing parked on a paid tier.",
  });
}

if (typeof module !== "undefined") module.exports = { renderMatrix, bar, basisMark, costMark, fitMark };
