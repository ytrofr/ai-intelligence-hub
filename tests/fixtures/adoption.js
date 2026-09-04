/**
 * Shared adoption-evidence fixtures for tests that close a row to `done`.
 *
 * Operator ruling 2026-09-04: "adopted" means bench + telemetry + before/after,
 * so every test that exercises a REAL close-to-done transition needs these three
 * fields on the row first, the same way it already needs evidence/lesson/pair/
 * eyeballed. Centralized here rather than repeated per test file so the shape
 * matches routes/lib/radar-store.js exactly in one place.
 *
 * Not a *.test.js file — `npm test` globs `tests/*.test.js` only, so this file
 * is never picked up as a suite on its own.
 */
const BENCH_OK = {
  run: "~/.claude/reports/bench-a-b-2026-09-04.md",
  date: "2026-09-04",
  result: "42ms p50 on our own 1k-row fixture vs 118ms for the incumbent",
};

const TELEMETRY_OK = {
  project: "apollo",
  counters: ["adopt_a_b_total", "adopt_a_b_errors_total"],
  url: "http://localhost:4444/api/health",
};

const BEFORE_AFTER_OK = {
  before: "118ms p50, incumbent",
  after: "42ms p50, candidate",
  window: "7d",
  date: "2026-09-04",
};

/**
 * Puts all three adoption-evidence fields onto an existing row via upsertRow,
 * preserving its current verdict (upsertRow always overwrites verdict, so this
 * must be told what it already is — same discipline the store itself uses).
 */
function makeAdoptable(store, project, repo, verdict = "ADOPT") {
  return store.upsertRow(project, {
    repo,
    verdict,
    bench: BENCH_OK,
    telemetry: TELEMETRY_OK,
    before_after: BEFORE_AFTER_OK,
  });
}

module.exports = { BENCH_OK, TELEMETRY_OK, BEFORE_AFTER_OK, makeAdoptable };
