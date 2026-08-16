const test = require("node:test");
const assert = require("node:assert/strict");
const { runSource, summarize } = require("../modules/fetch-runner");

function fakeDb() {
  const calls = { status: [], lastFetched: [], upserts: [] };
  return {
    calls,
    upsertItems: (items) => {
      calls.upserts.push(items);
      return items.length;
    },
    updateSourceLastFetched: (id) => calls.lastFetched.push(id),
    updateSourceStatus: (row) => calls.status.push(row),
  };
}

const src = (over = {}) => ({ id: "s1", type: "fake", last_fetched_at: null, config: {}, ...over });

test("module that resolves items -> success, items counted, status persisted", async () => {
  const db = fakeDb();
  const createModule = () => ({ canFetch: () => true, fetch: async () => [{ id: "a" }, { id: "b" }] });
  const r = await runSource(src(), { db, createModule, timeoutMs: 1000 });
  assert.equal(r.status, "success");
  assert.equal(r.items, 2);
  assert.equal(db.calls.lastFetched[0], "s1");
  assert.equal(db.calls.status[0].id, "s1");
  assert.equal(db.calls.status[0].last_status, "success");
  assert.equal(db.calls.status[0].last_item_count, 2);
  assert.equal(db.calls.status[0].last_error, null);
});

test("module that throws -> error with message, status persisted, no last_fetched update", async () => {
  const db = fakeDb();
  const createModule = () => ({ canFetch: () => true, fetch: async () => { throw new Error("HTTP 404 for x"); } });
  const r = await runSource(src(), { db, createModule, timeoutMs: 1000 });
  assert.equal(r.status, "error");
  assert.match(r.error, /404/);
  assert.equal(db.calls.lastFetched.length, 0);
  assert.equal(db.calls.status[0].last_status, "error");
  assert.match(db.calls.status[0].last_error, /404/);
});

test("module that hangs -> timeout status, never success", async () => {
  const db = fakeDb();
  const createModule = () => ({ canFetch: () => true, fetch: () => new Promise(() => {}) });
  const r = await runSource(src(), { db, createModule, timeoutMs: 30 });
  assert.equal(r.status, "timeout");
  assert.equal(db.calls.status[0].last_status, "timeout");
});

test("rate limited -> rate_limited, nothing persisted", async () => {
  const db = fakeDb();
  const createModule = () => ({ canFetch: () => false, fetch: async () => [] });
  const r = await runSource(src({ last_fetched_at: new Date().toISOString() }), { db, createModule, timeoutMs: 1000 });
  assert.equal(r.status, "rate_limited");
  assert.equal(db.calls.status.length, 0);
});

test("unknown module type -> error", async () => {
  const db = fakeDb();
  const r = await runSource(src({ type: "nope" }), { db, createModule: () => null, timeoutMs: 1000 });
  assert.equal(r.status, "error");
  assert.match(r.error, /Unknown module type/);
});

test("summarize distinguishes partial failure from network-down", () => {
  const partial = summarize([
    { source: "a", status: "success", items: 3 },
    { source: "b", status: "error", error: "boom" },
    { source: "c", status: "rate_limited", items: 0 },
  ]);
  assert.equal(partial.fetched, 3);
  assert.equal(partial.sources_attempted, 2);
  assert.equal(partial.sources_failed, 1);
  assert.equal(partial.all_failed, false);
  assert.deepEqual(partial.errors, [{ source: "b", error: "boom" }]);
  assert.equal(partial.sources.a.status, "success");
  assert.equal(partial.sources.b.status, "error");

  const down = summarize([
    { source: "a", status: "error", error: "fetch failed" },
    { source: "b", status: "timeout", error: "timed out" },
  ]);
  assert.equal(down.sources_failed, 2);
  assert.equal(down.all_failed, true);
});
