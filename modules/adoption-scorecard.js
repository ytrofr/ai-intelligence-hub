/**
 * Adoption Scorecard — per project: what was MEASURED on that project's own
 * data, what was only ESTIMATED, what was never run, the operator's verdict,
 * and the lesson.
 *
 * Operator, 2026-09-05: "i want to be sure we test and measure everything per
 * project before we adopt so we base it on measure and data and insights and
 * not guess." The store enforces the first half (routes/lib/radar-store.js:
 * accepted/trial need a bench on the project's own row). This module is the
 * "insights" half: the same rows, read back per project, nothing typed twice.
 *
 * It reads RAW radar rows — one file per project, one row per (project, repo)
 * — and NOT the merged ledger row. The ledger keys on the repo and merges
 * first-authored-wins, which is exactly how project B would end up wearing
 * project A's bench. Here a repo two projects ruled on is two rows, and each
 * carries only what its own project recorded.
 *
 * `state` is the ledger's own deriveState (imported, never re-implemented), so
 * "accepted-without-evidence" and "done-unseen" mean the same thing on every
 * page. `score_total` is the ledger's scoreTotal for the same reason.
 */

const { deriveState, scoreTotal } = require("./ledger");

const SCORE_DIMS = ["effort", "effect", "time", "impact", "risk"];
const ADOPTING = new Set(["accepted", "trial"]);
const CLOSED = new Set(["done", "rejected"]);
// Sort order inside a project, after the legacy debt: what is running first,
// then what was taken, then the backlog, then the closed.
const STATUS_ORDER = { trial: 0, accepted: 1, proposed: 2, done: 3, rejected: 4 };
const EYEBALLED_RE = /^(adopt|reject|not-yet)\s+(\S+)$/i;

const text = (v) => (typeof v === "string" ? v.trim() : "");
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const orNull = (v) => (text(v) ? text(v) : null);

function isCompleteScore(score) {
  return !!score && typeof score === "object" && SCORE_DIMS.every((d) => Number.isInteger(score[d]));
}

/**
 * Three states, never two. A bench IS the measurement: a score whose `basis`
 * says "measured" but has no bench behind it is a claim, and reads as
 * estimated here. (The store refuses that combination on write; a hand-edited
 * file can still carry it, and the page must not believe the label over the
 * artifact.)
 */
function measureOf(row) {
  if (obj(row.bench)) return "measured";
  if (obj(row.score)) return "estimated";
  return "not-run";
}

/** "adopt 2026-08-17T09:46:07Z" -> { verb, at, raw }; unparsable keeps raw with nulls. */
function parseEyeballed(value) {
  const raw = text(value);
  if (!raw) return null;
  const m = EYEBALLED_RE.exec(raw);
  return m ? { verb: m[1].toLowerCase(), at: m[2], raw } : { verb: null, at: null, raw };
}

/** One physical next step per row, or "-" for a closed one. */
function nextFor(row, projectId, legacy, eyeballed) {
  const status = text(row.status) || "proposed";
  if (CLOSED.has(status)) return "-";
  if (legacy) return "run it or drop it";
  if (!obj(row.bench)) return `bench it on ${projectId}`;
  if (status === "proposed") return "accept or drop it";
  if (!text(row.pair)) return "pair it";
  if (!eyeballed || !eyeballed.verb || eyeballed.verb === "not-yet") return "await the verdict";
  if (eyeballed.verb === "reject") return "close it as rejected";
  return "wire telemetry, then close as done";
}

function buildRow(row, projectId) {
  const status = text(row.status) || "proposed";
  const bench = obj(row.bench);
  const score = isCompleteScore(row.score) ? row.score : null;
  const legacy = ADOPTING.has(status) && !bench;
  const eyeballed = parseEyeballed(row.eyeballed);
  return {
    repo: row.repo,
    project: projectId,
    kind: text(row.kind) || "repo",
    slot: orNull(row.slot),
    verdict: orNull(row.verdict),
    status,
    state: deriveState(status, row.evidence, row.pair, row),
    measure: measureOf(row),
    bench,
    bench_date: bench ? orNull(bench.date) : null,
    bench_result: bench ? orNull(bench.result) : null,
    legacy_unbenched: legacy,
    score_total: score ? scoreTotal(score) : "unscored",
    score_basis: score ? orNull(score.basis) : null,
    pair: orNull(row.pair),
    eyeballed,
    before_after: obj(row.before_after),
    telemetry: obj(row.telemetry),
    evidence: orNull(row.evidence),
    lesson: orNull(row.lesson),
    outcome: orNull(row.outcome),
    why: orNull(row.why),
    updated_at: orNull(row.updated_at),
    next: nextFor(row, projectId, legacy, eyeballed),
  };
}

function byDebtThenStatus(a, b) {
  if (a.legacy_unbenched !== b.legacy_unbenched) return a.legacy_unbenched ? -1 : 1;
  const sa = STATUS_ORDER[a.status] ?? 9;
  const sb = STATUS_ORDER[b.status] ?? 9;
  return sa - sb || a.repo.localeCompare(b.repo);
}

function countRows(rows) {
  const counts = { rows: rows.length, measured: 0, estimated: 0, not_run: 0, legacy_unbenched: 0, closed: 0, with_verdict: 0 };
  for (const r of rows) {
    if (r.measure === "measured") counts.measured += 1;
    else if (r.measure === "estimated") counts.estimated += 1;
    else counts.not_run += 1;
    if (r.legacy_unbenched) counts.legacy_unbenched += 1;
    if (CLOSED.has(r.status)) counts.closed += 1;
    if (r.eyeballed && r.eyeballed.verb && r.eyeballed.verb !== "not-yet") counts.with_verdict += 1;
  }
  return counts;
}

/**
 * @param {object} input
 * @param {object[]} input.radarRows  raw rows from every project's radar file, each with `project`
 * @param {object[]} input.projects   configured projects ({ id, name, ... })
 * @param {string}   [input.project]  keep only this project id
 */
function buildScorecard({ radarRows = [], projects = [], project = null } = {}) {
  const byProject = new Map();
  for (const r of radarRows) {
    const pid = text(r.project);
    if (!pid || !text(r.repo)) continue;
    if (!byProject.has(pid)) byProject.set(pid, []);
    byProject.get(pid).push(r);
  }

  // Configured projects first, in their configured order; then any project id
  // that exists only in radar rows, so a row nobody configured a project for
  // cannot vanish. A filter keeps exactly that id, empty if it has nothing.
  const configured = projects.filter((p) => p && text(p.id));
  const ids = configured.map((p) => p.id);
  for (const pid of [...byProject.keys()].sort()) if (!ids.includes(pid)) ids.push(pid);
  const wanted = project ? [project] : ids;
  const nameOf = new Map(configured.map((p) => [p.id, text(p.name) || p.id]));

  const out = wanted.map((pid) => {
    const rows = (byProject.get(pid) || []).map((r) => buildRow(r, pid)).sort(byDebtThenStatus);
    return { id: pid, name: nameOf.get(pid) || pid, counts: countRows(rows), rows };
  });

  const allRows = out.flatMap((p) => p.rows);
  const population = {
    ...countRows(allRows),
    projects: out.length,
    repos: new Set(allRows.map((r) => r.repo)).size,
  };
  return { generated_at: new Date().toISOString(), population, projects: out };
}

module.exports = { buildScorecard, measureOf, parseEyeballed, nextFor };
