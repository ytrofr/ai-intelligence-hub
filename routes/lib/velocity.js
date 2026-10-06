/**
 * Star velocity - pure. Snapshot series (+ optional trending-page gains) ->
 * {gain1, gain7, velocity, origin, eligible}.
 *
 *   gain7    = stars_today - stars_{today-7}
 *   velocity = gain7 / sqrt(max(50, stars_{today-7}))
 *
 * The square-root denominator rewards RELATIVE surge and damps the giants: a
 * 200k-star repo gaining 300/wk scores 0.67, a 2k-star repo gaining 1,500/wk
 * scores ~33. Ranking eligibility needs gain7 >= GAIN7_FLOOR.
 *
 * Origins, in order of preference:
 *   'snapshots'           a reading 7 days back exists (window 7..9 days, so
 *                         one missed daily run does not erase a week)
 *   'trending-page'       history too short; github.com/trending's own
 *                         "N stars this week" stands in until it is not
 *   'insufficient_history' neither - gain7 and velocity are NULL, never 0.
 *                         Zero would read as "measured, did not grow".
 */

const GAIN7_FLOOR = 150;
const MIN_BASE = 50;
const WINDOW_MIN = 7;
const WINDOW_MAX = 9;

const dayNum = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function velocityOf(gain7, base) {
  if (!isNum(gain7) || !isNum(base)) return null;
  return gain7 / Math.sqrt(Math.max(MIN_BASE, base));
}

/**
 * series   [{day:'YYYY-MM-DD', stars}] any order (rows with no numeric stars ignored)
 * today    'YYYY-MM-DD' - readings after it are ignored; defaults to the latest reading
 * trending {weekly?: N, daily?: N} - the page's own "stars this week|today"
 */
function computeVelocity(series, { today, trending = {} } = {}) {
  const rows = (series || [])
    .filter((r) => r && r.day && isNum(r.stars))
    .map((r) => ({ day: r.day, n: dayNum(r.day), stars: r.stars }))
    .filter((r) => !today || r.n <= dayNum(today))
    .sort((a, b) => a.n - b.n);

  const latest = rows[rows.length - 1] || null;
  const at = (lo, hi) => {
    // the most recent reading whose age (latest - n) falls in [lo, hi]
    for (let i = rows.length - 1; i >= 0; i--) {
      const age = latest.n - rows[i].n;
      if (age >= lo && age <= hi) return rows[i];
    }
    return null;
  };

  let gain1 = null;
  if (latest) {
    const prev = at(1, 1);
    if (prev) gain1 = latest.stars - prev.stars;
  }
  if (gain1 === null && isNum(trending.daily)) gain1 = trending.daily;

  const out = { gain1, gain7: null, velocity: null, origin: "insufficient_history", eligible: false, stars: latest ? latest.stars : null, stars_7d_ago: null, base_day: null };

  const base = latest ? at(WINDOW_MIN, WINDOW_MAX) : null;
  if (base) {
    out.gain7 = latest.stars - base.stars;
    out.stars_7d_ago = base.stars;
    out.base_day = base.day;
    out.origin = "snapshots";
  } else if (isNum(trending.weekly)) {
    out.gain7 = trending.weekly;
    // The page reports today's total and the week's gain; their difference is
    // the best available reading of a week ago. Without a total there is no
    // base, so velocity stays NULL (gain7 is still reported).
    out.stars_7d_ago = latest ? Math.max(0, latest.stars - trending.weekly) : null;
    out.origin = "trending-page";
  } else {
    return out;
  }

  out.velocity = velocityOf(out.gain7, out.stars_7d_ago);
  out.eligible = out.velocity !== null && out.gain7 >= GAIN7_FLOOR;
  return out;
}

/** Eligible rows only, velocity desc, gain7 tie-break. Rows carry a `.v` = computeVelocity result. */
function rankByVelocity(rows) {
  return (rows || [])
    .filter((r) => r && r.v && r.v.eligible && isNum(r.v.velocity))
    .sort((a, b) => b.v.velocity - a.v.velocity || b.v.gain7 - a.v.gain7);
}

module.exports = { computeVelocity, rankByVelocity, velocityOf, GAIN7_FLOOR, MIN_BASE };
