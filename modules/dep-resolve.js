/**
 * Package name -> "owner/repo", with a cache.
 *
 * 247 of the 293 tracked repos arrive as package names, not slugs, and a wrong
 * slug is worse than no slug: it would be tracked forever and report a confident
 * 404 'deleted' on a repo that never existed. So the only two answers are a slug
 * the registry actually gave us, or UNRESOLVED. Nothing is ever guessed from the
 * package name.
 *
 * Three outcomes, kept distinct on purpose:
 *   "owner/repo"  the registry named a GitHub repository
 *   UNRESOLVED    the registry answered, and there is no GitHub repo to track
 *   null          we could not ask (timeout, outage) - NOT cached, or an outage
 *                 would silently shrink the pool for 30 days
 */

const { fetchJson: httpFetchJson } = require("./http");

const UNRESOLVED = "unresolved";
const TTL_DAYS = 30;
const UA = { "User-Agent": "AI-Intelligence-Hub/1.0" };

// A registry that replies 404 has told us something; a registry we could not
// reach has not. Only the first may be cached as UNRESOLVED.
const answered = (err) => Boolean(err && Number.isFinite(err.status));

/** Extract "owner/repo" from any GitHub URL form (https, git+, ssh). */
function slugFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!m) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`;
}

function createResolver({ fetchJson = httpFetchJson, cache, ttlDays = TTL_DAYS, now = () => new Date().toISOString(), timeoutMs = 15000 } = {}) {
  const fresh = (entry) => {
    if (!entry || !entry.resolved_at) return false;
    return Date.parse(now()) - Date.parse(entry.resolved_at) < ttlDays * 864e5;
  };

  async function fromNpm(pkg) {
    const encoded = pkg.replace("/", "%2F"); // @scope/name -> @scope%2Fname
    const data = await fetchJson(`https://registry.npmjs.org/${encoded}`, { headers: UA, timeoutMs });
    const repo = data && data.repository;
    return slugFromUrl(typeof repo === "string" ? repo : repo && repo.url);
  }

  async function fromPypi(pkg) {
    const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, { headers: UA, timeoutMs });
    const info = (data && data.info) || {};
    const candidates = Object.values(info.project_urls || {});
    if (info.home_page) candidates.push(info.home_page);
    for (const url of candidates) {
      const slug = slugFromUrl(url);
      if (slug) return slug;
    }
    return null;
  }

  async function resolve(name) {
    const pkg = String(name || "").trim();
    if (!pkg) return UNRESOLVED;

    const hit = cache && cache.get(pkg);
    if (fresh(hit)) return hit.repo;

    let asked = false; // did any registry actually answer?
    let slug = null;

    try {
      slug = await fromNpm(pkg);
      asked = true;
    } catch (err) {
      // A status code IS an answer ("no such package"). A timeout is not.
      if (answered(err)) asked = true;
    }

    if (!slug && !pkg.startsWith("@")) {
      try {
        slug = await fromPypi(pkg);
        asked = true;
      } catch (err) {
        if (answered(err)) asked = true;
      }
    }

    // Nobody answered: we do not know, and we must not record that we do.
    if (!asked) return null;

    const value = slug || UNRESOLVED;
    if (cache) cache.set(pkg, { repo: value, resolved_at: now() });
    return value;
  }

  /** Resolve many, sequentially — registries rate-limit, and this runs daily. */
  async function resolveAll(names) {
    const resolved = new Map();
    const unresolved = [];
    const unknown = [];
    for (const name of names) {
      const r = await resolve(name);
      if (r === null) unknown.push(name);
      else if (r === UNRESOLVED) unresolved.push(name);
      else resolved.set(name, r);
    }
    return { resolved, unresolved, unknown };
  }

  return { resolve, resolveAll };
}

module.exports = { createResolver, slugFromUrl, UNRESOLVED, TTL_DAYS };
