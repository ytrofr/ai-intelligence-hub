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
 *
 * H3 adoption fields (kind, cost_tier, licence, hardware_fit, hardware_mib, slot,
 * features, score, bench, telemetry, before_after — see routes/lib/radar-store.js
 * for what each means) carry through from radarRows the same way `why` does: first
 * authored value wins, never overwritten by a later row for the same repo. Two
 * derived fields ride on top, computed from the rendered row and never assigned
 * independently:
 *   state        the status, except `accepted` with neither evidence nor a
 *                pair reads as "accepted-without-evidence" — a decision made
 *                but never backed or shown to the operator.
 *   score_total  scoreTotal(row.score) when the score is complete, else the
 *                string "unscored" — never a fabricated number.
 *
 * The same repo scored by TWO projects is still one row (that is the whole
 * point of keying on the repo), but the H3 fields above are single-valued —
 * "first authored wins" means the SECOND project's own slot/features/score
 * are gone from the merge entirely, and every reader of this row (the
 * adoption matrix, the ground-truth board) has no way to tell. `per_project`
 * is where the loser's own fields survive: every radar row that carries any
 * H3 field is ALSO recorded, verbatim, under `row.per_project[r.project]` —
 * `{ slot, features, score, cost_tier, licence, hardware_fit, hardware_mib, status,
 * evidence, pair, state, score_total }` — so a reader building a candidate
 * for a SPECIFIC project can read that project's own view instead of
 * whichever project happened to be authored (or alphabetized) first.
 *
 * `bench` / `telemetry` / `before_after` ride the same rule: objects, not
 * strings, so "has it" is `!!row.bench` rather than `hasText(row.bench)` — see
 * hasAnyH3Field and buildPerProjectEntry below.
 */

const { POSITIVE_CONTROL } = require("./tracked-pool");

const UNRESOLVED = "unresolved";

// A decided status outranks a mechanically-discovered one. `in-use` means the
// manifests say we depend on it and no decision was ever recorded.
const STATUS_RANK = { "in-use": 0, proposed: 1, accepted: 2, trial: 3, done: 4, rejected: 4 };
const CLOSED = new Set(["done", "rejected"]);

// The five statuses a DECISION can be in — "in-use" is a mechanically-discovered
// dependency that was never proposed, so it is not part of the funnel.
const FUNNEL_STATUSES = ["proposed", "accepted", "trial", "done", "rejected"];

const text = (v) => (typeof v === "string" ? v.trim() : "");
const hasText = (v) => text(v).length > 0;
const SCORE_DIMS = ["effort", "effect", "time", "impact", "risk"];
const isInt1to5 = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * A score is COMPLETE only when every dimension is a validated integer 1-5 —
 * the store already refuses a partial one at write time, but a hand-edited
 * config file can still carry a malformed one, and this must not crash the
 * board over it.
 */
function hasCompleteScore(score) {
  return !!score && typeof score === "object" && SCORE_DIMS.every((d) => isInt1to5(score[d]));
}

/**
 * Pure 0-100 rollup of a complete score. Higher is better: high effect/impact
 * push it up, high effort/time/risk pull it down (each inverted around 6, so a
 * 1 on a "bad" dimension contributes like a 5 on a "good" one).
 *
 * @param {{effort:number, effect:number, time:number, impact:number, risk:number}} score
 * @returns {number} 0-100, rounded
 */
function scoreTotal(score) {
  const { effort, effect, time, impact, risk } = score;
  return Math.round(((effect + impact + (6 - effort) + (6 - time) + (6 - risk)) / 25) * 100);
}

/**
 * `accepted` with neither evidence nor a pair reads as
 * "accepted-without-evidence" — a decision made but never backed or shown to
 * the operator. Shared by the top-level row AND every per-project entry, so
 * the two can never compute this differently.
 */
function deriveState(status, evidenceText, pairText) {
  return status === "accepted" && !hasText(evidenceText) && !hasText(pairText)
    ? "accepted-without-evidence"
    : status;
}

/** Does this radar row carry ANY H3 adoption field at all? */
function hasAnyH3Field(r) {
  return (
    hasText(r.slot) ||
    (Array.isArray(r.features) && r.features.length > 0) ||
    !!(r.score && typeof r.score === "object") ||
    hasText(r.cost_tier) ||
    hasText(r.licence) ||
    hasText(r.hardware_fit) ||
    Number.isInteger(r.hardware_mib) ||
    !!(r.bench && typeof r.bench === "object") ||
    !!(r.telemetry && typeof r.telemetry === "object") ||
    !!(r.before_after && typeof r.before_after === "object")
  );
}

/**
 * One radar row's OWN H3 fields, shaped for `row.per_project[r.project]` —
 * or `null` when the row authors none of them (a plain decision/dependency
 * row, which gets no per-project entry at all). Pulled out of buildLedger's
 * main loop so that loop stays readable at one field-group per line.
 */
function buildPerProjectEntry(r) {
  // A project that recorded a DECISION and nothing else still decided
  // something, and the merge must not attribute it to whichever project
  // happened to author the H3 fields. Before this, a bare `rejected` row got
  // no entry, so its own author read back as "proposed" - the merged row's
  // fallback for a project that never said anything at all.
  // A plain dependency (status in-use, no fields) still gets no entry: that
  // is the one case where there really is nothing of this project's own.
  if (!hasAnyH3Field(r) && !FUNNEL_STATUSES.includes(text(r.status))) return null;
  const status = text(r.status) || "in-use";
  const score = hasCompleteScore(r.score) ? r.score : null;
  return {
    slot: text(r.slot),
    features: Array.isArray(r.features) ? r.features : [],
    score,
    cost_tier: text(r.cost_tier),
    licence: text(r.licence),
    hardware_fit: text(r.hardware_fit),
    hardware_mib: Number.isInteger(r.hardware_mib) ? r.hardware_mib : null,
    bench: r.bench && typeof r.bench === "object" ? r.bench : null,
    telemetry: r.telemetry && typeof r.telemetry === "object" ? r.telemetry : null,
    before_after: r.before_after && typeof r.before_after === "object" ? r.before_after : null,
    status,
    evidence: text(r.evidence),
    pair: text(r.pair),
    state: deriveState(status, r.evidence, r.pair),
    score_total: score ? scoreTotal(score) : "unscored",
  };
}

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
  //
  // KIND is part of the identity, and it has to be. A HuggingFace dataset id and
  // a GitHub slug are spelled identically - `SALT-NLP/Design2Code` is both - so
  // keying on the slug alone merges the answer key we MEASURE AGAINST with the
  // source we DEPEND ON, and one of the two authored reasons silently wins.
  const keyFor = (repo, pkg, kind) =>
    repo === UNRESOLVED ? `${UNRESOLVED}:${pkg || ""}:${kind}` : `${kind}:${repo}`;

  const touch = (key, repo, pkg, kind) => {
    let row = byKey.get(key);
    if (!row) {
      row = {
        repo,
        pkg: pkg || null,
        // repo | dataset | model. Defaulted, never inferred from the slug: every
        // row that existed before this field is a repo, and a guess would make
        // the first dataset row indistinguishable from a mis-typed one.
        kind,
        unresolved: repo === UNRESOLVED,
        projects: [],
        // Subset of `projects` that authored an ACTUAL radar decision about
        // this repo — as opposed to merely depending on it. A project that
        // proposed/watched/rejected it with no H3 fields still belongs here:
        // it made its own (empty) call and must never inherit another
        // project's H3 data as if it were its own — see per_project below.
        radar_projects: [],
        why: "",
        topic: "",
        verdict: "",
        status: "in-use",
        outcome: "",
        evidence: "",
        lesson: "",
        pair: "",
        eyeballed: "",
        cost_tier: "",
        licence: "",
        hardware_fit: "",
        hardware_mib: null,
        slot: "",
        features: [],
        score: null,
        bench: null,
        telemetry: null,
        before_after: null,
        // Keyed by project id. Only projects whose OWN radar row carried at
        // least one H3 field get an entry — a plain dependency mention never
        // does, so this stays absent (not an empty object) on ordinary rows.
        per_project: {},
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
  const addRadarProject = (row, project) => {
    if (project && !row.radar_projects.includes(project)) row.radar_projects.push(project);
  };

  // Decisions first: they carry the authored reason, which nothing may overwrite.
  for (const r of radarRows) {
    if (!r || !r.repo) continue;
    if (r.repo === POSITIVE_CONTROL) continue;
    const kind = text(r.kind) || "repo";
    const row = touch(keyFor(r.repo, r.pkg, kind), r.repo, r.pkg, kind);
    addProject(row, r.project);
    addRadarProject(row, r.project);
    if (hasText(r.why) && !hasText(row.why)) row.why = text(r.why);
    if (hasText(r.topic)) row.topic = text(r.topic);
    if (hasText(r.verdict)) row.verdict = text(r.verdict);
    if (hasText(r.outcome) && !hasText(row.outcome)) row.outcome = text(r.outcome);
    if (hasText(r.evidence) && !hasText(row.evidence)) row.evidence = text(r.evidence);
    if (hasText(r.lesson) && !hasText(row.lesson)) row.lesson = text(r.lesson);
    if (hasText(r.pair) && !hasText(row.pair)) row.pair = text(r.pair);
    if (hasText(r.eyeballed) && !hasText(row.eyeballed)) row.eyeballed = text(r.eyeballed);
    // H3 fields — same "first authored value wins" rule as `why`. `kind` is not
    // repeated here: it is already fixed by the map key (keyFor includes it), so
    // every row sharing this key was authored with the same kind by construction.
    if (hasText(r.cost_tier) && !hasText(row.cost_tier)) row.cost_tier = text(r.cost_tier);
    if (hasText(r.licence) && !hasText(row.licence)) row.licence = text(r.licence);
    if (hasText(r.hardware_fit) && !hasText(row.hardware_fit)) row.hardware_fit = text(r.hardware_fit);
    if (Number.isInteger(r.hardware_mib) && row.hardware_mib === null) row.hardware_mib = r.hardware_mib;
    if (hasText(r.slot) && !hasText(row.slot)) row.slot = text(r.slot);
    if (Array.isArray(r.features) && r.features.length && !row.features.length) row.features = r.features;
    if (hasCompleteScore(r.score) && !row.score) row.score = r.score;
    if (r.bench && typeof r.bench === "object" && !row.bench) row.bench = r.bench;
    if (r.telemetry && typeof r.telemetry === "object" && !row.telemetry) row.telemetry = r.telemetry;
    if (r.before_after && typeof r.before_after === "object" && !row.before_after) row.before_after = r.before_after;

    const incoming = text(r.status) || "in-use";
    if ((STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[row.status] ?? 0)) row.status = incoming;

    // This project's OWN view of the H3 fields, alongside the merged
    // top-level ones above — see the module doc. Only once per project
    // (first radar row for that project wins, same rule as everywhere else
    // in this merge) so a later, less-complete row can never blank out an
    // earlier, fuller one.
    if (r.project && !row.per_project[r.project]) {
      const entry = buildPerProjectEntry(r);
      if (entry) row.per_project[r.project] = entry;
    }

    if (r.added_at && (!row.first_seen || r.added_at < row.first_seen)) row.first_seen = r.added_at;
    if (r.updated_at && (!row.updated_at || r.updated_at > row.updated_at)) row.updated_at = r.updated_at;
  }

  // Then the manifests. A dep never changes a decided status and never touches a
  // reason — it only proves the repo is actually in use, and by whom.
  for (const d of depRepos) {
    if (!d || !d.repo) continue;
    if (d.repo === POSITIVE_CONTROL) continue;
    // A manifest resolves to a PACKAGE, which is always a repo. Keying the dep at
    // kind "repo" is what stops a dependency attaching itself to a dataset of the
    // same name and making an answer key read as something we ship.
    const row = touch(keyFor(d.repo, d.pkg, "repo"), d.repo, d.pkg, "repo");
    if (!row.pkg && d.pkg) row.pkg = d.pkg;
    addProject(row, d.project);
  }

  const rows = [...byKey.values()].map((row) => ({
    ...row,
    projects: [...row.projects].sort(),
    radar_projects: [...row.radar_projects].sort(),
    explained: hasText(row.why),
    // A decision made but never backed by evidence and never shown to the
    // operator (no pair) is a distinct state from a plain "accepted" — see the
    // module doc. Operator law 2026-08-17 already gates CLOSING a row this way;
    // this surfaces the same gap one status earlier, before it can even close.
    state: deriveState(row.status, row.evidence, row.pair),
    score_total: hasCompleteScore(row.score) ? scoreTotal(row.score) : "unscored",
  }));
  rows.sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      String(a.kind).localeCompare(String(b.kind)) ||
      String(a.pkg).localeCompare(String(b.pkg))
  );

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
    // Operator law 2026-08-17: a closed row the operator never saw is a decision,
    // not an adoption. Printed on the page so the gap cannot go quiet.
    closedEyeballed: closed.filter((r) => hasText(r.eyeballed)).length,
    // Operator ruling 2026-09-04: "adopted" means bench + telemetry +
    // before/after — the store's own gate refuses a NEW `done` closure without
    // all three. This still counts rows that reached `done` before that gate
    // existed (or via a hand-edited config), so the gap it reports is real:
    // "worked at some point" is not the same claim as "we can still show it did".
    done: rows.filter((r) => r.status === "done").length,
    doneWithAdoptionEvidence: rows.filter((r) => r.status === "done" && r.bench && r.telemetry && r.before_after)
      .length,
    // Per-kind, so three dataset rows landing at once do not read as three new
    // dependencies on the board.
    byKind: rows.reduce((acc, r) => {
      const k = r.kind || "repo";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    projects: [...new Set(rows.flatMap((r) => r.projects))].sort(),
  };
}

/**
 * ISO 8601 week key ("GGGG-Www") for a date — Monday-start weeks, week 1 is the
 * one containing the year's first Thursday. Subtracting whole weeks from `now`
 * (below) always lands on a distinct, consecutive key, so the funnel's window
 * never has to reconcile two different calendars.
 */
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday=0..Sunday=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const emptyFunnelCounts = () => FUNNEL_STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});

/**
 * Per-ISO-week ledger funnel: how many rows entered each status, bucketed by
 * the ISO week of `first_seen`. A row with no `first_seen` goes to "undated"
 * rather than being dropped; a row whose week falls outside the requested
 * window is still counted, under its own (unlisted) week key — `weeks` names
 * only the window a caller asked to chart, never a filter on what gets counted.
 *
 * @param {object[]} rows - ledger rows (as from buildLedger)
 * @param {{weeks?: number, now?: Date}} [opts]
 * @returns {{weeks: string[], counts: Record<string, Record<string, number>>}}
 */
function funnel(rows = [], { weeks = 8, now = new Date() } = {}) {
  const weekKeys = [];
  for (let i = weeks - 1; i >= 0; i--) {
    weekKeys.push(isoWeekKey(new Date(now.getTime() - i * 7 * 24 * 3600 * 1000)));
  }
  const counts = { undated: emptyFunnelCounts() };
  for (const wk of weekKeys) counts[wk] = emptyFunnelCounts();

  for (const r of rows) {
    if (!r || !FUNNEL_STATUSES.includes(r.status)) continue;
    const bucket = r.first_seen ? isoWeekKey(new Date(r.first_seen)) : "undated";
    if (!counts[bucket]) counts[bucket] = emptyFunnelCounts();
    counts[bucket][r.status] += 1;
  }

  return { weeks: weekKeys, counts };
}

module.exports = { buildLedger, countLedger, UNRESOLVED, scoreTotal, funnel };
