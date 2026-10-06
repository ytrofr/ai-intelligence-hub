/**
 * Fetch Runner - runs ONE source with a wall-clock budget and reports the truth.
 *
 * Statuses: success | partial | error | timeout | rate_limited
 * A module that throws (HttpError, TimeoutError, network) is an ERROR - never
 * "success with 0 items". Outcome is persisted on the sources row so
 * /api/sources and /api/health can show it after the request is gone.
 *
 * `partial`: a module that got real data but could not run all of its planned
 * work (e.g. executed 30 of 45 searches before its budget ran out) throws a
 * PartialFetchError carrying the items it DID get. Those items are ingested,
 * and the source reads `partial` with the reason - never `success`.
 *
 * A module may also set `module.runReport` (e.g. {executed, planned, ...});
 * it is attached to the run result as `report` whatever the outcome.
 */

class PartialFetchError extends Error {
  constructor(message, items = [], report = null) {
    super(message);
    this.name = "PartialFetchError";
    this.items = items;
    this.report = report;
  }
}

const { applyIngestPolicy } = require("./item-filter");

const DEFAULT_SOURCE_TIMEOUT_MS = 120000;

function withTimeout(promise, ms, label) {
  let timer;
  const gate = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label} exceeded ${ms}ms budget`);
      e.name = "TimeoutError";
      reject(e);
    }, ms);
  });
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer));
}

// `timeoutMs`, `now` and `keywords` are injectable seams: production (routes/fetch.js)
// passes keywords once per fetch; tests pass short budgets and a fake db.
async function runSource(source, { db, createModule, timeoutMs, keywords = [], now = () => new Date() }) {
  const started = Date.now();
  const saveStatus = (last_status, last_error, last_item_count) =>
    db.updateSourceStatus({ id: source.id, last_status, last_error, last_item_count, last_run_at: now().toISOString() });
  const module = createModule(source);
  // The near-miss log's ONE call site. A store that nothing hands to a module is
  // armed and unreachable - it reads as present in every search and records
  // nothing. This is the seam that already holds the db, so it is where the
  // module gets it; a fake db in a test simply has no `nearMissStore` and the
  // module's own guard makes that a no-op.
  if (module && db && db.nearMissStore && module.nearMissStore === undefined) {
    module.nearMissStore = db.nearMissStore;
  }
  if (!module) {
    const error = "Unknown module type: " + source.type;
    saveStatus("error", error, 0);
    return { source: source.id, status: "error", error, ms: 0 };
  }
  if (!module.canFetch(source.last_fetched_at)) {
    return { source: source.id, status: "rate_limited", items: 0, ms: 0 };
  }
  // budget_ms = whole-source wall clock (config); timeout_ms is the per-request cap used inside modules
  const budget = timeoutMs || (source.config && source.config.budget_ms) || DEFAULT_SOURCE_TIMEOUT_MS;
  const withReport = (r, err) => {
    const report = (err && err.report) || module.runReport;
    return report && typeof report === "object" ? { ...r, report } : r;
  };
  // Ingest policy from config (keyword_gate / keyword_boost) - see modules/item-filter.js
  const ingest = (fetched) => {
    const count = db.upsertItems(applyIngestPolicy(fetched, source.config || {}, keywords));
    db.updateSourceLastFetched(source.id);
    return count;
  };
  try {
    const count = ingest(await withTimeout(module.fetch(), budget, source.id));
    saveStatus("success", null, count);
    return withReport({ source: source.id, status: "success", items: count, ms: Date.now() - started });
  } catch (err) {
    if (err && err.name === "PartialFetchError" && Array.isArray(err.items)) {
      const error = String(err.message).slice(0, 500);
      let count;
      try {
        count = ingest(err.items);
      } catch (ingestErr) {
        const e2 = `${error}; ingest failed: ${ingestErr.message}`.slice(0, 500);
        saveStatus("error", e2, 0);
        return withReport({ source: source.id, status: "error", error: e2, ms: Date.now() - started }, err);
      }
      console.warn(`[fetch] ${source.id} partial: ${error}`);
      saveStatus("partial", error, count);
      return withReport({ source: source.id, status: "partial", items: count, error, ms: Date.now() - started }, err);
    }
    const status = err && err.name === "TimeoutError" ? "timeout" : "error";
    const error = String((err && err.message) || err).slice(0, 500);
    console.error(`[fetch] ${source.id} ${status}: ${error}`);
    saveStatus(status, error, 0);
    return withReport({ source: source.id, status, error, ms: Date.now() - started }, err);
  }
}

function summarize(results) {
  const out = {
    fetched: 0, sources: {}, errors: [], partial: [],
    sources_attempted: 0, sources_failed: 0, sources_partial: 0, all_failed: false,
  };
  for (const r of results) {
    out.sources[r.source] = {
      status: r.status, items: r.items || 0, ms: r.ms || 0,
      ...(r.error ? { error: r.error } : {}), ...(r.report ? { report: r.report } : {}),
    };
    if (r.status === "rate_limited") continue;
    out.sources_attempted += 1;
    if (r.status === "success") out.fetched += r.items || 0;
    else if (r.status === "partial") {
      // Real items were ingested, but not all planned work ran: counted, and listed
      // apart from failures so neither "all good" nor "failed" is claimed.
      out.fetched += r.items || 0;
      out.sources_partial += 1;
      out.partial.push({ source: r.source, error: r.error });
    } else {
      out.sources_failed += 1;
      out.errors.push({ source: r.source, error: r.error });
    }
  }
  out.all_failed = out.sources_attempted > 0 && out.sources_failed === out.sources_attempted;
  return out;
}

module.exports = { runSource, summarize, withTimeout, PartialFetchError, DEFAULT_SOURCE_TIMEOUT_MS };
