/**
 * MOCK ONLY - delete this file the day routes/projects-hub.js lands.
 *
 * It performs, in the browser, the join that the real /api/projects-hub endpoint
 * will perform on the server. It exists so the operator can choose between two
 * shapes on REAL data before any production code is written, and for no other
 * reason. Nothing here is imported by the app.
 *
 * Every number on screen is derived from the three live endpoints. There is no
 * fixture, no sample, no placeholder: a project with zero candidates renders as
 * zero, and a slot nobody has filled renders as a row saying so.
 */

/* eslint-env browser */

const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** Colour is never the only channel: every chip carries a glyph AND a word. */
function chip(level, word, title) {
  const glyph = { good: "&#10003;", warn: "&#9650;", bad: "&#10007;", none: "?" }[level] || "?";
  const t = title ? ` title="${esc(title)}"` : "";
  return `<span class="chip b-${level}"${t}><span class="g">${glyph}</span>${esc(word)}</span>`;
}

const scoreBand = (n) => (typeof n !== "number" ? "none" : n >= 80 ? "good" : n >= 65 ? "mid" : "poor");

/** Days between an ISO date and now; null when the date is missing or unparseable
 *  - an undated run is its own state, never a fresh one. */
function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// ---------------------------------------------------------------- compose ---

/**
 * The join. Ground truth owns the project -> slot tree; the matrix owns the
 * scores. A matrix row whose `slot` is null is UNSLOTTED and a row whose slot
 * names another project is BORROWED - both would vanish under a naive
 * `slot.startsWith(project + "/")`, and both are real today.
 */
function compose(gt, matrix, ledger) {
  const matrixByProject = new Map(matrix.projects.map((p) => [p.id, p.rows || []]));

  const projects = gt.projects.map((p) => {
    const rows = matrixByProject.get(p.id) || [];
    const bySlot = new Map();
    const unslotted = [];
    const borrowed = [];

    for (const r of rows) {
      if (!r.slot) {
        unslotted.push(r);
      } else if (r.slot.split("/")[0] !== p.id) {
        borrowed.push(r);
      } else {
        const key = r.slot.split("/").slice(1).join("/");
        if (!bySlot.has(key)) bySlot.set(key, []);
        bySlot.get(key).push(r);
      }
    }

    const slots = p.slots.map((s) => {
      const scored = bySlot.get(s.id) || [];
      const at = s.last_ran && s.last_ran.at;
      return {
        ...s,
        scored,
        best: scored.reduce((m, r) => (typeof r.total === "number" && r.total > (m || 0) ? r.total : m), null),
        age: ageDays(at),
        at,
      };
    });

    const scoredRows = rows.filter((r) => typeof r.total === "number");
    return {
      id: p.id,
      name: p.name,
      slots,
      unslotted,
      borrowed,
      counts: {
        slots: slots.length,
        // Two populations that disagree, so both are carried and each is named
        // where it is shown. `slots_empty` = nothing proposed at all (6 across
        // the tree); `slots_unscored` = nothing SCORED, which additionally
        // catches a slot holding unscored candidates (7). A page that prints one
        // of these without saying which is the thing to avoid here.
        slots_empty: slots.filter((s) => s.scored.length === 0 && s.candidates.length === 0).length,
        slots_unscored: slots.filter((s) => s.scored.length === 0).length,
        slots_never_run: slots.filter((s) => s.runs === 0).length,
        candidates: rows.length,
        best: scoredRows.length ? Math.max(...scoredRows.map((r) => r.total)) : null,
        estimated: rows.filter((r) => r.basis === "estimated").length,
        gaps: slots.filter((s) => s.gap).length,
      },
    };
  });

  return {
    projects,
    population: {
      ...matrix.population,
      ledger_rows: ledger.counts.total,
      in_use: ledger.counts.unexplained,
      slots: gt.counts.slots,
      generated_at: gt.generated_at,
    },
  };
}

// -------------------------------------------------------- variant A: hub ----
// One page, four levels. The route carries its own ancestry, so "back" is
// "drop the last segment" and every view is addressable.

function crumbs(parts) {
  const acc = [];
  const links = [`<a href="#/">Projects</a>`];
  for (const part of parts) {
    acc.push(part);
    links.push(`<a href="#/${acc.map(encodeURIComponent).join("/")}">${esc(decodeURIComponent(part))}</a>`);
  }
  return `<nav class="crumbs">${links.join('<span class="sep">/</span>')}</nav>`;
}

function statCell(value, label, tone) {
  const t = tone ? ` b-${tone}` : "";
  return `<div class="stat${t}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function renderL0(model) {
  const cards = model.projects
    .map((p) => {
      const c = p.counts;
      const empty = c.slots_empty
        ? statCell(c.slots_empty, c.slots_empty === 1 ? "need unanswered" : "needs unanswered", "bad")
        : statCell(0, "needs unanswered", "good");
      return `
      <a class="pcard" href="#/${encodeURIComponent(p.id)}">
        <div class="pcard-h"><b>${esc(p.id)}</b><span>${esc(p.name)}</span></div>
        <div class="stats">
          ${statCell(c.slots, c.slots === 1 ? "slot" : "slots")}
          ${empty}
          ${statCell(c.candidates, "candidates")}
          ${statCell(c.best == null ? "-" : c.best, "top score", c.best == null ? "none" : scoreBand(c.best))}
          ${statCell(c.estimated, "still estimated", c.estimated ? "warn" : "good")}
        </div>
      </a>`;
    })
    .join("");
  const empty = model.projects.reduce((n, p) => n + p.counts.slots_empty, 0);
  const unscored = model.projects.reduce((n, p) => n + p.counts.slots_unscored, 0);
  return `<h2>Every project, five numbers each</h2>
    <p class="lede">A project with nothing in it renders as zeros, never as a missing card.
    <b>Needs unanswered</b> counts declared slots with <em>no candidate proposed at all</em>
    - ${empty} of ${model.population.slots}. Read the other way, ${unscored} have nothing
    <em>scored</em>; the extra one holds candidates nobody has rated. Either number is the
    thing no other page in this app can show you, because they are all keyed on the
    candidate, and a need with no candidate has no row.</p>
    <div class="pgrid">${cards}</div>`;
}

function renderL1(model, projId) {
  const p = model.projects.find((x) => x.id === projId);
  if (!p) return noSuchView(`no project called "${projId}"`);
  if (!p.slots.length && !p.unslotted.length && !p.borrowed.length) {
    return (
      crumbs([projId]) +
      `<h2>${esc(p.name)}</h2><p class="empty">This project declares no slots and carries no
      candidates. That is an honest empty, not a loading state.</p>`
    );
  }

  const rows = p.slots
    .map((s) => {
      const n = s.scored.length;
      // "nothing scored" and "nothing proposed" are different findings and must
      // not render alike - the first is work half done, the second is a need
      // nobody has looked at.
      const filled = n
        ? chip("good", `${n} scored`)
        : s.candidates.length
          ? chip("warn", `${s.candidates.length} proposed, none scored`)
          : chip("bad", "nobody has answered this");
      const ran =
        s.runs === 0
          ? chip("warn", "never run")
          : s.age == null
            ? chip("none", "undated run")
            : chip(s.age <= 90 ? "good" : s.age <= 180 ? "warn" : "bad", `${s.age}d ago`);
      return `<tr onclick="location.hash='#/${encodeURIComponent(p.id)}/${encodeURIComponent(s.id)}'">
        <td class="k">${esc(s.id)}</td>
        <td>${esc(s.needs || "-")}</td>
        <td>${filled}</td>
        <td>${ran}</td>
        <td class="score"><span class="sn b-${scoreBand(s.best)}">${s.best == null ? "-" : s.best}</span></td>
        <td class="gap">${s.gap ? esc(s.gap) : '<span class="muted">-</span>'}</td>
      </tr>`;
    })
    .join("");

  const extra = (title, list, why) =>
    list.length
      ? `<h3>${esc(title)} <span class="n">${list.length}</span></h3><p class="lede">${why}</p>
         <table class="t"><tbody>${list
           .map(
             (r) =>
               `<tr><td class="k">${esc(r.repo)}</td><td>${esc(r.slot || "no slot")}</td>
                <td class="score"><span class="sn b-${scoreBand(r.total)}">${typeof r.total === "number" ? r.total : "unscored"}</span></td></tr>`,
           )
           .join("")}</tbody></table>`
      : "";

  return (
    crumbs([p.id]) +
    `<h2>${esc(p.name)}</h2>
     <table class="t"><thead><tr><th>slot</th><th>what it needs</th><th>candidates</th>
       <th>last run</th><th>best</th><th>gap</th></tr></thead><tbody>${rows}</tbody></table>` +
    extra(
      "Not slotted",
      p.unslotted,
      "Scored, and bound to no declared need - so no slot page will ever show them.",
    ) +
    extra("Borrowed", p.borrowed, "Scored here against another project's slot.")
  );
}

function renderL2(model, projId, slotId) {
  const p = model.projects.find((x) => x.id === projId);
  if (!p) return noSuchView(`no project called "${projId}"`);
  const s = p.slots.find((x) => x.id === slotId);
  if (!s) return noSuchView(`${projId} declares no slot called "${slotId}"`);

  const head = `<h2>${esc(s.id)}</h2>
    <p class="lede">${esc(s.needs || "no need recorded")}</p>
    <div class="stats wide">
      ${statCell(s.kind || "-", "kind")}
      ${statCell(s.runs, s.runs === 1 ? "run" : "runs", s.runs ? "good" : "warn")}
      ${statCell(s.at || "never", "last run", s.at ? "good" : "warn")}
      ${statCell(s.scored.length, "scored candidates", s.scored.length ? "good" : "bad")}
    </div>
    ${s.last_ran && s.last_ran.number ? `<p class="run"><b>Last said:</b> ${esc(s.last_ran.number)}${s.last_ran.caveat ? ` <span class="caveat">(${esc(s.last_ran.caveat)})</span>` : ""}</p>` : ""}
    ${s.gap ? `<p class="gapline">${chip("bad", "gap")} ${esc(s.gap)}</p>` : ""}`;

  if (!s.scored.length) {
    return (
      crumbs([p.id, s.id]) +
      head +
      `<p class="empty">No scored candidate for this need. That is the finding, not an empty table.</p>`
    );
  }

  const rows = s.scored
    .map(
      (r) => `<tr onclick="location.hash='#/${encodeURIComponent(p.id)}/${encodeURIComponent(s.id)}/${encodeURIComponent(r.kind + ":" + r.repo)}'">
      <td class="k">${esc(r.repo)}</td>
      <td class="score"><span class="sn b-${scoreBand(r.total)}">${typeof r.total === "number" ? r.total : "unscored"}</span></td>
      <td>${chip(r.basis === "measured" ? "good" : "warn", r.basis || "unscored")}</td>
      <td>${chip(r.licence_class === "permissive" ? "good" : r.licence_class === "restricted" ? "bad" : "none", r.licence || "not read")}</td>
      <td>${chip(r.cost_tier === "free" ? "good" : "warn", r.cost_tier || "-")}</td>
      <td>${chip(r.state === "done" ? "good" : r.state === "rejected" ? "bad" : "warn", r.state || "-")}</td>
    </tr>`,
    )
    .join("");

  return (
    crumbs([p.id, s.id]) +
    head +
    `<table class="t"><thead><tr><th>candidate</th><th>score</th><th>basis</th>
      <th>licence</th><th>cost</th><th>state</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderL3(model, projId, slotId, candId) {
  const p = model.projects.find((x) => x.id === projId);
  const s = p && p.slots.find((x) => x.id === slotId);
  if (!s) return noSuchView(`no such slot "${projId}/${slotId}"`);
  const r = s.scored.find((x) => `${x.kind}:${x.repo}` === candId);
  if (!r) return noSuchView(`no candidate "${candId}" under ${projId}/${slotId}`);

  const dims = ["effort", "effect", "time", "impact", "risk"]
    .map((k) => `<div class="stat"><b>${r[k] == null ? "-" : r[k]}</b><span>${k}</span></div>`)
    .join("");

  const field = (label, value) =>
    `<tr><th>${esc(label)}</th><td>${value ? esc(value) : '<span class="muted">absent</span>'}</td></tr>`;

  return (
    crumbs([p.id, s.id, candId]) +
    `<h2>${esc(r.repo)}</h2>
     <p class="lede">${esc(r.why || "")}</p>
     <div class="stats wide">${statCell(r.total, "score", scoreBand(r.total))}${dims}</div>
     <table class="t rec">
       ${field("kind", r.kind)}
       ${field("state", r.state)}
       ${field("verdict", r.verdict)}
       ${field("licence", r.licence)}
       ${field("hardware", r.hardware_fit)}
       ${field("note", r.note)}
       ${field("next action", r.next_action)}
     </table>
     <p class="lede">In the real page this is where the close action lives - it would post to the
     existing /api/radar/status, so the evidence gate is unchanged.</p>`
  );
}

function noSuchView(why) {
  return `<nav class="crumbs"><a href="#/">Projects</a></nav>
    <p class="empty">${chip("bad", "no such view")} ${esc(why)}. Showing nothing rather than a blank stage.</p>`;
}

function routeA(model, hash) {
  const parts = (hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return renderL0(model);
  if (parts.length === 1) return renderL1(model, parts[0]);
  if (parts.length === 2) return renderL2(model, parts[0], parts[1]);
  if (parts.length === 3) return renderL3(model, parts[0], parts[1], parts[2]);
  return noSuchView(`"${parts.join("/")}" is deeper than this hub goes`);
}

// ------------------------------------------------- variant B: front door ----
// A project index whose cards deep-link into the five pages we already have.
// No routing, no new endpoint - and no way to show a need nobody answered,
// because every page it links to is keyed on the candidate.

function renderB(model) {
  const cards = model.projects
    .map((p) => {
      const c = p.counts;
      return `
      <div class="pcard static">
        <div class="pcard-h"><b>${esc(p.id)}</b><span>${esc(p.name)}</span></div>
        <div class="stats">
          ${statCell(c.candidates, "candidates")}
          ${statCell(c.best == null ? "-" : c.best, "top score", c.best == null ? "none" : scoreBand(c.best))}
          ${statCell(c.estimated, "still estimated", c.estimated ? "warn" : "good")}
        </div>
        <div class="links">
          <a href="/stack.html?project=${encodeURIComponent(p.id)}">Ledger</a>
          <a href="/radar.html?project=${encodeURIComponent(p.id)}">Radar</a>
          <a href="/adoption-matrix.html">Matrix</a>
          <a href="/ground-truth.html">Ground truth</a>
        </div>
      </div>`;
    })
    .join("");

  const blind = model.projects.reduce((n, p) => n + p.counts.slots_empty, 0);
  return `<h2>A door per project, into the pages we already have</h2>
    <p class="lede">One file, no server code, reversible by deleting it. Every card links out;
    nothing here is new.</p>
    <p class="warnline">${chip("bad", "what this shape cannot show")}
      <b>${blind}</b> of ${model.population.slots} declared needs have no candidate at all.
      Every page these cards link to is
      keyed on the candidate, so a need nobody answered has no row anywhere and stays invisible.
      One more measured caveat: <span class="mono">stack.html?project=</span> only PREFILLS a
      search box, so these deep links are approximate rather than filtered.</p>
    <div class="pgrid">${cards}</div>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { compose, routeA, renderB, esc, ageDays, scoreBand };
}
