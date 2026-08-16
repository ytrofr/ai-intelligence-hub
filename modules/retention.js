/**
 * Retention - per-source pruning of old, un-bookmarked items.
 * Policy lives in config/sources.json (`config.retention_days`, null = never).
 * Runs only when asked (POST /api/maintenance/prune, called by hub-auto-fetch.sh
 * with HUB_PRUNE=1) and supports dryRun so counts can be eyeballed first.
 */

function planRetention(sources) {
  const plan = [];
  for (const s of sources) {
    const days = Number(s.config && s.config.retention_days);
    if (Number.isFinite(days) && days > 0) plan.push({ source: s.id, days });
  }
  return plan;
}

function prune(db, sources, { dryRun = true } = {}) {
  const plan = planRetention(sources);
  const results = [];
  let total = 0;
  for (const { source, days } of plan) {
    const n = dryRun ? db.countOldItemsBySource(source, days) : db.clearOldItemsBySource(source, days);
    results.push({ source, days, [dryRun ? "would_delete" : "deleted"]: n });
    total += n;
  }
  return { dryRun, total, results };
}

module.exports = { planRetention, prune };
