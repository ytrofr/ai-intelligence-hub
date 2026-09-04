/**
 * The projects hub, rendered.
 *
 * Every function here is PURE: it takes the model and returns an HTML string.
 * Nothing touches `document`, nothing fetches, so the whole render surface is
 * unit-testable with no DOM - one step stricter than adoption-matrix-render.js,
 * whose renderMatrix() reaches for the document.
 *
 * Two things this page must never do, and both are testable because of that:
 *
 *   - Drop an unanswered need. A slot with no candidate is the row that no
 *     other page in this app can show, so it renders LOUDEST, not smallest.
 *   - Let colour travel alone. Every state carries a glyph AND a word, because
 *     the operator cannot rely on hue. chip() cannot omit either.
 *
 * The route carries its own ancestry (#/project/slot/candidate), so "back" is
 * "drop the last segment" and every view is addressable. An unrecognised hash
 * renders an explicit no-such-view line, never a blank stage.
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

/** The score bands, and the reason they are coarse: every score is a multiple
 *  of 4 (five 1-5 dimensions over 25), so the number cannot rank inside a band. */
const scoreBand = (n) => (typeof n !== "number" ? "none" : n >= 80 ? "good" : n >= 65 ? "mid" : "poor");

const scoreText = (n) => (typeof n === "number" ? String(n) : "unscored");

/** A slot's headline state - the same three words the model uses, never a fourth. */
function slotChip(slot) {
  if (slot.state === "scored") {
    const n = slot.scored.length;
    return chip("good", `${n} scored`);
  }
  if (slot.state === "unscored") {
    return chip("warn", `${slot.candidates.length} proposed, none scored`);
  }
  return chip("bad", "nobody has answered this");
}

/** How long since this instrument last ran. Never-run and undated are their own
 *  states - neither may read as fresh, and neither is an age of 0. */
function runChip(slot) {
  if (slot.runs === 0) return chip("warn", "never run");
  if (slot.age_days == null) return chip("none", "undated run");
  const d = slot.age_days;
  return chip(d <= 90 ? "good" : d <= 180 ? "warn" : "bad", `${d}d ago`);
}

/** An eval's freshness, straight from the model - the page never recomputes it. */
function evalChip(fresh) {
  if (!fresh) return "";
  const level = { running: "good", due: "warn", stalled: "bad", "slot-missing": "bad" }[fresh.state] || "none";
  const detail =
    fresh.state === "not-wired"
      ? "No recurring eval is declared on this row. Absent is legal - it is simply not a claim."
      : fresh.state === "slot-missing"
        ? `The eval names ${fresh.slot}, which no project declares - nothing can check it.`
        : fresh.cadence_days
          ? `cadence ${fresh.cadence_days}d, stalled at ${fresh.cadence_days * 2}d`
          : "";
  return chip(level, fresh.word, detail);
}

const href = (...parts) => `#/${parts.map(encodeURIComponent).join("/")}`;

function crumbs(parts) {
  const acc = [];
  const links = [`<a href="#/">Projects</a>`];
  for (const part of parts) {
    acc.push(part);
    links.push(`<a href="${href(...acc)}">${esc(part)}</a>`);
  }
  return `<nav class="crumbs">${links.join('<span class="sep">/</span>')}</nav>`;
}

function statCell(value, label, tone) {
  const t = tone ? ` b-${tone}` : "";
  return `<div class="stat${t}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function noSuchView(why) {
  return `<nav class="crumbs"><a href="#/">Projects</a></nav>
    <p class="empty">${chip("bad", "no such view")} ${esc(why)}. Showing this rather than a blank stage.</p>`;
}

// ------------------------------------------------------------------ L0 -----

function renderL0(model) {
  const p = model.population;
  const cards = model.projects
    .map((proj) => {
      const c = proj.counts;
      // The unanswered-needs cell is the loudest thing on the card when it is
      // non-zero, because it is the only number here that no other page in this
      // app is capable of showing.
      const empty = c.slots_empty
        ? statCell(c.slots_empty, c.slots_empty === 1 ? "need unanswered" : "needs unanswered", "bad")
        : statCell(0, "needs unanswered", "good");
      return `
      <a class="pcard" href="${href(proj.id)}">
        <div class="pcard-h"><b>${esc(proj.id)}</b><span>${esc(proj.name)}</span></div>
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

  return `<h2>Every project, five numbers each</h2>
    <p class="lede">A project with nothing in it renders as zeros, never as a missing card.
    <b>Needs unanswered</b> counts declared slots with <em>no candidate proposed at all</em> -
    ${p.slots_empty} of ${p.slots}. Read the other way, ${p.slots_unscored} have nothing
    <em>scored</em>; the extra ones hold candidates nobody has rated. Either number is the
    thing no other page here can show you, because they are all keyed on the candidate, and
    a need with no candidate has no row.</p>
    <div class="pgrid">${cards}</div>
    ${renderShared(model.shared)}`;
}

/**
 * What two projects have BOTH taken on.
 *
 * The operator's ask, in their words: a ledger "so we dont see too many
 * information and jump straight to understanding" - and the reason this list
 * matters is that without it one project rediscovers what another already
 * solved. Zero is a real answer and gets a sentence, not a hidden section.
 */
function renderShared(shared) {
  const list = Array.isArray(shared) ? shared : [];
  if (!list.length) {
    return `<h3>Adopted by more than one project <span class="n">0</span></h3>
      <p class="lede">Nothing here is shared yet. That is a finding, not an empty list -
      it means every adoption so far has been made by exactly one project.</p>`;
  }
  const rows = list
    .map(
      (r) => `<tr><td class="k">${esc(r.repo)}</td>
        <td>${r.projects.map((p) => `<a href="${href(p)}">${esc(p)}</a>`).join(", ")}</td>
        <td class="muted">${esc(r.why || "")}</td></tr>`,
    )
    .join("");
  return `<h3>Adopted by more than one project <span class="n">${list.length}</span></h3>
    <p class="lede">Counted from each project's OWN decision, never from the merged row -
    the merge is first-authored-wins, so reading its state would credit a project with
    somebody else's adoption.</p>
    <table class="t"><tbody>${rows}</tbody></table>`;
}

// ------------------------------------------------------------------ L1 -----

function renderL1(model, projId) {
  const p = model.projects.find((x) => x.id === projId);
  if (!p) return noSuchView(`no project called "${projId}"`);

  if (!p.slots.length && !p.unslotted.length && !p.borrowed.length && !p.orphaned.length) {
    return (
      crumbs([projId]) +
      `<h2>${esc(p.name)}</h2><p class="empty">This project declares no slots and carries no
      candidates. That is an honest empty, not a loading state.</p>`
    );
  }

  const rows = p.slots
    .map(
      (s) => `<tr class="clickable" data-href="${href(p.id, s.id)}">
        <td class="k">${esc(s.id)}</td>
        <td>${esc(s.needs || "-")}</td>
        <td>${slotChip(s)}</td>
        <td>${runChip(s)}</td>
        <td class="score"><span class="sn b-${scoreBand(s.best)}">${s.best == null ? "-" : s.best}</span></td>
        <td class="gap">${s.gap ? esc(s.gap) : '<span class="muted">-</span>'}</td>
      </tr>`,
    )
    .join("");

  const slotTable = p.slots.length
    ? `<table class="t"><thead><tr><th>slot</th><th>what it needs</th><th>candidates</th>
        <th>last run</th><th>best</th><th>gap</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">This project declares no slots, so nothing here is bound to a need.</p>`;

  // Three classes that a naive slot.startsWith(project) would silently lose.
  // Each is a finding, so each gets a heading with its own count and reason.
  const extra = (title, list, why) =>
    list.length
      ? `<h3>${esc(title)} <span class="n">${list.length}</span></h3><p class="lede">${why}</p>
         <table class="t"><tbody>${list
           .map(
             (r) =>
               `<tr><td class="k">${esc(r.repo)}</td><td>${esc(r.slot || "no slot")}</td>
                <td class="score"><span class="sn b-${scoreBand(r.total)}">${scoreText(r.total)}</span></td></tr>`,
           )
           .join("")}</tbody></table>`
      : "";

  return (
    crumbs([p.id]) +
    `<h2>${esc(p.name)}</h2>` +
    slotTable +
    extra("Not slotted", p.unslotted, "Scored, and bound to no declared need - so no slot page will ever show them.") +
    extra("Borrowed", p.borrowed, "Scored here against another project's slot.") +
    extra("Orphaned", p.orphaned, "Naming a slot this project does not declare - a config drift, not a candidate.")
  );
}

// ------------------------------------------------------------------ L2 -----

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
      ${statCell(s.last_ran_at || "never", "last run", s.last_ran_at ? "good" : "warn")}
      ${statCell(s.scored.length, "scored candidates", s.scored.length ? "good" : "bad")}
    </div>
    ${s.instrument ? `<p class="inst"><b>Instrument:</b> <code>${esc(s.instrument)}</code></p>` : ""}
    ${
      s.last_ran && s.last_ran.number
        ? `<p class="run"><b>Last said:</b> ${esc(s.last_ran.number)}${
            s.last_ran.caveat ? ` <span class="caveat">(${esc(s.last_ran.caveat)})</span>` : ""
          }</p>`
        : ""
    }
    ${s.gap ? `<p class="gapline">${chip("bad", "gap")} ${esc(s.gap)}</p>` : ""}
    ${
      // The slot has not declared what it is ABOUT, so its candidates are the
      // right SHAPE of data and not proven answer keys. The text comes from the
      // payload - spelling it here would fork the caveat away from the constant
      // that owns it, and a guard exists to catch exactly that.
      s.unvetted_caveat
        ? `<p class="unvetted">${chip("warn", "subject not declared")} ${esc(s.unvetted_caveat)}</p>`
        : ""
    }`;

  if (!s.scored.length) {
    const proposed = s.candidates.length
      ? `<p class="empty">${chip("warn", `${s.candidates.length} proposed, none scored`)}
         Something has been suggested for this need but nobody has rated it.</p>
         <table class="t"><tbody>${s.candidates
           .map((c) => `<tr><td class="k">${esc(c.repo || c.title || c.id)}</td><td class="muted">unscored</td></tr>`)
           .join("")}</tbody></table>`
      : `<p class="empty">${chip("bad", "nobody has answered this")}
         No candidate has ever been proposed for this need. That is the finding, not an empty table.</p>`;
    return crumbs([p.id, s.id]) + head + proposed;
  }

  const rows = s.scored
    .map(
      (r) => `<tr class="clickable" data-href="${href(p.id, s.id, `${r.kind}:${r.repo}`)}">
      <td class="k">${esc(r.repo)}</td>
      <td class="score"><span class="sn b-${scoreBand(r.total)}">${scoreText(r.total)}</span></td>
      <td>${chip(r.basis === "measured" ? "good" : "warn", r.basis || "unscored")}</td>
      <td>${chip(
        r.licence_class === "permissive" ? "good" : r.licence_class === "restricted" ? "bad" : "none",
        r.licence || "not read",
      )}</td>
      <td>${evalChip(r.eval_freshness)}</td>
      <td>${chip(r.state === "done" ? "good" : r.state === "rejected" ? "bad" : "warn", r.state || "-")}</td>
      <td class="next">${esc(r.next_action || "-")}</td>
    </tr>`,
    )
    .join("");

  return (
    crumbs([p.id, s.id]) +
    head +
    `<table class="t"><thead><tr><th>candidate</th><th>score</th><th>basis</th>
      <th>licence</th><th>eval</th><th>state</th><th>next</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

// ------------------------------------------------------------------ L3 -----

/**
 * One record, and the close action.
 *
 * The form posts to the EXISTING /api/radar/status, so the evidence gate is
 * exactly the gate every other surface goes through - this page adds no way to
 * close a row that stack.html does not already have. A refusal is rendered
 * verbatim, because the gate's message names the missing field and that is the
 * most useful thing on the screen.
 */
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
     <div class="stats wide">${statCell(scoreText(r.total), "score", scoreBand(r.total))}${dims}</div>
     <p class="chips">${evalChip(r.eval_freshness)} ${chip(
       r.basis === "measured" ? "good" : "warn",
       r.basis === "measured" ? "score measured" : "score estimated",
     )}</p>
     <table class="t rec">
       ${field("kind", r.kind)}
       ${field("state", r.state)}
       ${field("verdict", r.verdict)}
       ${field("licence", r.licence)}
       ${field("hardware", r.hardware_fit)}
       ${field("note", r.note)}
       ${field("next action", r.next_action)}
     </table>
     ${renderCloseForm(p.id, r)}`
  );
}

/**
 * The close form.
 *
 * Deliberately NOT rendered for a row that is already closed: reopening a
 * `done` row runs `delete row.evidence; delete row.lesson; delete row.done_at`,
 * and on a gitignored file with no history that permanently destroys the
 * highest-value content in the ledger. There is no undo, so there is no button.
 */
function renderCloseForm(projectId, r) {
  if (r.state === "done" || r.state === "rejected") {
    return `<p class="closed">${chip("good", `already ${r.state}`)}
      This row is closed. Reopening it deletes its evidence and its lesson permanently -
      the config is gitignored, so there is no undo - which is why there is no button here.</p>`;
  }
  return `<form class="close" data-project="${esc(projectId)}" data-repo="${esc(r.repo)}">
      <h3>Close this row</h3>
      <p class="lede">Posts to the same <code>/api/radar/status</code> every other surface uses.
      The gate validates before it writes, so a refusal leaves the row byte-identical.</p>
      <label>status
        <select name="status">
          <option value="done">done</option>
          <option value="rejected">rejected</option>
        </select>
      </label>
      <label>evidence <input name="evidence" placeholder="commit, PR or report path" /></label>
      <label>lesson <input name="lesson" placeholder="the rule this taught us" /></label>
      <button type="submit">Close</button>
      <p class="formmsg" role="status"></p>
    </form>`;
}

// --------------------------------------------------------------- routing ---

/**
 * Hash to view. The route carries its own ancestry, so "back" is "drop the last
 * segment" and there is no history stack to keep in sync.
 */
function route(model, hash) {
  const parts = String(hash || "")
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    });
  if (parts.length === 0) return renderL0(model);
  if (parts.length === 1) return renderL1(model, parts[0]);
  if (parts.length === 2) return renderL2(model, parts[0], parts[1]);
  if (parts.length === 3) return renderL3(model, parts[0], parts[1], parts[2]);
  return noSuchView(`"${parts.join("/")}" is deeper than this hub goes`);
}

/** The provenance line. Every number in it comes from the payload, never typed. */
function renderFooter(model, generatedAt) {
  const p = model.population;
  return `live /api/projects-hub at ${esc(generatedAt || "-")} &middot;
    ${p.projects} projects &middot; ${p.slots} slots (${p.slots_empty} with nothing proposed) &middot;
    ${p.candidates} ${p.candidates === 1 ? "candidate" : "candidates"} of ${p.ledger_rows} ledger rows &middot;
    ${p.unslotted} not slotted &middot; ${p.borrowed} borrowed &middot; ${p.orphaned} orphaned`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    route,
    renderShared,
    renderL0,
    renderL1,
    renderL2,
    renderL3,
    renderCloseForm,
    renderFooter,
    noSuchView,
    chip,
    evalChip,
    slotChip,
    runChip,
    scoreBand,
    scoreText,
    crumbs,
    esc,
  };
}
