/**
 * Ground-truth page renderer — pulled out of ground-truth.html (H5) so the
 * page itself stays under the file-size cap once kind badges, feature
 * grouping, cost/fit columns and the two new bottom sections landed. Pure DOM
 * building from the `/api/ground-truth` response; no fetch, no state of its
 * own — `ground-truth.html` owns the fetch and hands this the parsed body.
 */
(function () {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const count = (n, k, warn) => {
    const d = el("div", warn ? "count gap" : "count");
    d.append(el("span", "n", String(n)), el("span", "k", k));
    return d;
  };

  // Shape first, never colour alone — the same law the rest of the page
  // already follows (see .mark.* in the stylesheet).
  function markCost(tier) {
    if (tier === "free") return { cls: "mk ok", text: "✅ free" };
    if (tier === "free-tier") return { cls: "mk warn", text: "⚠ free-tier" };
    if (tier === "paid-later") return { cls: "mk bad", text: "⛔ paid-later" };
    return null;
  }

  function markFit(fit, mib) {
    const suffix = Number.isInteger(mib) ? ` (${mib} MiB)` : "";
    if (fit === "fits-gpu" || fit === "fits-cpu") return { cls: "mk ok", text: `✅ ${fit}${suffix}` };
    if (fit === "unmeasured") return { cls: "mk warn", text: `⚠ unmeasured${suffix}` };
    if (fit === "too-big-here") return { cls: "mk bad", text: `⛔ too-big${suffix}` };
    return null;
  }

  function renderCandidate(c) {
    const line = el("span", "cand");
    const a = el("a", null, c.title);
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener";
    if (c.source === "ledger") {
      line.append(el("span", "pill ledger", "ledger"), document.createTextNode(" "), a);
    } else {
      line.append(
        el("span", c.status === "runnable" ? "pill runnable" : "pill needs",
           c.status === "runnable" ? "runs" : "asks you"),
        document.createTextNode(" "),
        a
      );
    }
    const bits = [];
    const cost = markCost(c.cost_tier);
    if (cost) bits.push(cost);
    const fit = markFit(c.hardware_fit, c.hardware_mib);
    if (fit) bits.push(fit);
    if (c.state) bits.push({ cls: "mk", text: `state ${c.state}` });
    if (c.score_total !== null && c.score_total !== undefined) {
      bits.push({ cls: "mk", text: `score ${c.score_total}` });
    }
    if (bits.length) {
      const metaLine = el("span", "caveat");
      for (const b of bits) {
        metaLine.append(el("span", b.cls, b.text), document.createTextNode(" "));
      }
      line.append(metaLine);
    }
    // The reason comes from the gate itself, never re-derived here.
    if (c.why) line.append(el("span", "caveat", c.why));
    return line;
  }

  function renderSlotRow(slot) {
    const tr = el("tr");

    // Shape first: ran / never / declared gap. Readable without colour.
    const ranAtAll = slot.runs > 0;
    const markCls = ranAtAll ? "mark ran" : slot.gap ? "mark gapmark" : "mark never";
    const markTxt = ranAtAll ? "●" : slot.gap ? "—" : "◇";
    const tdMark = el("td");
    tdMark.append(el("span", markCls, markTxt));
    tr.append(tdMark);

    const tdSlot = el("td");
    tdSlot.append(el("span", "kindbadge", slot.kind), document.createTextNode(" " + slot.id));
    if (slot.note) tdSlot.append(el("span", "caveat", slot.note));
    tr.append(tdSlot);

    tr.append(el("td", "mono", slot.instrument || "—"));

    const tdRan = el("td");
    if (slot.last_ran) {
      tdRan.append(el("span", "number", slot.last_ran.number || "ran"));
      const ref = [slot.last_ran.reference, slot.last_ran.n ? `n=${slot.last_ran.n}` : null,
                   slot.last_ran.at]
        .filter(Boolean)
        .join(" · ");
      if (ref) tdRan.append(el("span", "caveat", ref));
      if (slot.last_ran.caveat) tdRan.append(el("span", "caveat", slot.last_ran.caveat));
    } else if (slot.gap) {
      tdRan.append(el("span", "gaptext", slot.gap));
    } else {
      tdRan.append(el("span", "never", "never run"));
    }
    tr.append(tdRan);

    const tdC = el("td");
    if (!slot.candidates.length) {
      tdC.append(el("span", "dim", "—"));
    } else {
      if (!slot.subject_declared) {
        tdC.append(el("span", "unvetted", slot.unvetted_caveat));
      }
      for (const c of slot.candidates.slice(0, 6)) tdC.append(renderCandidate(c));
      if (slot.candidates.length > 6) {
        tdC.append(el("span", "dim", `+${slot.candidates.length - 6} more`));
      }
    }
    tr.append(tdC);
    return tr;
  }

  /** Slots grouped by feature — the id, in slot order, so declaration order
   *  survives the regroup instead of a re-sort inventing one. */
  function groupByFeature(slots) {
    const order = [];
    const groups = new Map();
    for (const s of slots) {
      const key = s.feature ? s.feature.id : "";
      const label = s.feature ? s.feature.label : "No feature declared";
      if (!groups.has(key)) {
        groups.set(key, { label, slots: [] });
        order.push(key);
      }
      groups.get(key).slots.push(s);
    }
    return order.map((k) => groups.get(k));
  }

  function renderSlotTable(slots) {
    const wrap = el("div", "tablewrap");
    const table = el("table");
    const cg = el("colgroup");
    for (const c of ["c-mark", "c-slot", "c-inst", "c-ran", "c-cand"]) cg.append(el("col", c));
    table.append(cg);
    const thead = el("thead");
    const htr = el("tr");
    for (const t of ["", "Slot", "Instrument", "Last run", "Candidates"]) htr.append(el("th", null, t));
    thead.append(htr);
    table.append(thead);
    const tb = el("tbody");
    for (const s of slots) tb.append(renderSlotRow(s));
    table.append(tb);
    wrap.append(table);
    return wrap;
  }

  function renderProject(p) {
    const sec = el("section", "proj");
    const h = el("h2");
    h.append(document.createTextNode(p.name), el("span", "id", p.id));
    sec.append(h);

    if (!p.slots.length) {
      sec.append(el("p", "empty", "No instrument declared for this project yet."));
    } else {
      for (const group of groupByFeature(p.slots)) {
        sec.append(el("h3", "feature", group.label));
        sec.append(renderSlotTable(group.slots));
      }
    }

    if (p.near_misses.length) {
      const m = el("div", "misses");
      m.append(el("h3", null, `Near misses (${p.near_misses.length})`));
      m.append(el("p", "why",
        "Matched this project but no instrument. Not a defect - this is the corpus for the next slot, and the reason names the gate that refused it."));
      const ul = el("ul");
      for (const n of p.near_misses.slice(0, 10)) {
        const li = el("li");
        const a = el("a", null, n.title);
        a.href = n.url;
        a.target = "_blank";
        a.rel = "noopener";
        li.append(a, document.createTextNode(` — ${n.reason} (${n.kind})`));
        ul.append(li);
      }
      m.append(ul);
      sec.append(m);
    }
    return sec;
  }

  /** One line, ledger-first: a ledger row's authored `why` before a slot's
   *  terser inline text. Matches modules/digest-sections.js's ordering. */
  function renderParked(entry) {
    const li = el("li");
    if (entry.source === "slot") {
      li.append(el("span", "mono", `${entry.project}/${entry.slot}`), document.createTextNode(` — ${entry.text}`));
    } else {
      const who = entry.projects && entry.projects.length ? ` (${entry.projects.join(", ")})` : "";
      li.append(el("span", "mono", entry.repo), document.createTextNode(`${who}${entry.why ? ` — ${entry.why}` : ""}`));
    }
    return li;
  }

  function renderParkedPaid(parkedPaid) {
    const sec = el("section", "parked");
    sec.append(el("h2", null, "💸 Parked: paid-later"));
    if (!parkedPaid.length) {
      sec.append(el("p", "empty", "Nothing parked on cost right now."));
      return sec;
    }
    const ul = el("ul", "parkedlist");
    for (const e of parkedPaid) ul.append(renderParked(e));
    sec.append(ul);
    return sec;
  }

  function renderFunnelStrip(funnelData) {
    const weeks = (funnelData && funnelData.weeks) || [];
    const counts = (funnelData && funnelData.counts) || {};
    const strip = el("div", "funnelstrip");
    if (!weeks.length) return strip;
    const totals = { proposed: 0, accepted: 0, trial: 0, done: 0, rejected: 0 };
    for (const wk of weeks) {
      const c = counts[wk] || {};
      for (const stage of Object.keys(totals)) totals[stage] += c[stage] || 0;
    }
    strip.append(el("span", "k", `Funnel, ${weeks.length} weeks (${weeks[0]}..${weeks[weeks.length - 1]}):`));
    for (const [stage, n] of Object.entries(totals)) {
      strip.append(el("span", "funnelstage", `${stage} ${n}`));
    }
    return strip;
  }

  function render(data) {
    const c = data.counts || {};
    const counts = document.getElementById("counts");
    counts.append(
      count(c.slots || 0, "instruments"),
      count(c.slots_with_a_run || 0, "have a number"),
      count(c.slots_never_run || 0, "never checked", (c.slots_never_run || 0) > 0),
      count(c.slots_recording_a_gap || 0, "recorded gap"),
      count(c.candidates_unvetted || 0, "shape-only, unvetted", (c.candidates_unvetted || 0) > 0),
      count(c.runnable || 0, "runs without asking"),
      count(c.needs_you || 0, "asks you first", (c.needs_you || 0) > 0),
      count(c.near_misses || 0, "near misses"),
      count((c.parked_paid || []).length, "parked: paid-later")
    );
    document.getElementById("funnel").append(renderFunnelStrip(c.funnel));
    const box = document.getElementById("projects");
    for (const p of data.projects || []) box.append(renderProject(p));
    document.getElementById("parked-wrap").append(renderParkedPaid(c.parked_paid || []));
    document.getElementById("generated").textContent =
      "generated " + (data.generated_at || "").replace("T", " ").slice(0, 19) + " UTC";
  }

  window.GroundTruthRender = { render };
})();
