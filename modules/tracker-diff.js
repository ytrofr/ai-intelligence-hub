/**
 * Tracker diff — PURE. One tracked_repos row (current values with prev_* beside
 * them) becomes the list of events worth telling someone about.
 *
 * Two design decisions carry the whole thing:
 *
 *  1. NO CHANGE MUST EMIT NOTHING. 293 repos are checked daily; a diff that is
 *     chatty on a quiet week trains the reader to skip the section, and then the
 *     one week it alarms is the week nobody looks.
 *
 *  2. State-shaped facts (archived, 404, stale) fire on the TRANSITION into that
 *     state, and the absence of a previous check counts as a transition. So a
 *     repo that is already archived the first time we see it does alarm — the
 *     state is the news, not the moment it changed — and it stays quiet after.
 *     Tag-shaped facts are the opposite: with no previous tag there is nothing
 *     to compare, so day one announces no releases at all.
 */

const SEVERITY = { ALARM: "ALARM", WARN: "WARN", NOTE: "NOTE" };
const STALE_DAYS = 180;

// "v1.9.0", "1.9", "v2.0.0-rc1" -> [1,9,0]. Anything else -> null.
function semver(tag) {
  if (!tag) return null;
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(tag).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

function olderThan(iso, days, asOf) {
  if (!iso || !asOf) return false;
  const t = Date.parse(iso);
  const ref = Date.parse(asOf);
  if (Number.isNaN(t) || Number.isNaN(ref)) return false;
  return ref - t > days * 864e5;
}

function diffRepo(row, { now = new Date().toISOString(), staleDays = STALE_DAYS } = {}) {
  const events = [];
  const add = (event, severity, from, to) =>
    events.push({
      repo: row.repo,
      event,
      severity,
      from: from === undefined || from === null ? null : String(from),
      to: to === undefined || to === null ? null : String(to),
      detected_at: now,
    });

  // A check that failed tells us nothing about upstream. The store already kept
  // the last good snapshot, so staying silent here is what makes that correct.
  if (row.http_status === null || row.http_status === undefined) return events;

  const gone = row.http_status === 404;
  const moved = row.http_status === 301 || row.http_status === 308;

  if (gone) {
    if (row.prev_http_status !== 404) add("deleted", SEVERITY.ALARM, row.prev_http_status, 404);
    return events; // nothing else about a repo that no longer exists is news
  }
  if (moved && row.prev_http_status !== row.http_status) {
    add("renamed", SEVERITY.ALARM, row.prev_http_status, row.http_status);
  }

  if (row.archived && !row.prev_archived) add("archived", SEVERITY.ALARM, "false", "true");

  const tag = row.latest_tag;
  const prevTag = row.prev_latest_tag;
  if (tag && prevTag && tag !== prevTag) {
    const a = semver(prevTag);
    const b = semver(tag);
    if (a && b && b[0] > a[0]) add("major_release", SEVERITY.ALARM, prevTag, tag);
    else add("release", SEVERITY.NOTE, prevTag, tag);
  }

  // Stale is judged at both checks so a long-dormant repo is reported once, not
  // every morning — and a repo that revives and dies again is reported again.
  const isStale = olderThan(row.pushed_at, staleDays, now);
  const wasStale = olderThan(row.prev_pushed_at, staleDays, row.prev_checked_at);
  if (isStale && !wasStale) add("stale", SEVERITY.WARN, row.prev_pushed_at, row.pushed_at);

  return events;
}

/** Convenience for the source module: diff many rows, flattened. */
function diffAll(rows, opts) {
  return rows.flatMap((r) => diffRepo(r, opts));
}

module.exports = { diffRepo, diffAll, semver, SEVERITY, STALE_DAYS };
