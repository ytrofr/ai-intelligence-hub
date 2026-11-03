/**
 * Which items a weekly digest covers: everything first seen since the previous digest's
 * window ENDED - never "7 days back from now" (audit 2026-11-03).
 *
 * The rolling now-7d window lost items twice over: anything first seen between the
 * previous run and exactly-7-days-ago fell between two digests (harness2: first seen
 * 07:16Z, digests at 06:53Z and 07:54Z a week later), and a failed run lost its whole
 * week because the next one only looked back 7 days.
 *
 * Pure: no DB, no clock. The caller passes the previous weekly_runs row and `now`.
 */
const DAY_MS = 86400000;

// SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS", UTC with no zone marker.
function parseUtc(s) {
  if (!s) return null;
  const str = String(s);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * @param {object} opts
 * @param {object|null} opts.prev  previous weekly_runs row (window_until, or created_at + runtime_ms)
 * @param {Date} opts.now
 * @param {number} [opts.maxDays=35] never look back further than this (says clamped:true)
 * @param {number} [opts.fallbackDays=7] window when there is no usable previous digest
 * @returns {{since:string, until:string, days:number, basis:string, clamped:boolean}}
 */
function digestWindow({ prev, now, maxDays = 35, fallbackDays = 7 }) {
  const untilMs = now.getTime();
  let sinceMs = null;
  let basis = 'no-previous-digest';

  const end = prev && parseUtc(prev.window_until);
  if (end !== null && end !== undefined && end < untilMs) {
    sinceMs = end;
    basis = 'previous-window-end';
  } else if (prev) {
    // Legacy rows have no window: created_at is written when the run ENDS, so its
    // start is created_at minus its runtime. Starting there re-covers items first seen
    // while that run was still building - a duplicate is cheap, a gap is not.
    const created = parseUtc(prev.created_at);
    if (created !== null && created < untilMs) {
      sinceMs = created - (Number(prev.runtime_ms) || 0);
      basis = 'previous-run-start';
    }
  }
  if (sinceMs === null) sinceMs = untilMs - fallbackDays * DAY_MS;

  let clamped = false;
  const floor = untilMs - maxDays * DAY_MS;
  if (sinceMs < floor) {
    sinceMs = floor;
    clamped = true;
  }
  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    days: Math.round(((untilMs - sinceMs) / DAY_MS) * 10) / 10,
    basis,
    clamped,
  };
}

/** Show at most `cap` entries and COUNT the rest - a display cap must never drop silently. */
function capList(list, cap) {
  return { shown: list.slice(0, cap), more: Math.max(0, list.length - cap) };
}

module.exports = { digestWindow, capList, parseUtc };
