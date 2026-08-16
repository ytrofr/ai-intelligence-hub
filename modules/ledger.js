/**
 * The Stack Ledger — every third-party repo we depend on, which projects use it,
 * why, how it turned out, and the rule it taught us.
 *
 * Two inputs, both of which already exist:
 *   radarRows   config/radar/<project>.json — decisions we actually made, with a
 *               reason someone wrote (repo, project, verdict, status, why, ...)
 *   depRepos    every package in every project's manifests, resolved to a GitHub
 *               slug by dep-resolve.js (repo, project, pkg)
 *
 * Keyed on the REPO, not the project. That is the whole point: a library used by
 * three projects must read as one thing, or the same evaluation gets paid for
 * three times. This is the shape that would have caught design.md, hallmark and
 * context-mode each being one job counted twice.
 *
 * NOT the same as modules/tracked-pool.js, and the two must never be "unified":
 *
 *   tracked-pool  decides what to POLL upstream daily. It RETIRES rejected rows
 *                 and drops unresolved ones, because an unbounded watch list
 *                 degrades into noise. It also injects a positive-control repo
 *                 that is not a dependency of ours at all.
 *   ledger        is the RECORD. A rejected adoption is its highest-value row —
 *                 "we tried this, here is the measurement, here is the lesson" is
 *                 exactly what stops another project repeating the work. Nothing
 *                 is retired, nothing is dropped, and the control never appears.
 *
 * An unexplained dependency is a row with an empty `why` and is COUNTED as such.
 * The gap is the product: a board that hides it looks finished and teaches
 * nothing. Reasons are never generated — a plausible invented one is worse than
 * a blank, because it is indistinguishable from a real one and gets quoted back
 * as fact.
 */

const { POSITIVE_CONTROL } = require("./tracked-pool");

const UNRESOLVED = "unresolved";

// A decided status outranks a mechanically-discovered one. `in-use` means the
// manifests say we depend on it and no decision was ever recorded.
const STATUS_RANK = { "in-use": 0, proposed: 1, accepted: 2, trial: 3, done: 4, rejected: 4 };
const CLOSED = new Set(["done", "rejected"]);

const text = (v) => (typeof v === "string" ? v.trim() : "");
const hasText = (v) => text(v).length > 0;

/**
 * Merge radar decisions and resolved dependencies into one repo-keyed list.
 *
 * @param {{radarRows?: object[], depRepos?: object[]}} input
 * @returns {{rows: object[], counts: object}}
 */
function buildLedger({ radarRows = [], depRepos = [] } = {}) {
  const byKey = new Map();

  // An unresolved package has no repo slug to key on, so it keys on its package
  // name instead. Two unresolvable packages are two rows, never one merged
  // "unresolved" row — otherwise the total silently shrinks.
  const keyFor = (repo, pkg) => (repo === UNRESOLVED ? `${UNRESOLVED}:${pkg || ""}` : repo);

  const touch = (key, repo, pkg) => {
    let row = byKey.get(key);
    if (!row) {
      row = {
        repo,
        pkg: pkg || null,
        unresolved: repo === UNRESOLVED,
        projects: [],
        why: "",
        topic: "",
        verdict: "",
        status: "in-use",
        outcome: "",
        evidence: "",
        lesson: "",
        first_seen: null,
        updated_at: null,
      };
      byKey.set(key, row);
    }
    return row;
  };

  const addProject = (row, project) => {
    if (project && !row.projects.includes(project)) row.projects.push(project);
  };

  // Decisions first: they carry the authored reason, which nothing may overwrite.
  for (const r of radarRows) {
    if (!r || !r.repo) continue;
    if (r.repo === POSITIVE_CONTROL) continue;
    const row = touch(keyFor(r.repo, r.pkg), r.repo, r.pkg);
    addProject(row, r.project);
    if (hasText(r.why) && !hasText(row.why)) row.why = text(r.why);
    if (hasText(r.topic)) row.topic = text(r.topic);
    if (hasText(r.verdict)) row.verdict = text(r.verdict);
    if (hasText(r.outcome) && !hasText(row.outcome)) row.outcome = text(r.outcome);
    if (hasText(r.evidence) && !hasText(row.evidence)) row.evidence = text(r.evidence);
    if (hasText(r.lesson) && !hasText(row.lesson)) row.lesson = text(r.lesson);

    const incoming = text(r.status) || "in-use";
    if ((STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[row.status] ?? 0)) row.status = incoming;

    if (r.added_at && (!row.first_seen || r.added_at < row.first_seen)) row.first_seen = r.added_at;
    if (r.updated_at && (!row.updated_at || r.updated_at > row.updated_at)) row.updated_at = r.updated_at;
  }

  // Then the manifests. A dep never changes a decided status and never touches a
  // reason — it only proves the repo is actually in use, and by whom.
  for (const d of depRepos) {
    if (!d || !d.repo) continue;
    if (d.repo === POSITIVE_CONTROL) continue;
    const row = touch(keyFor(d.repo, d.pkg), d.repo, d.pkg);
    if (!row.pkg && d.pkg) row.pkg = d.pkg;
    addProject(row, d.project);
  }

  const rows = [...byKey.values()].map((row) => ({
    ...row,
    projects: [...row.projects].sort(),
    explained: hasText(row.why),
  }));
  rows.sort((a, b) => a.repo.localeCompare(b.repo) || String(a.pkg).localeCompare(String(b.pkg)));

  return { rows, counts: countLedger(rows) };
}

/**
 * Counters, derived from the rendered rows and nothing else.
 *
 * Every failure mode of this board is silent — a blank reason, a dropped row, a
 * dead classifier — so these numbers are the only tell. They are computed from
 * `rows` so they cannot disagree with the table a person is looking at.
 */
function countLedger(rows = []) {
  const closed = rows.filter((r) => CLOSED.has(r.status));
  return {
    total: rows.length,
    explained: rows.filter((r) => r.explained).length,
    unexplained: rows.filter((r) => !r.explained).length,
    unresolved: rows.filter((r) => r.unresolved).length,
    inUse: rows.filter((r) => r.status === "in-use").length,
    closed: closed.length,
    closedWithLesson: closed.filter((r) => hasText(r.lesson) && text(r.lesson).toLowerCase() !== "none").length,
    projects: [...new Set(rows.flatMap((r) => r.projects))].sort(),
  };
}

module.exports = { buildLedger, countLedger, UNRESOLVED };
