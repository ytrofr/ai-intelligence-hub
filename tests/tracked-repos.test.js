const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { applyTrackedSchema, TrackedStore } = require("../database/tracked-store");
const { runTracker } = require("../modules/tracked-repos");

const NOW = "2026-08-16T00:00:00Z";

function store() {
  const db = new Database(":memory:");
  applyTrackedSchema(db);
  return new TrackedStore(db);
}

// A fake GitHub: repo path -> {status, body}. Missing entries are a 500, so a
// test that forgets to stub something fails loudly instead of passing quietly.
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

const ok = (over = {}) => ({
  status: 200,
  body: { archived: false, pushed_at: "2026-08-10T00:00:00Z", stargazers_count: 100, ...over },
});

test("a healthy first run records a snapshot and stays quiet", async () => {
  const s = store();
  const r = await runTracker({
    pool: [{ repo: "a/one", projects: ["apollo"], role: "adopted" }],
    gh: gh({ "a/one": ok() }),
    store: s,
    now: NOW,
  });
  assert.equal(r.checked, 1);
  assert.equal(r.events.length, 0, "a healthy repo we have never seen is not news");
  assert.equal(s.get("a/one").stars, 100);
});

test("A STUBBED 500 records last_error and leaves the PREVIOUS snapshot intact", async () => {
  const s = store();
  const pool = [{ repo: "a/one", projects: ["apollo"], role: "adopted" }];
  await runTracker({ pool, gh: gh({ "a/one": ok({ stargazers_count: 900 }) }), store: s, now: NOW });

  const r = await runTracker({ pool, gh: gh({}), store: s, now: "2026-08-17T00:00:00Z" });

  const row = s.get("a/one");
  assert.match(row.last_error, /500/);
  assert.equal(row.stars, 900, "a failed check must not overwrite good data with nulls");
  assert.equal(row.http_status, 200);
  assert.equal(r.events.length, 0, "a failed check is not an upstream change");
  assert.equal(r.errors, 1);
});

test("a stubbed 404 records the repo as deleted, exactly once", async () => {
  const s = store();
  const pool = [{ repo: "a/gone", projects: ["apollo"], role: "adopted" }];
  const first = await runTracker({ pool, gh: gh({ "a/gone": { status: 404, body: null } }), store: s, now: NOW });
  assert.deepEqual(first.events.map((e) => e.event), ["deleted"]);

  const second = await runTracker({ pool, gh: gh({ "a/gone": { status: 404, body: null } }), store: s, now: "2026-08-17T00:00:00Z" });
  assert.equal(second.events.length, 0, "a repo does not get deleted twice");
});

test("THE POSITIVE CONTROL — an archived repo produces exactly one ALARM", async () => {
  const s = store();
  const control = "google-gemini/deprecated-generative-ai-js";
  const r = await runTracker({
    pool: [{ repo: control, projects: [], role: "control" }],
    gh: gh({ [control]: ok({ archived: true }) }),
    store: s,
    now: NOW,
  });
  const alarms = r.events.filter((e) => e.severity === "ALARM");
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].event, "archived");
  assert.equal(alarms[0].repo, control);
});

test("detected events are persisted to the append-only log, not just returned", async () => {
  const s = store();
  await runTracker({
    pool: [{ repo: "a/dead", projects: [], role: "control" }],
    gh: gh({ "a/dead": ok({ archived: true }) }),
    store: s,
    now: NOW,
  });
  assert.equal(s.eventCount(), 1);
  assert.equal(s.eventsSince("2026-01-01T00:00:00Z")[0].event, "archived");
});

test("a major release is detected across two runs", async () => {
  const s = store();
  const pool = [{ repo: "a/lib", projects: ["apollo"], role: "adopted" }];
  await runTracker({ pool, gh: gh({ "a/lib": { ...ok(), release: { tag_name: "v1.9.0", published_at: NOW } } }), store: s, now: NOW });
  const r = await runTracker({
    pool,
    gh: gh({ "a/lib": { ...ok(), release: { tag_name: "v2.0.0", published_at: NOW } } }),
    store: s,
    now: "2026-08-17T00:00:00Z",
  });
  assert.deepEqual(r.events.map((e) => e.event), ["major_release"]);
});

test("one repo failing does not stop the rest of the pool being checked", async () => {
  const s = store();
  const r = await runTracker({
    pool: [
      { repo: "a/broken", projects: [], role: "dep" },
      { repo: "a/fine", projects: [], role: "dep" },
    ],
    gh: gh({ "a/fine": ok() }),
    store: s,
    now: NOW,
  });
  assert.equal(r.checked, 2);
  assert.equal(r.errors, 1);
  assert.equal(s.get("a/fine").stars, 100);
});

test("summary counts alarms separately so a quiet run is legible", async () => {
  const s = store();
  const r = await runTracker({
    pool: [
      { repo: "a/dead", projects: [], role: "control" },
      { repo: "a/fine", projects: [], role: "dep" },
    ],
    gh: gh({ "a/dead": ok({ archived: true }), "a/fine": ok() }),
    store: s,
    now: NOW,
  });
  assert.equal(r.checked, 2);
  assert.equal(r.alarms, 1);
  assert.equal(r.events.length, 1);
});

test("a renamed repo reports WHERE it moved to, not just that it moved", async () => {
  // Real finding: facebook/react answers 301 and now lives at react/react.
  const s = store();
  const r = await runTracker({
    pool: [{ repo: "facebook/react", projects: ["apollo"], role: "dep" }],
    gh: {
      repo: async () => ({ status: 301, body: null, movedTo: "react/react" }),
      latestRelease: async () => ({ status: 404, body: null }),
    },
    store: s,
    now: NOW,
  });
  const e = r.events.find((x) => x.event === "renamed");
  assert.equal(e.to, "react/react", "an alarm saying only '301' cannot be acted on");
});
