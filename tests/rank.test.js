const test = require("node:test");
const assert = require("node:assert/strict");
const { starFloor, dropForksArchived, canonicalDedup, recencyFactor, rankDiscoveries, stackHealth } = require("../routes/lib/rank");

const NOW = new Date("2026-08-16T00:00:00Z").getTime();
const days = (n) => new Date(NOW - n * 86400000).toISOString();
const item = (title, stars, over = {}) => ({
  title, stars, url: `https://github.com/${title}`, description: `desc of ${title}`,
  published_at: days(1), score: 50, metadata: {}, relevance: { dependencyOverlap: 5 }, ...over,
});

test("starFloor drops repos under the floor; 0 disables", () => {
  const items = [item("a/x", 3), item("b/y", 250)];
  assert.deepEqual(starFloor(items, 200).map((i) => i.title), ["b/y"]);
  assert.equal(starFloor(items, 0).length, 2);
});

test("dropForksArchived removes forks and archived, keeps unknown", () => {
  const items = [item("a/x", 500, { metadata: { fork: true } }), item("b/y", 500, { metadata: { archived: true } }), item("c/z", 500, { metadata: {} })];
  assert.deepEqual(dropForksArchived(items).map((i) => i.title), ["c/z"]);
});

test("canonicalDedup collapses same repo name and same description (mirror/rename), keeps higher stars", () => {
  const items = [
    item("pewdiepie-archdaemon/odysseus", 82808, { description: "Self-hosted AI workspace." }),
    item("odysseus-dev/odysseus", 85385, { description: "Self-hosted AI workspace." }),
    item("acme/other", 100, { description: "Self-hosted AI workspace." }),   // same desc, different name -> still a mirror
    item("acme/unique", 100, { description: "Totally different thing here." }),
    item("acme/short", 100, { description: "x" }),                           // too short to key on desc
    item("bcme/other2", 90, { description: "x" }),                           // same short desc -> NOT collapsed
  ];
  const out = canonicalDedup(items);
  assert.deepEqual(out.map((i) => i.title).sort(), ["acme/short", "acme/unique", "bcme/other2", "odysseus-dev/odysseus"]);
});

test("recencyFactor decays with age of last push", () => {
  assert.equal(recencyFactor(days(10), NOW), 1.0);
  assert.equal(recencyFactor(days(60), NOW), 0.7);
  assert.equal(recencyFactor(days(120), NOW), 0.45);
  assert.equal(recencyFactor(days(400), NOW), 0.25);
  assert.equal(recencyFactor(null, NOW), 0.25);
});

test("rankDiscoveries: overlap first, then decayed score; applies floor/fork/dedup", () => {
  const items = [
    item("a/stale", 5000, { published_at: days(400), score: 100, relevance: { dependencyOverlap: 5 } }),
    item("b/fresh", 300, { published_at: days(2), score: 60, relevance: { dependencyOverlap: 5 } }),
    item("c/tiny", 10, { relevance: { dependencyOverlap: 50 } }),
    item("d/fork", 900, { metadata: { fork: true }, relevance: { dependencyOverlap: 50 } }),
    item("e/big", 900, { relevance: { dependencyOverlap: 9 } }),
  ];
  const out = rankDiscoveries(items, { starsMin: 200, now: NOW });
  assert.deepEqual(out.map((i) => i.title), ["e/big", "b/fresh", "a/stale"]);
  assert.equal(out[1].relevance.decayedScore, 60);
  assert.equal(out[2].relevance.decayedScore, 25);
});

test("stackHealth strips scoring and reports staleness, stalest first", () => {
  const out = stackHealth([item("x/lib", 10, { published_at: days(200), metadata: { open_issues: 4 } }), item("y/lib", 10, { published_at: days(1) })], NOW);
  assert.deepEqual(out.map((i) => i.title), ["x/lib", "y/lib"]);
  assert.equal(out[0].daysSincePush, 200);
  assert.equal(out[0].openIssues, 4);
  assert.equal(out[0].relevance, undefined);
});
