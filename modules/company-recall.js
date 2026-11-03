/**
 * Weekly recall check of the company sensor (2026-11-03).
 *
 * The audit behind the company sensor measured 34% recall on big-company repos. This
 * check is what notices if the sensor ever falls back to that. It asks GitHub SEARCH
 * (org:X created:>=D stars:>=floor) - a different endpoint from the org listing the
 * sensor reads, so the two can disagree - and compares the answer with company_repos.
 *
 * Status (worst wins):
 *   error - an org's search failed: the week cannot be judged, which is not green
 *   red   - a tier-1 repo >= alarmStars created in the last alarmDays was never recorded;
 *           or the planted absent repo was judged found (the matcher says yes to anything);
 *           or no positive control fired (the instrument proved nothing this week)
 *   green - otherwise. Older, smaller and lower-tier misses are listed, not alarmed.
 *
 * Controls: named repos (companies.json recall_controls) must be both returned by search
 * and recorded by the sensor - FIRED; EXPIRED once created before the window; ABSENT
 * otherwise. Only live controls count, so an expired list forces a new one to be named.
 */
const fs = require("fs");
const path = require("path");

const DAY_MS = 86400000;
const PLANTED = "zz-recall-probe/planted-absent";
const RESULT_FILE = path.join(__dirname, "..", "data", "company-recall.json");

const lc = (s) => String(s).toLowerCase();

/** Pure verdict. `recorded` is anything with has(lowercased repo). */
function judgeRecall({ population, recorded, controls = [], orgErrors = [], now, windowDays, alarmDays, alarmStars }) {
  const reasons = [];
  const found = (r) => recorded.has(lc(r));
  const windowStart = now.getTime() - windowDays * DAY_MS;
  const alarmStart = now.getTime() - alarmDays * DAY_MS;

  const negative = found(PLANTED) ? "FAILED" : "PASSED";
  if (negative === "FAILED") reasons.push(`the planted repo ${PLANTED} was judged found - the matcher cannot say no`);

  const byTier = {};
  const missing = [];
  // Search filters by whole days (created:>=YYYY-MM-DD); the sensor's window starts at an
  // exact time. Without this cut a repo made on the first day, before that time, reads
  // as a miss - the first real run's only "miss" was exactly that.
  const inWindow = population.filter((p) => Date.parse(p.created_at) >= windowStart);
  for (const p of inWindow) {
    const t = (byTier[p.tier] = byTier[p.tier] || { population: 0, found: 0 });
    t.population += 1;
    if (found(p.repo)) t.found += 1;
    else missing.push(p);
  }
  for (const m of missing) {
    if (m.tier === 1 && m.stars >= alarmStars && Date.parse(m.created_at) >= alarmStart) {
      reasons.push(`tier-1 ${m.repo} (${m.stars} stars, created ${String(m.created_at).slice(0, 10)}) was never recorded`);
    }
  }

  const inPop = new Set(inWindow.map((p) => lc(p.repo)));
  const ctl = controls.map((c) => {
    if (Date.parse(c.created_at) < windowStart) return { repo: c.repo, state: "EXPIRED" };
    return { repo: c.repo, state: inPop.has(lc(c.repo)) && found(c.repo) ? "FIRED" : "ABSENT" };
  });
  if (!ctl.some((c) => c.state === "FIRED")) reasons.push("no positive control fired - name a recent big repo in companies.json recall_controls");

  for (const e of orgErrors) reasons.unshift(`search failed for ${e.org}: ${e.error}`);
  const status = orgErrors.length ? "error" : reasons.length ? "red" : "green";
  missing.sort((a, b) => a.tier - b.tier || b.stars - a.stars);
  return { status, reasons, population: inWindow.length, outside_window: population.length - inWindow.length, byTier, missing, controls: ctl, negative };
}

/** Reads search for every registry org, judges, writes data/company-recall.json. */
async function runRecall({ db, registry, now = new Date(), search, windowDays, alarmDays = 14, alarmStars = 50 }) {
  const { flattenRegistry } = require("./company-orgs");
  const d = registry.defaults || {};
  const days = windowDays || d.track_days || 60;
  const since = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const population = [];
  const orgErrors = [];
  for (const o of flattenRegistry(registry)) {
    const q = `org:${o.org} created:>=${since} stars:>=${o.floor} fork:false archived:false`;
    try {
      const r = await search(q, { perPage: 100 });
      if (r.status !== "ok") throw new Error(`search ${r.status}`);
      if ((r.data.total_count || 0) > 100) orgErrors.push({ org: o.org, error: `${r.data.total_count} results, only 100 read` });
      for (const it of r.data.items || []) {
        population.push({ repo: it.full_name, org: o.org, company: o.company, tier: o.tier, stars: it.stargazers_count, created_at: it.created_at });
      }
    } catch (err) {
      orgErrors.push({ org: o.org, error: String((err && err.message) || err).slice(0, 120) });
    }
  }
  const names = db.companies.allRepoNames().map(lc);
  const result = {
    ran_at: now.toISOString(),
    window_days: days,
    ...judgeRecall({ population, recorded: new Set(names), controls: registry.recall_controls || [], orgErrors, now, windowDays: days, alarmDays, alarmStars }),
  };
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 1));
  return result;
}

function readLastRecall(file = RESULT_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** One line for the brief: what was checked, and the verdict. */
function recallLine(r) {
  if (!r) return "> Recall check: has not run yet - nothing proves the company list is complete";
  const t1 = r.byTier && r.byTier[1];
  const all = Object.values(r.byTier || {}).reduce((a, t) => ({ p: a.p + t.population, f: a.f + t.found }), { p: 0, f: 0 });
  const fired = (r.controls || []).filter((c) => c.state === "FIRED").length;
  const head = `> Recall check ${String(r.ran_at).slice(0, 10)} (GitHub search vs our list): tier 1 ${t1 ? `${t1.found}/${t1.population}` : "0/0"} · all ${all.f}/${all.p} · ${fired} control${fired === 1 ? "" : "s"} fired · planted miss ${r.negative}`;
  return r.status === "green" ? `${head} · GREEN` : `${head} · **${r.status.toUpperCase()}**: ${r.reasons.slice(0, 2).join("; ")}`;
}

module.exports = { judgeRecall, runRecall, readLastRecall, recallLine, PLANTED, RESULT_FILE };
