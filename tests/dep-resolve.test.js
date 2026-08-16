const test = require("node:test");
const assert = require("node:assert/strict");
const { createResolver, slugFromUrl, UNRESOLVED } = require("../modules/dep-resolve");
const { HttpError } = require("../modules/http");

function memCache() {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), size: () => m.size };
}

// A fake registry that counts calls, so "the cache avoided a call" is measured
// rather than assumed.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [frag, val] of Object.entries(routes)) {
      if (url.includes(frag)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    throw new HttpError(404, url); // a registry answering "no such package"
  };
  fn.calls = calls;
  return fn;
}

test("slugFromUrl reads owner/repo out of every GitHub URL shape", () => {
  assert.equal(slugFromUrl("https://github.com/acme/widget"), "acme/widget");
  assert.equal(slugFromUrl("git+https://github.com/acme/widget.git"), "acme/widget");
  assert.equal(slugFromUrl("git@github.com:acme/widget.git"), "acme/widget");
  assert.equal(slugFromUrl("https://gitlab.com/acme/widget"), null);
  assert.equal(slugFromUrl(""), null);
  assert.equal(slugFromUrl(null), null);
});

test("an npm package resolves through its repository field", async () => {
  const f = fakeFetch({ "registry.npmjs.org": { repository: { url: "git+https://github.com/acme/widget.git" } } });
  const r = createResolver({ fetchJson: f, cache: memCache() });
  assert.equal(await r.resolve("widget"), "acme/widget");
});

test("a PyPI package resolves through project_urls when npm has nothing", async () => {
  const f = fakeFetch({ "pypi.org": { info: { project_urls: { Source: "https://github.com/psf/requests" } } } });
  const r = createResolver({ fetchJson: f, cache: memCache() });
  assert.equal(await r.resolve("requests"), "psf/requests");
});

test("AN UNRESOLVABLE PACKAGE IS unresolved — never a guessed slug", async () => {
  // The tempting bug is `owner = pkg` or `pkg/pkg`. A wrong slug would be tracked
  // forever and quietly report 404 'deleted' on a repo that never existed.
  const f = fakeFetch({});
  const r = createResolver({ fetchJson: f, cache: memCache() });
  assert.equal(await r.resolve("some-internal-thing"), UNRESOLVED);
});

test("a package whose repository points off GitHub is unresolved, not mangled", async () => {
  const f = fakeFetch({ "registry.npmjs.org": { repository: { url: "https://bitbucket.org/acme/widget" } } });
  const r = createResolver({ fetchJson: f, cache: memCache() });
  assert.equal(await r.resolve("widget"), UNRESOLVED);
});

test("a cache hit avoids a second network call", async () => {
  const f = fakeFetch({ "registry.npmjs.org": { repository: "https://github.com/acme/widget" } });
  const r = createResolver({ fetchJson: f, cache: memCache() });
  await r.resolve("widget");
  const after = f.calls.length;
  await r.resolve("widget");
  assert.equal(f.calls.length, after, "the second resolve must not hit the network");
});

test("an UNRESOLVED verdict is cached too — 247 misses must not re-query daily", async () => {
  const f = fakeFetch({});
  const r = createResolver({ fetchJson: f, cache: memCache() });
  await r.resolve("nope");
  const after = f.calls.length;
  assert.equal(await r.resolve("nope"), UNRESOLVED);
  assert.equal(f.calls.length, after);
});

test("a cache entry older than the TTL is re-queried", async () => {
  const cache = memCache();
  const f = fakeFetch({ "registry.npmjs.org": { repository: "https://github.com/acme/widget" } });
  let clock = "2026-01-01T00:00:00Z";
  const r = createResolver({ fetchJson: f, cache, ttlDays: 30, now: () => clock });
  await r.resolve("widget");
  const after = f.calls.length;
  clock = "2026-03-01T00:00:00Z";
  assert.equal(await r.resolve("widget"), "acme/widget");
  assert.ok(f.calls.length > after, "a stale entry must be re-queried");
});

test("a scoped @npm name never falls through to PyPI", async () => {
  const f = fakeFetch({});
  const r = createResolver({ fetchJson: f, cache: memCache() });
  await r.resolve("@types/node");
  assert.equal(f.calls.filter((u) => u.includes("pypi.org")).length, 0);
});

test("a registry outage is not a resolution — it is not cached as UNRESOLVED", async () => {
  // Caching an outage as 'unresolved' for 30 days would silently shrink the pool.
  const boom = fakeFetch({ "registry.npmjs.org": new Error("ETIMEDOUT"), "pypi.org": new Error("ETIMEDOUT") });
  const cache = memCache();
  const r = createResolver({ fetchJson: boom, cache });
  assert.equal(await r.resolve("widget"), null, "an outage yields null, distinct from UNRESOLVED");
  assert.equal(cache.size(), 0, "nothing may be cached from a failed lookup");
});

test("resolveAll returns one entry per input and reports the counts", async () => {
  const f = fakeFetch({ "registry.npmjs.org/widget": { repository: "https://github.com/acme/widget" } });
  const r = createResolver({ fetchJson: f, cache: memCache() });
  const out = await r.resolveAll(["widget", "mystery"]);
  assert.equal(out.resolved.get("widget"), "acme/widget");
  assert.deepEqual(out.unresolved, ["mystery"]);
});

test("a GitHub URL that is not a repo does NOT become a slug", () => {
  // Live finding: 3 of 4 first-run 'deleted' alarms were funding and placeholder
  // links parsed as repos. A wrong slug alarms 404 forever and looks like news.
  assert.equal(slugFromUrl("https://github.com/sponsors/encode"), null);
  assert.equal(slugFromUrl("https://github.com/sponsors/samuelcolvin"), null);
  assert.equal(slugFromUrl("https://github.com/user/repo"), null);
  assert.equal(slugFromUrl("https://github.com/orgs/acme/projects/1"), null);
  // ...while a real repo whose name merely looks generic is untouched.
  assert.equal(slugFromUrl("https://github.com/acme/settings"), "acme/settings");
});
