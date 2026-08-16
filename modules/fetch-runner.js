/**
 * Fetch Runner - runs ONE source with a wall-clock budget and reports the truth.
 *
 * Statuses: success | error | timeout | rate_limited
 * A module that throws (HttpError, TimeoutError, network) is an ERROR - never
 * "success with 0 items". Outcome is persisted on the sources row so
 * /api/sources and /api/health can show it after the request is gone.
 */

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

async function runSource(source, { db, createModule, timeoutMs, now = () => new Date() }) {
  const started = Date.now();
  const module = createModule(source);
  if (!module) {
    const error = "Unknown module type: " + source.type;
    db.updateSourceStatus({ id: source.id, last_status: "error", last_error: error, last_item_count: 0, last_run_at: now().toISOString() });
    return { source: source.id, status: "error", error, ms: 0 };
  }
  if (!module.canFetch(source.last_fetched_at)) {
    return { source: source.id, status: "rate_limited", items: 0, ms: 0 };
  }
  const budget = timeoutMs || (source.config && source.config.timeout_ms) || DEFAULT_SOURCE_TIMEOUT_MS;
  try {
    const items = await withTimeout(module.fetch(), budget, source.id);
    const count = db.upsertItems(items);
    db.updateSourceLastFetched(source.id);
    db.updateSourceStatus({ id: source.id, last_status: "success", last_error: null, last_item_count: count, last_run_at: now().toISOString() });
    return { source: source.id, status: "success", items: count, ms: Date.now() - started };
  } catch (err) {
    const status = err && err.name === "TimeoutError" ? "timeout" : "error";
    const error = String((err && err.message) || err).slice(0, 500);
    console.error(`[fetch] ${source.id} ${status}: ${error}`);
    db.updateSourceStatus({ id: source.id, last_status: status, last_error: error, last_item_count: 0, last_run_at: now().toISOString() });
    return { source: source.id, status, error, ms: Date.now() - started };
  }
}

function summarize(results) {
  const out = { fetched: 0, sources: {}, errors: [], sources_attempted: 0, sources_failed: 0, all_failed: false };
  for (const r of results) {
    out.sources[r.source] = { status: r.status, items: r.items || 0, ms: r.ms || 0, ...(r.error ? { error: r.error } : {}) };
    if (r.status === "rate_limited") continue;
    out.sources_attempted += 1;
    if (r.status === "success") out.fetched += r.items || 0;
    else {
      out.sources_failed += 1;
      out.errors.push({ source: r.source, error: r.error });
    }
  }
  out.all_failed = out.sources_attempted > 0 && out.sources_failed === out.sources_attempted;
  return out;
}

module.exports = { runSource, summarize, withTimeout, DEFAULT_SOURCE_TIMEOUT_MS };
