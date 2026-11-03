/**
 * Source `company-orgs` - read every repo each tracked company CREATED (2026-11-03).
 *
 * Why a list and not a search: GitHub's own per-org repo listing is the complete
 * population of what a company published. Trending pages, topic searches and star
 * floors are samples; the audit measured them at 34% recall on 103 big-company repos.
 * One core-API call per org per day (~45 calls), well inside 5,000/hour.
 *
 * Findings go to company_repos (database/company-store.js), not the items feed:
 * the inbox is read by the Monday page, and returning feed items here would re-apply
 * the digest's star floor that hid these repos in the first place.
 */
const fs = require("fs");
const path = require("path");
const BaseModule = require("./base-module");
const { fetchResponse } = require("./http");
const { PartialFetchError } = require("./fetch-runner");

const API = "https://api.github.com";
const DAY_MS = 86400000;
const REGISTRY = path.join(__dirname, "..", "config", "companies.json");

/** Registry -> one entry per org, with its company, tier and floor. Throws on a bad registry. */
function flattenRegistry(reg) {
  const out = [];
  const seen = new Map();
  for (const c of reg.companies || []) {
    const tier = reg.tiers && reg.tiers[c.tier];
    if (!tier || !Number.isFinite(tier.floor)) throw new Error(`company ${c.id}: tier ${c.tier} has no floor`);
    for (const org of c.orgs || []) {
      const key = org.toLowerCase();
      if (seen.has(key)) throw new Error(`org ${org} is listed twice (${seen.get(key)} and ${c.id})`);
      seen.set(key, c.id);
      out.push({ org, company: c.id, tier: c.tier, floor: tier.floor });
    }
  }
  return out;
}

/** Pure: should this GitHub repo be recorded, and is it above its floor? */
function decideRepo(repo, { floor, now, trackDays }) {
  if (repo.fork || repo.archived) return { record: false, aboveFloor: false };
  const created = Date.parse(repo.created_at);
  if (!Number.isFinite(created) || created < now.getTime() - trackDays * DAY_MS) return { record: false, aboveFloor: false };
  return { record: true, aboveFloor: (Number(repo.stargazers_count) || 0) >= floor };
}

/**
 * One pass over every org. `listRepos(org, {sinceMs})` returns GitHub repo objects
 * newest-created first. Returns {checked, failed:[{org,error}], recorded, crossed}.
 * Throws only when EVERY org failed - one bad org is a partial run, never a silent one.
 */
async function runCompanySensor({ orgs, store, listRepos, now, trackDays, baselineDays, concurrency = 4 }) {
  const nowIso = now.toISOString();
  const failed = [];
  let checked = 0;
  let recorded = 0;
  let crossed = 0;
  const queue = [...orgs];
  const worker = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      const firstRead = !(store.org(o.org) || {}).first_read_at;
      const window = firstRead ? Math.max(trackDays, baselineDays) : trackDays;
      try {
        const repos = await listRepos(o.org, { sinceMs: now.getTime() - window * DAY_MS });
        for (const repo of repos) {
          const d = decideRepo(repo, { floor: o.floor, now, trackDays: window });
          if (!d.record) continue;
          const before = store.get(repo.full_name);
          store.upsert({ ...o, repo, baseline: firstRead }, nowIso);
          recorded += 1;
          if (d.aboveFloor && !(before && before.floor_crossed_at)) crossed += 1;
        }
        store.saveOrg({ org: o.org, company: o.company, status: "ok", listed: repos.length }, nowIso);
        checked += 1;
      } catch (err) {
        const error = String((err && err.message) || err).slice(0, 200);
        failed.push({ org: o.org, error });
        store.saveOrg({ org: o.org, company: o.company, status: "error", error }, nowIso);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, orgs.length) }, worker));
  failed.sort((a, b) => a.org.localeCompare(b.org));
  if (orgs.length && checked === 0) throw new Error(`company-orgs: every org failed (${failed.length}): ${failed[0].error}`);
  return { checked, failed, recorded, crossed };
}

/** GitHub lister: newest-created first, paging only while the page is still inside the window. */
function ghLister({ token = process.env.GITHUB_TOKEN, timeoutMs = 20000, maxPages = 3 } = {}) {
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const get = async (url) => (await fetchResponse(url, { headers, timeoutMs })).json();
  return async (org, { sinceMs }) => {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const q = `sort=created&direction=desc&per_page=100&page=${page}`;
      let rows;
      try {
        rows = await get(`${API}/orgs/${org}/repos?type=public&${q}`);
      } catch (err) {
        // A user account, not an org, answers 404 here - ask the users endpoint once.
        if (page === 1 && err && err.status === 404) rows = await get(`${API}/users/${org}/repos?${q}`);
        else throw err;
      }
      if (!Array.isArray(rows)) throw new Error(`unexpected response for ${org}`);
      all.push(...rows);
      const oldest = rows.length ? Date.parse(rows[rows.length - 1].created_at) : 0;
      if (rows.length < 100 || oldest < sinceMs) break;
    }
    return all;
  };
}

class CompanyOrgsModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
  }

  async fetch() {
    const db = this.deps.db || require("../database/db");
    const reg = this.deps.registry || JSON.parse(fs.readFileSync(REGISTRY, "utf-8"));
    const d = reg.defaults || {};
    const token = this.deps.token !== undefined ? this.deps.token : process.env.GITHUB_TOKEN;
    if (!token && !this.deps.listRepos) throw new Error("GITHUB_TOKEN is required for company-orgs (core quota is 60/h without it)");
    const r = await runCompanySensor({
      orgs: flattenRegistry(reg),
      store: db.companies,
      listRepos: this.deps.listRepos || ghLister({ token, timeoutMs: this.config.timeout_ms, maxPages: d.max_pages || 3 }),
      now: this.deps.now || new Date(),
      trackDays: d.track_days || 60,
      baselineDays: d.baseline_days || 60,
    });
    this.runReport = { orgs_checked: r.checked, orgs_failed: r.failed.length, recorded: r.recorded, crossed_floor: r.crossed };
    console.log(`[companies] checked ${r.checked} orgs · ${r.recorded} repos in window · ${r.crossed} newly above floor · ${r.failed.length} orgs failed`);
    if (r.failed.length) {
      throw new PartialFetchError(`${r.failed.length} org(s) failed: ${r.failed.map((f) => `${f.org} (${f.error})`).join("; ")}`, [], this.runReport);
    }
    return [];
  }
}

module.exports = CompanyOrgsModule;
module.exports.flattenRegistry = flattenRegistry;
module.exports.decideRepo = decideRepo;
module.exports.runCompanySensor = runCompanySensor;
module.exports.ghLister = ghLister;
