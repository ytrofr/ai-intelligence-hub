/**
 * The DNA map - per project, which pieces of our shared AI knowledge can LOAD
 * there, get USED there, and are PROVEN there, plus what to wire next.
 *
 * Source of truth is outside this repo: a local JSON written by the dna-map
 * producer under ~/.claude/state. This module only shapes it for the page.
 *
 * Display laws, same as ground-truth.js:
 *  - An absence is a ROW. A project the map lists but a cell or a wire-next list
 *    omits still renders - as "can't tell" or "nothing to wire", never as missing.
 *  - null is never 0. An unknown count stays null and its tooltip says so.
 *  - "unknown" and "error" are their own marks; neither may look like "no".
 *  - Counts are derived from the rendered rows and nothing else.
 *
 * Pure: the parsed map in, a render tree out. The route does the IO.
 */

const EMPTY_MESSAGE = "No DNA map yet - run dna-map.py";

/** Every state gets a SHAPE and a WORD, never a colour alone. */
const MARKS = {
  loads: {
    always: { glyph: "◐", word: "always", level: "mid" },
    yes: { glyph: "●", word: "yes", level: "good" },
    no: { glyph: "○", word: "no", level: "poor" },
    "n/a": { glyph: "–", word: "n/a", level: "none" },
    error: { glyph: "⚠", word: "can't tell", level: "none" },
  },
  used: {
    yes: { glyph: "●", word: "yes", level: "good" },
    no: { glyph: "○", word: "no", level: "poor" },
    unknown: { glyph: "?", word: "unknown", level: "none" },
    "n/a": { glyph: "–", word: "n/a", level: "none" },
  },
  proven: {
    live: { glyph: "●", word: "live", level: "good" },
    built: { glyph: "◐", word: "built", level: "mid" },
    absent: { glyph: "○", word: "absent", level: "poor" },
    error: { glyph: "⚠", word: "can't tell", level: "none" },
    unprobed: { glyph: "◇", word: "never probed", level: "none" },
    "no-probe": { glyph: "·", word: "no probe", level: "none" },
  },
};

/** Per axis: what a MISSING cell renders as, and what an unrecognised state word renders as. Never "no". */
const FALLBACK = { loads: "error", used: "unknown", proven: "unprobed" };
const UNTRUSTED = { loads: "error", used: "unknown", proven: "error" };
const GROUPS = [
  { kind: "capability", label: "Capabilities" },
  { kind: "rule", label: "Rules" },
  { kind: "skill", label: "Skills" },
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function mark(axis, raw, missingReason) {
  const known = isObj(raw) && Object.prototype.hasOwnProperty.call(MARKS[axis], raw.state);
  const state = known ? raw.state : isObj(raw) ? UNTRUSTED[axis] : FALLBACK[axis];
  const m = MARKS[axis][state];
  const parts = [`${axis}: ${m.word}`];
  if (!isObj(raw)) parts.push(missingReason);
  else if (!known) parts.push(`unknown state ${String(raw.state)}`);

  const out = { state, glyph: m.glyph, word: m.word, level: m.level };
  if (axis === "loads") {
    out.matched_files = isObj(raw) ? num(raw.matched_files) : null;
    if (known && (state === "yes" || state === "no")) {
      parts.push(out.matched_files === null ? "matched files unknown" : `${out.matched_files} matched files`);
    }
    if (isObj(raw) && raw.sample) parts.push(`e.g. ${raw.sample}`);
  } else if (axis === "used") {
    out.count = isObj(raw) ? num(raw.count) : null;
    out.unit = isObj(raw) && raw.unit ? String(raw.unit) : null;
    if (state !== "n/a") {
      parts.push(out.count === null ? "count unknown" : `${out.count} ${out.unit || ""}`.trim());
    }
  } else {
    out.reason = isObj(raw) && raw.reason ? String(raw.reason) : null;
    if (out.reason) parts.push(out.reason);
  }
  out.title = parts.join(" - ");
  return out;
}

function buildCell(raw) {
  const missing = "not in the map for this project";
  const c = isObj(raw) ? raw : {};
  const na = isObj(c.na) ? (c.na.reason ? String(c.na.reason) : "marked not applicable") : null;
  return {
    loads: mark("loads", c.loads, missing),
    used: mark("used", c.used, missing),
    proven: mark("proven", c.proven, missing),
    na,
    wire_next: c.wire_next === true,
    why: c.why ? String(c.why) : null,
  };
}

function trunkRow(t) {
  if (!isObj(t)) return { state: "error", behind: null, label: "trunk not in the map - behind unknown" };
  const behind = num(t.behind);
  const state = t.state === "ok" ? "ok" : "error";
  const where = state === "ok" ? `${t.trunk || "trunk"} ok` : `trunk unreadable${t.error ? ` (${t.error})` : ""}`;
  return { state, behind, label: `${where} · ${behind === null ? "behind unknown" : `${behind} behind`}` };
}

function buildDnaMap(map, { reason = null } = {}) {
  if (!isObj(map) || !Array.isArray(map.assets) || !Array.isArray(map.projects)) {
    return { status: "empty", message: EMPTY_MESSAGE, reason };
  }
  const projectIds = map.projects.filter((p) => typeof p === "string");
  const trunks = isObj(map.trunks) ? map.trunks : {};
  const warnings = [];

  const projects = projectIds.map((id) => ({ id, trunk: trunkRow(trunks[id]) }));

  const byId = {};
  const groups = GROUPS.map((g) => ({ ...g, assets: [] }));
  for (const a of map.assets) {
    if (!isObj(a) || typeof a.id !== "string") continue;
    const cells = isObj(a.cells) ? a.cells : {};
    const row = {
      id: a.id,
      name: a.name ? String(a.name) : a.id,
      kind: a.kind,
      tier: a.tier || null,
      cells: Object.fromEntries(projectIds.map((p) => [p, buildCell(cells[p])])),
    };
    byId[a.id] = row;
    const group = groups.find((g) => g.kind === a.kind);
    if (group) group.assets.push(row);
    else warnings.push(`asset ${a.id} has unknown kind ${String(a.kind)} and is not shown`);
  }
  const rendered = groups.flatMap((g) => g.assets);

  const wn = isObj(map.wire_next) ? map.wire_next : {};
  const wire_next = projectIds.map((project) => {
    const items = (Array.isArray(wn[project]) ? wn[project] : [])
      .filter((w) => isObj(w) && typeof w.asset === "string")
      .map((w) => ({
        asset: w.asset,
        name: byId[w.asset] ? byId[w.asset].name : w.asset,
        kind: byId[w.asset] ? byId[w.asset].kind : null,
        why: w.why ? String(w.why) : null,
      }));
    return { project, items, count: items.length };
  });

  const controls = (Array.isArray(map.controls) ? map.controls : []).filter(isObj).map((c) => {
    const result = c.result === "FIRED" ? "FIRED" : "ABSENT";
    return { name: String(c.name || "unnamed control"), expect: c.expect ?? null, result, warning: result !== "FIRED" };
  });
  if (controls.length === 0) warnings.push("the map carries no controls - nothing proves the instrument can tell yes from no");
  for (const c of controls) if (c.warning) warnings.push(`control did not fire: ${c.name}`);

  for (const [name, s] of Object.entries(isObj(map.sources) ? map.sources : {})) {
    if (isObj(s) && s.error) warnings.push(`source ${name} unreadable: ${s.error}`);
  }
  for (const p of projects) if (p.trunk.state !== "ok") warnings.push(`${p.id}: ${p.trunk.label}`);

  const counts = { wire_next: wire_next.reduce((n, w) => n + w.items.length, 0) };
  for (const axis of Object.keys(MARKS)) {
    counts[axis] = Object.fromEntries(Object.keys(MARKS[axis]).map((s) => [s, 0]));
    for (const a of rendered) for (const p of projectIds) counts[axis][a.cells[p][axis].state] += 1;
  }

  return {
    status: "ok",
    generated_at: typeof map.generated_at === "string" ? map.generated_at : null,
    population: { assets: rendered.length, projects: projectIds.length, cells: rendered.length * projectIds.length },
    projects,
    controls,
    wire_next,
    groups,
    counts,
    legend: MARKS,
    warnings,
  };
}

module.exports = { buildDnaMap, EMPTY_MESSAGE, MARKS };
