/**
 * Tracked repos — the daily upstream check, registered as a SOURCE.
 *
 * Registering it as a source rather than a cron job is the point: it inherits
 * the fetch pipeline's honesty for free. A broken tracker shows up in
 * /api/health the same morning as `last_status: error`, even though what it
 * FINDS is only reported weekly in the digest. A tracker that fails silently
 * for a month and then reports "no changes" is the failure mode this avoids.
 *
 * Per repo: GET /repos/{slug}, and GET /repos/{slug}/releases/latest. The HTTP
 * status is recorded verbatim — 200, 301 (moved), 404 (gone) — because those
 * three ARE three of the six events. A 5xx is not an answer about upstream at
 * all, so it records an error and leaves the last good snapshot alone.
 */

const fs = require("fs");
const path = require("path");
const BaseModule = require("./base-module");
const { fetchResponse } = require("./http");
const { diffRepo } = require("./tracker-diff");
const { buildPool, POSITIVE_CONTROL } = require("./tracked-pool");
const { createResolver } = require("./dep-resolve");
const { readDeps } = require("./project-deps");

const API = "https://api.github.com";
const CONCURRENCY = 5;

function ghClient({ token = process.env.GITHUB_TOKEN, timeoutMs = 15000 } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // redirect:"manual" is load-bearing: fetch follows a rename by default, which
  // would turn a 301 into a 200 and lose the one signal that a repo moved.
  const call = async (path) => {
    try {
      const res = await fetchResponse(`${API}${path}`, { headers, timeoutMs, redirect: "manual" });
      return { status: res.status, body: await res.json().catch(() => null), location: res.headers.get("location") };
    } catch (err) {
      if (Number.isFinite(err && err.status)) return { status: err.status, body: null, location: err.location || null };
      throw err;
    }
  };

  // "renamed" is only actionable if it says where to. One extra call, 12 repos.
  const repo = async (slug) => {
    const r = await call(`/repos/${slug}`);
    if (r.status !== 301 || !r.location) return r;
    try {
      const moved = await fetchResponse(r.location, { headers, timeoutMs });
      const body = await moved.json().catch(() => null);
      return { ...r, movedTo: (body && body.full_name) || null };
    } catch {
      return r;
    }
  };

  return { repo, latestRelease: (slug) => call(`/repos/${slug}/releases/latest`) };
}

/** Run the pool through the check. Pure of I/O except the injected gh + store. */
async function runTracker({ pool, gh, store, now = new Date().toISOString(), staleDays }) {
  const events = [];
  let checked = 0;
  let errors = 0;

  const one = async (entry) => {
    const slug = entry.repo;
    checked += 1;
    let meta;
    try {
      meta = await gh.repo(slug);
    } catch (err) {
      errors += 1;
      store.recordError(slug, String((err && err.message) || err), now);
      return;
    }

    // 5xx (and a null body on a 2xx) tells us nothing about upstream.
    if (meta.status >= 500 || (meta.status === 200 && !meta.body)) {
      errors += 1;
      store.recordError(slug, `HTTP ${meta.status} from api.github.com`, now);
      return;
    }

    let tag = null;
    let tagAt = null;
    if (meta.status === 200) {
      try {
        const rel = await gh.latestRelease(slug);
        if (rel.status === 200 && rel.body) {
          tag = rel.body.tag_name || null;
          tagAt = rel.body.published_at || null;
        }
      } catch {
        // A missing or unreachable release list is normal; the repo check stands.
      }
    }

    const b = meta.body || {};
    const merged = store.recordSnapshot({
      repo: slug,
      projects: entry.projects || [],
      role: entry.role,
      http_status: meta.status,
      archived: b.archived ? 1 : 0,
      pushed_at: b.pushed_at || null,
      stars: Number.isFinite(b.stargazers_count) ? b.stargazers_count : null,
      latest_tag: tag,
      latest_at: tagAt,
      checked_at: now,
    });

    for (const e of diffRepo(merged, { now, staleDays })) {
      // diffRepo is pure on the row and the row has no column for a new name,
      // so the destination is grafted on here rather than smuggled into it.
      if (e.event === "renamed" && meta.movedTo) e.to = meta.movedTo;
      store.appendEvent(e);
      events.push(e);
    }
  };

  // Bounded concurrency: a shared box, and GitHub rate-limits per hour not per second.
  const queue = [...pool];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await one(next);
  });
  await Promise.all(workers);

  const alarms = events.filter((e) => e.severity === "ALARM").length;
  return { checked, errors, events, alarms };
}

class TrackedReposModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
  }

  /** Assemble the pool from the radar and the live repos, unless tests injected one. */
  async assemble(db) {
    if (this.deps.radarRows || this.deps.depRepos) {
      return buildPool({ radarRows: this.deps.radarRows || [], depRepos: this.deps.depRepos || [] });
    }
    const radarRows = readRadarRows();
    const { names, owners } = readProjectDeps();
    const resolver = createResolver({ cache: db.tracked.depCache() });
    const { resolved, unresolved, unknown } = await resolver.resolveAll(names);
    if (unknown.length) console.warn(`[tracker] ${unknown.length} packages could not be looked up this run`);
    console.log(`[tracker] deps: ${resolved.size} resolved · ${unresolved.length} unresolved · ${unknown.length} unknown`);
    const depRepos = [];
    for (const [pkg, repo] of resolved) for (const project of owners.get(pkg) || []) depRepos.push({ repo, project });
    return buildPool({ radarRows, depRepos });
  }

  async fetch() {
    const db = this.deps.db || require("../database/db");
    const pool = await this.assemble(db);
    const gh = this.deps.gh || ghClient({ timeoutMs: this.config.timeout_ms || 15000 });
    const r = await runTracker({ pool, gh, store: db.tracked, staleDays: this.config.stale_days });

    console.log(
      `[tracker] checked ${r.checked} repos · ${r.events.length} events (${r.alarms} ALARM) · ${r.errors} errors`
    );
    // Zero alarms is the STEADY STATE, not a fault — warning on it daily would
    // cry wolf until nobody read the line. What must never be true is the
    // control missing from the pool, or never having alarmed at all: either
    // means a healthy report and a broken instrument look identical.
    const controlChecked = pool.some((e) => e.repo === POSITIVE_CONTROL);
    const controlAlarmed = db.tracked.hasEvent(POSITIVE_CONTROL, "archived");
    if (!controlChecked || !controlAlarmed) {
      console.warn(
        `[tracker] INSTRUMENT SUSPECT — positive control ${POSITIVE_CONTROL} ` +
          `${controlChecked ? "was checked" : "was NOT in the pool"} and ` +
          `${controlAlarmed ? "has alarmed" : "has NEVER alarmed"}. Treat this run's silence as unproven.`
      );
    }
    // Findings live in tracked_events, not in the items feed. Returning nothing
    // keeps the daily digest of NEWS separate from the weekly report of CHANGES.
    return [];
  }
}

/** Every radar verdict row, flattened, from config/radar/<project>.json. */
function readRadarRows(dir = path.join(__dirname, "..", "config", "radar")) {
  const rows = [];
  if (!fs.existsSync(dir)) return rows;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "example.json") continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      for (const r of cfg.audit || []) {
        rows.push({ repo: r.repo, project: r.project || cfg.project, verdict: r.verdict, status: r.status });
      }
    } catch (err) {
      console.warn(`[tracker] unreadable radar config ${f}: ${err.message}`);
    }
  }
  return rows;
}

/** Distinct package names across every profile with a repoPath, and who uses each. */
function readProjectDeps(configPath = path.join(__dirname, "..", "config", "projects.json")) {
  const owners = new Map();
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return { names: [], owners };
  }
  const list = Array.isArray(cfg.projects)
    ? cfg.projects
    : Object.entries(cfg.projects || {}).map(([id, v]) => ({ id, ...v }));
  for (const p of list) {
    if (!p.repoPath || !fs.existsSync(p.repoPath)) continue;
    for (const dep of readDeps(p.repoPath)) {
      if (!owners.has(dep)) owners.set(dep, []);
      if (!owners.get(dep).includes(p.id)) owners.get(dep).push(p.id);
    }
  }
  return { names: [...owners.keys()], owners };
}

module.exports = TrackedReposModule;
module.exports.readRadarRows = readRadarRows;
module.exports.readProjectDeps = readProjectDeps;
module.exports.runTracker = runTracker;
module.exports.ghClient = ghClient;
