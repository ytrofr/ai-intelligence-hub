/**
 * Is a wired eval still running?
 *
 * Freshness is stored NOWHERE. It is joined at read time from the row's
 * `eval.slot` to that slot's own `ran[]` in config/projects.json, and that is
 * the whole point: you cannot make a row look fresh by writing to the row. To
 * turn this green you have to actually append a run to the slot, which is the
 * thing the green is claiming happened.
 *
 * Seven states, and every one of them is a ROW on the page - an eval that
 * cannot be resolved is a finding, not a blank cell. Colour never travels
 * alone here either: each state carries a word AND a shape, because the
 * operator cannot rely on hue.
 *
 * Pure: no IO, no clock of its own (the caller passes `now`), no config
 * loading. The two consumers already hold `projects`; modules/ledger.js does
 * not and must not start - a repo-keyed merge has no business reading slots.
 */

const DAY_MS = 86400000;

/**
 * A benchmark that stopped is the failure this exists to catch, and it is
 * silent by construction: nothing errors, the row still says `done`, and the
 * number on the page is simply old. `due` at one cadence and `stalled` at two
 * is a judgement, not a measurement - so the page prints the multiplier beside
 * the score bands rather than leaving a reader to infer it.
 */
const STALE_MULTIPLIER = 2;

const STATES = {
  "not-wired": { word: "not wired", shape: "◇", ok: false },
  "slot-missing": { word: "slot missing", shape: "✗", ok: false },
  "never-ran": { word: "never ran", shape: "◇", ok: false },
  undated: { word: "undated run", shape: "?", ok: false },
  running: { word: "running", shape: "●", ok: true },
  due: { word: "due", shape: "▲", ok: false },
  stalled: { word: "stalled", shape: "✗", ok: false },
};

/** Every declared slot, keyed "<project>/<slot>", from the projects config. */
function indexSlots(projects = []) {
  const bySlot = new Map();
  for (const p of projects) {
    for (const slot of (p && p.slots) || []) {
      if (slot && slot.id) bySlot.set(`${p.id}/${slot.id}`, slot);
    }
  }
  return bySlot;
}

/**
 * The most recent DATED run in a slot's log, as epoch ms - or null.
 *
 * `ran[]` is append-only and its entries are hand-authored, so an entry with
 * no date, or with a date nothing can parse, is normal and must not be read as
 * "recent". It resolves to null, which the caller renders as `undated` rather
 * than as fresh: three states, never two.
 */
function lastRunAt(slot) {
  const runs = (slot && Array.isArray(slot.ran) && slot.ran) || [];
  let best = null;
  for (const r of runs) {
    const raw = r && (r.date || r.at);
    if (typeof raw !== "string") continue;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best;
}

/**
 * One row's eval freshness.
 *
 * @param {object|null} evalField  the row's `eval`, or null/undefined
 * @param {Map<string, object>} slotIndex  from indexSlots()
 * @param {number} now  epoch ms - passed in, never read from the clock here
 * @returns {{state: string, word: string, shape: string, ok: boolean,
 *            age_days: number|null, cadence_days: number|null, slot: string|null,
 *            runs: number}}
 */
function evalFreshness(evalField, slotIndex, now = Date.now()) {
  const shape = (state, extra = {}) => ({
    state,
    ...STATES[state],
    age_days: null,
    cadence_days: null,
    slot: null,
    runs: 0,
    ...extra,
  });

  if (!evalField || typeof evalField !== "object") return shape("not-wired");

  const slotId = typeof evalField.slot === "string" ? evalField.slot : "";
  const slot = slotIndex.get(slotId);
  // An eval naming a slot nobody declared cannot be checked at all. Fail
  // CLOSED: "we cannot tell" is never "it is running".
  if (!slot) return shape("slot-missing", { slot: slotId || null });

  const runs = (Array.isArray(slot.ran) && slot.ran.length) || 0;
  const cadence = Number.isInteger(evalField.cadence_days) ? evalField.cadence_days : null;
  const base = { slot: slotId, runs, cadence_days: cadence };

  if (runs === 0) return shape("never-ran", base);

  const at = lastRunAt(slot);
  if (at === null) return shape("undated", base);
  // A run recorded in the future is not fresh evidence, it is a typo. Clamp to
  // 0 so it reads as "just ran" rather than as a negative age nobody can
  // interpret - and the date itself is on the page beside it.
  const age = Math.max(0, Math.floor((now - at) / DAY_MS));
  const withAge = { ...base, age_days: age };

  if (cadence === null) return shape("undated", withAge);
  if (age <= cadence) return shape("running", withAge);
  if (age <= cadence * STALE_MULTIPLIER) return shape("due", withAge);
  return shape("stalled", withAge);
}

/** How many rows sit in each state - for the counts strip and the digest. */
function countEvalStates(freshnesses = []) {
  const out = { wired: 0, running: 0, due: 0, stalled: 0, never_ran: 0, slot_missing: 0, undated: 0 };
  for (const f of freshnesses) {
    if (!f || f.state === "not-wired") continue;
    out.wired += 1;
    const key = f.state.replace(/-/g, "_");
    if (key in out) out[key] += 1;
  }
  return out;
}

module.exports = { evalFreshness, countEvalStates, indexSlots, lastRunAt, STATES, STALE_MULTIPLIER };
