/**
 * Upstream state, rendered for a human reading the radar.
 *
 * PURE. Takes a tracked_repos row and returns a short label plus a severity
 * SHAPE — never a colour on its own, because the operator cannot read red/green.
 *
 * The label answers the only question the radar page asks about upstream: is
 * this repo still somewhere I can adopt it from? Everything finer than that
 * (stars, exact dates, the event history) belongs in the digest.
 */

const DAY = 864e5;

function upstreamView(row, { now = Date.now(), staleDays = 180, movedTo = null } = {}) {
  if (!row) return { label: "not tracked", tone: "unknown", mark: "·" };
  if (row.last_error && row.http_status === null) return { label: "check failed", tone: "unknown", mark: "?" };

  if (row.http_status === 404) return { label: "DELETED", tone: "alarm", mark: "⛔" };
  if (row.http_status === 301 || row.http_status === 308) {
    // A rename with no destination is unactionable, so the destination is
    // passed in from the event log rather than guessed from the row.
    return { label: movedTo ? `MOVED → ${movedTo}` : "MOVED", tone: "alarm", mark: "⛔", movedTo };
  }
  if (row.archived) return { label: "ARCHIVED", tone: "alarm", mark: "⛔" };

  const pushed = row.pushed_at ? Date.parse(row.pushed_at) : null;
  if (pushed && now - pushed > staleDays * DAY) {
    return { label: `quiet ${Math.floor((now - pushed) / DAY)}d`, tone: "warn", mark: "⚠" };
  }

  const tag = row.latest_tag ? `${row.latest_tag}` : "no releases";
  const age = pushed ? ` · pushed ${Math.max(0, Math.floor((now - pushed) / DAY))}d ago` : "";
  return { label: `${tag}${age}`, tone: "ok", mark: "✓" };
}

module.exports = { upstreamView };
