const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { applyTrackedSchema, TrackedStore } = require("../database/tracked-store");
const { runTracker, probeByKind, kindMap } = require("../modules/tracked-repos");
const { hfClient, toGhShape } = require("../modules/tracked-hf");

/**
 * H2 — tracked-repos.js asked api.github.com about EVERY tracked row
 * regardless of kind, so a live HuggingFace model (spelled exactly like a
 * GitHub slug, "owner/name") 404s against GitHub and reads as DELETED.
 * Measured real rows: dicta-il/neodictabert-bilingual-embed,
 * Alibaba-NLP/gte-multilingual-reranker-base (atlas),
 * ivrit-ai/whisper-large-v3-turbo-ct2 (orion) — all `role: watch` in the
 * live tracked_repos table, all reported 404/DELETED in digests/weekly-2026-09-03.md,
 * all real 200s on huggingface.co.
 */

const NOW = "2026-08-16T00:00:00Z";

function store() {
  const db = new Database(":memory:");
  applyTrackedSchema(db);
  return new TrackedStore(db);
}

// Same fake-GitHub shape tests/tracked-repos.test.js already uses — calls
// tracked so a control can prove a route was NEVER taken, not just that the
// right answer came back.
function gh(map) {
  const calls = [];
  return {
    calls,
    async repo(slug) {
      calls.push(`repo:${slug}`);
      const r = map[slug];
      if (!r) return { status: 500, body: null };
      return r;
    },
    async latestRelease(slug) {
      calls.push(`rel:${slug}`);
      const r = map[slug];
      return r && r.release ? { status: 200, body: r.release } : { status: 404, body: null };
    },
  };
}

// keyed by "kind:slug" so a test can stub the SAME slug differently under
// model vs dataset — exactly the ambiguity probeByKind's fallback resolves.
function hf(map) {
  const calls = [];
  return {
    calls,
    async probe(id, kind) {
      calls.push(`${kind}:${id}`);
      const r = map[`${kind}:${id}`];
      if (!r) return { status: 404, body: null };
      return r;
    },
  };
}

const ghOk = (over = {}) => ({ status: 200, body: { archived: false, pushed_at: "2026-08-10T00:00:00Z", stargazers_count: 100, ...over } });
const hfOk = (over = {}) => ({ status: 200, body: { archived: false, pushed_at: "2026-08-10T00:00:00Z", stargazers_count: 2, ...over } });

// --- probeByKind: routing ----------------------------------------------------

test("CONTROL: a kind=repo row still asks GitHub, and never touches HuggingFace", async () => {
  const g = gh({ "a/one": ghOk() });
  const h = hf({});
  const meta = await probeByKind({ repo: "a/one", kind: "repo" }, { gh: g, hf: h });
  assert.equal(meta.status, 200);
  assert.deepEqual(g.calls, ["repo:a/one"]);
  assert.deepEqual(h.calls, [], "a plain repo row must never call HuggingFace");
});

test("a kind=model row NEVER calls api.github.com", async () => {
  const g = gh({ "org/model-x": ghOk() }); // stubbed as if it WOULD answer — must not be asked
  const h = hf({ "model:org/model-x": hfOk({ stargazers_count: 7 }) });
  const meta = await probeByKind({ repo: "org/model-x", kind: "model" }, { gh: g, hf: h });
  assert.equal(meta.status, 200);
  assert.deepEqual(g.calls, [], "a model row must never touch api.github.com");
  assert.deepEqual(h.calls, ["model:org/model-x"]);
  assert.equal(meta.viaHf, true);
});

test("a kind=dataset row routes to the dataset endpoint, still never GitHub", async () => {
  const g = gh({});
  const h = hf({ "dataset:org/ds-x": hfOk() });
  const meta = await probeByKind({ repo: "org/ds-x", kind: "dataset" }, { gh: g, hf: h });
  assert.equal(meta.status, 200);
  assert.deepEqual(g.calls, []);
  assert.deepEqual(h.calls, ["dataset:org/ds-x"]);
});

// --- probeByKind: the actual measured defect --------------------------------
// A row with NO declared kind (the real shape of every broken row) that 404s
// on GitHub gets one more look at HuggingFace before being believed gone.

test("a 200 from HuggingFace must NOT read as DELETED, even when GitHub 404s", async () => {
  const g = gh({ "dicta-il/neodictabert-bilingual-embed": { status: 404, body: null } });
  const h = hf({ "model:dicta-il/neodictabert-bilingual-embed": hfOk({ stargazers_count: 2 }) });
  const meta = await probeByKind({ repo: "dicta-il/neodictabert-bilingual-embed" }, { gh: g, hf: h });
  assert.equal(meta.status, 200, "the HF rescue must win over the GitHub 404");
  assert.equal(meta.viaHf, true);
  assert.deepEqual(g.calls, ["repo:dicta-il/neodictabert-bilingual-embed"], "GitHub is still asked first");
});

test("the rescue tries dataset too, not model only", async () => {
  const g = gh({ "org/ds-only": { status: 404, body: null } });
  const h = hf({ "dataset:org/ds-only": hfOk() }); // model: absent -> 404 from the fake
  const meta = await probeByKind({ repo: "org/ds-only" }, { gh: g, hf: h });
  assert.equal(meta.status, 200);
  assert.deepEqual(h.calls, ["model:org/ds-only", "dataset:org/ds-only"]);
});

test("CONTROL: a genuinely deleted repo is still reported deleted (rescue does not swallow real deletions)", async () => {
  const g = gh({ "a/really-gone": { status: 404, body: null } });
  const h = hf({}); // both model and dataset probes miss -> stay 404
  const meta = await probeByKind({ repo: "a/really-gone" }, { gh: g, hf: h });
  assert.equal(meta.status, 404);
  assert.equal(meta.viaHf, undefined, "a genuine 404 is not marked as an HF result");
});

test("CONTROL: with no `hf` injected at all, a 404 behaves EXACTLY as before (backward compatible)", async () => {
  const g = gh({ "a/gone": { status: 404, body: null } });
  const meta = await probeByKind({ repo: "a/gone" }, { gh: g, hf: undefined });
  assert.equal(meta.status, 404);
  assert.deepEqual(g.calls, ["repo:a/gone"]);
});

// --- wired through runTracker end-to-end ------------------------------------

test("runTracker: a model row is fetched via HF and produces no deleted event", async () => {
  const s = store();
  const r = await runTracker({
    pool: [{ repo: "ivrit-ai/whisper-large-v3-turbo-ct2", projects: ["orion"], role: "watch", kind: "model" }],
    gh: gh({}), // if this were ever called, the fake 500s and the test would show it in checked/errors
    hf: hf({ "model:ivrit-ai/whisper-large-v3-turbo-ct2": hfOk({ stargazers_count: 5 }) }),
    store: s,
    now: NOW,
  });
  assert.equal(r.checked, 1);
  assert.equal(r.errors, 0);
  assert.deepEqual(r.events, [], "a live HF model is not news");
  const row = s.get("ivrit-ai/whisper-large-v3-turbo-ct2");
  assert.equal(row.http_status, 200);
  assert.equal(row.stars, 5);
});

test("runTracker: a real-shaped unmarked row (no kind) is rescued from a false DELETED", async () => {
  const s = store();
  const r = await runTracker({
    pool: [{ repo: "Alibaba-NLP/gte-multilingual-reranker-base", projects: ["atlas"], role: "watch" }],
    gh: gh({ "Alibaba-NLP/gte-multilingual-reranker-base": { status: 404, body: null } }),
    hf: hf({ "model:Alibaba-NLP/gte-multilingual-reranker-base": hfOk() }),
    store: s,
    now: NOW,
  });
  assert.deepEqual(r.events.map((e) => e.event), [], "must NOT record a deleted event");
  assert.equal(s.get("Alibaba-NLP/gte-multilingual-reranker-base").http_status, 200);
});

test("CONTROL: runTracker still reports a real deletion when HF has never heard of it either", async () => {
  const s = store();
  const r = await runTracker({
    pool: [{ repo: "a/actually-gone", projects: ["apollo"], role: "dep" }],
    gh: gh({ "a/actually-gone": { status: 404, body: null } }),
    hf: hf({}),
    store: s,
    now: NOW,
  });
  assert.deepEqual(r.events.map((e) => e.event), ["deleted"]);
});

test("CONTROL: existing repo-kind pools (no hf passed at all) behave exactly as before H2", async () => {
  const s = store();
  const r = await runTracker({
    pool: [{ repo: "a/gone", projects: ["apollo"], role: "adopted" }],
    gh: gh({ "a/gone": { status: 404, body: null } }),
    store: s,
    now: NOW,
  });
  assert.deepEqual(r.events.map((e) => e.event), ["deleted"]);
});

test("runTracker never calls gh.latestRelease for an HF-routed row", async () => {
  const s = store();
  const g = gh({});
  await runTracker({
    pool: [{ repo: "org/model-y", projects: [], role: "watch", kind: "model" }],
    gh: g,
    hf: hf({ "model:org/model-y": hfOk() }),
    store: s,
    now: NOW,
  });
  assert.ok(!g.calls.some((c) => c.startsWith("rel:")), "HF has no release concept — must never be asked");
});

// --- kindMap -----------------------------------------------------------------

test("kindMap carries a declared kind through, and defaults nothing on its own", () => {
  const m = kindMap([
    { repo: "a/dataset-repo", kind: "dataset" },
    { repo: "a/plain-repo" },
    { repo: "a/dataset-repo", kind: "model" }, // first non-empty wins, not last
  ]);
  assert.equal(m.get("a/dataset-repo"), "dataset");
  assert.equal(m.has("a/plain-repo"), false);
});

test("CONTROL: kindMap on empty/undefined input is empty, never throws", () => {
  assert.equal(kindMap([]).size, 0);
  assert.equal(kindMap(undefined).size, 0);
});

// --- modules/tracked-hf.js: the real fetch path, with an injected fetch ----
// Only this block touches the network boundary — everything above uses a
// hand-rolled fake `hf`, matching how tests/tracked-repos.test.js already
// tests runTracker against a hand-rolled fake `gh` rather than ghClient
// itself.

const realFetch = global.fetch;
function withFetch(map, fn) {
  global.fetch = async (url) => {
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 500, json: async () => null, text: async () => "", headers: { get: () => null } };
    const [, r] = hit;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => "",
      headers: { get: () => null },
    };
  };
  return fn().finally(() => {
    global.fetch = realFetch;
  });
}

test("hfClient.model() hits the /api/models endpoint and shapes the body like a GitHub repo()", () =>
  withFetch(
    {
      "huggingface.co/api/models/dicta-il/neodictabert-bilingual-embed": {
        status: 200,
        body: { id: "dicta-il/neodictabert-bilingual-embed", likes: 2, lastModified: "2026-02-02T23:27:32.000Z", disabled: false },
      },
    },
    async () => {
      const client = hfClient();
      const r = await client.model("dicta-il/neodictabert-bilingual-embed");
      assert.equal(r.status, 200);
      assert.equal(r.body.stargazers_count, 2);
      assert.equal(r.body.archived, false);
    },
  ));

test("hfClient.dataset() hits the /api/datasets endpoint, not /api/models", () =>
  withFetch(
    { "huggingface.co/api/datasets/org/ds": { status: 200, body: { id: "org/ds", likes: 0, lastModified: null } } },
    async () => {
      const client = hfClient();
      const r = await client.dataset("org/ds");
      assert.equal(r.status, 200);
    },
  ));

test("CONTROL: hfClient reports a real 404 as a 404, not a swallowed error", () =>
  withFetch({ "huggingface.co/api/models/nobody/nothing": { status: 404, body: null } }, async () => {
    const client = hfClient();
    const r = await client.model("nobody/nothing");
    assert.equal(r.status, 404);
    assert.equal(r.body, null);
  }));

// --- toGhShape ---------------------------------------------------------------

test("toGhShape never fabricates archived=true for a model with no such field", () => {
  const shaped = toGhShape({ id: "a/b", likes: 3, lastModified: "2026-01-01T00:00:00Z" });
  assert.equal(shaped.archived, false, "absence of `disabled` must read as not-archived, never invented true");
  assert.equal(shaped.stargazers_count, 3);
});

test("CONTROL: toGhShape on a null body is null, never a fabricated empty object", () => {
  assert.equal(toGhShape(null), null);
});
