const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPool, POSITIVE_CONTROL } = require("../modules/tracked-pool");

const find = (pool, repo) => pool.find((r) => r.repo === repo);

test("accepted and done radar rows enter the pool as adopted", () => {
  const pool = buildPool({
    radarRows: [
      { repo: "a/one", project: "apollo", verdict: "ADOPT", status: "accepted" },
      { repo: "a/two", project: "apollo", verdict: "ADOPT", status: "done" },
    ],
  });
  assert.equal(find(pool, "a/one").role, "adopted");
  assert.equal(find(pool, "a/two").role, "adopted");
});

test("a WATCH row is tracked as watch, and a proposed ADOPT row is NOT tracked", () => {
  const pool = buildPool({
    radarRows: [
      { repo: "a/watch", project: "apollo", verdict: "WATCH", status: "proposed" },
      { repo: "a/maybe", project: "apollo", verdict: "ADOPT", status: "proposed" },
    ],
  });
  assert.equal(find(pool, "a/watch").role, "watch");
  assert.equal(find(pool, "a/maybe"), undefined, "an ADOPT we have not accepted is not a commitment");
});

test("A REJECTED ROW LEAVES THE POOL — even when its verdict is WATCH", () => {
  // The pool must be retired as decisions are made, or a recency-ranked list of
  // 'things we care about' degrades into noise nobody reads.
  const pool = buildPool({
    radarRows: [
      { repo: "a/no", project: "apollo", verdict: "WATCH", status: "rejected" },
      { repo: "a/nope", project: "apollo", verdict: "ADOPT", status: "rejected" },
    ],
  });
  assert.equal(find(pool, "a/no"), undefined);
  assert.equal(find(pool, "a/nope"), undefined);
});

test("a repo rejected by one project but accepted by another stays, owned by the accepter", () => {
  const pool = buildPool({
    radarRows: [
      { repo: "a/shared", project: "apollo", verdict: "ADOPT", status: "rejected" },
      { repo: "a/shared", project: "lyra", verdict: "ADOPT", status: "accepted" },
    ],
  });
  assert.deepEqual(find(pool, "a/shared").projects, ["lyra"]);
});

test("a repo adopted by two projects appears ONCE, carrying both names", () => {
  const pool = buildPool({
    radarRows: [
      { repo: "google-labs-code/design.md", project: "apollo", verdict: "ADOPT", status: "accepted" },
      { repo: "google-labs-code/design.md", project: "hermes", verdict: "ADOPT", status: "accepted" },
    ],
  });
  assert.equal(pool.filter((r) => r.repo === "google-labs-code/design.md").length, 1);
  assert.deepEqual(find(pool, "google-labs-code/design.md").projects, ["apollo", "hermes"]);
});

test("adopted beats watch beats dep when the same repo arrives twice", () => {
  const pool = buildPool({
    radarRows: [{ repo: "a/one", project: "apollo", verdict: "WATCH", status: "proposed" }],
    depRepos: [{ repo: "a/one", project: "atlas" }],
  });
  assert.equal(find(pool, "a/one").role, "watch");
  assert.deepEqual(find(pool, "a/one").projects, ["apollo", "atlas"]);

  const pool2 = buildPool({
    radarRows: [{ repo: "a/one", project: "apollo", verdict: "ADOPT", status: "accepted" }],
    depRepos: [{ repo: "a/one", project: "atlas" }],
  });
  assert.equal(find(pool2, "a/one").role, "adopted");
});

test("THE POSITIVE CONTROL IS ALWAYS IN THE POOL, even on empty input", () => {
  // A tracker reporting zero alarms is only trustworthy if a known-dead repo is
  // in the set it just checked. Without this, healthy and broken look identical.
  const pool = buildPool({});
  assert.equal(pool.length, 1);
  assert.equal(pool[0].repo, POSITIVE_CONTROL);
  assert.equal(pool[0].role, "control");
});

test("the positive control is not duplicated if it also arrives as a dependency", () => {
  const pool = buildPool({ depRepos: [{ repo: POSITIVE_CONTROL, project: "atlas" }] });
  assert.equal(pool.filter((r) => r.repo === POSITIVE_CONTROL).length, 1);
  assert.equal(find(pool, POSITIVE_CONTROL).role, "control", "control must keep its role");
});

test("unresolved dependencies never enter the pool", () => {
  const pool = buildPool({ depRepos: [{ repo: "unresolved", project: "apollo" }, { repo: null, project: "apollo" }] });
  assert.equal(pool.length, 1, "only the positive control");
});

test("the pool is sorted and deduped, so two runs produce the same list", () => {
  const rows = [
    { repo: "z/last", project: "apollo", verdict: "ADOPT", status: "accepted" },
    { repo: "a/first", project: "apollo", verdict: "ADOPT", status: "accepted" },
  ];
  const a = buildPool({ radarRows: rows }).map((r) => r.repo);
  const b = buildPool({ radarRows: [...rows].reverse() }).map((r) => r.repo);
  assert.deepEqual(a, b);
});
